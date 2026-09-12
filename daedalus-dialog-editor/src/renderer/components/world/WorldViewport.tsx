import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { Box } from '@mui/material';
import * as THREE from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';
import {
  threeToZen, zenToThree, zenBoxToThree,
  isWaynetOp, type VobExtent, type ZenPosition, type ZenRotation,
} from 'zen-world';
import type {
  DecodedTexture, InstancedPayload, VobIndex, WaynetPayload, WorldMeshPayload, WorldOp,
} from '../../../shared/worldTypes';
import type { SpawnSite } from '../../../shared/types';
import { WaynetOverlay } from '../../world/WaynetOverlay';
import { SpawnOverlay } from '../../world/SpawnOverlay';
import type { RoutineIndex } from '../../routines/routineSchedule';
import { TerrainMarker, PIVOT_COLOR, PIVOT_SIZE } from '../../world/TerrainMarker';
import { ScatterBrush } from '../../world/ScatterBrush';
import {
  SELECTED_ATTRIBUTE, textureCacheFor, type TextureCache, type WorldScene,
} from '../../world/WorldScene';
import { type OutlineMode } from '../../world/VobOutline';
import { BvhBuilder } from '../../world/BvhBuilder';
import { SceneHost } from '../../world/SceneHost';
import { ViewportRenderer } from '../../world/ViewportRenderer';
import { PickController } from '../../world/PickController';
import { GizmoController, type GizmoMode } from '../../world/GizmoController';
import { NO_PICK } from '../../world/pickIds';
import { chooseWaypointLabels } from '../../world/waypointLabels';
import { WaypointLabelLayer } from '../../world/WaypointLabelLayer';
import {
  attachBlenderNav, frameOn, frameVobs, navFor, pivotAt, type Nav,
} from '../../world/cameraNav';
import { NavController } from '../../world/NavController';
import { CameraSlots, type CameraSlotOutcome } from '../../world/cameraSlots';
import {
  runViewportBenchmark,
  type BenchmarkOptions,
  type BenchmarkResult,
  type ViewportProbe,
} from '../../world/viewportBenchmark';

// The Phase 1a viewport (level-editor.md §3, §7). Everything measured in the
// spike is carried over here, none of it re-derived:
//
//   - one mirrored root node is the whole coordinate conversion (WorldScene)
//   - VOBs sharing a visual are one InstancedMesh
//   - the world mesh gets a BVH, built off the main thread, and nothing else
//     does — a CPU raycast across the props costs 14.2 ms whether or not they
//     have trees
//   - instanced VOBs are GPU ID-picked (VobPicker)
//   - textures are decoded on demand, not eagerly: 549 ms of the cold open
//
// This component owns the imperative Three.js lifetime and deliberately keeps
// it out of React's render path — no payload buffer ever becomes state.

THREE.Mesh.prototype.raycast = acceleratedRaycast;

declare global {
  interface Window {
    /** Present only while a world viewport is mounted. The Phase 1a budget rows
     *  for framerate, draw calls and pick latency are measured through here —
     *  see `viewportBenchmark.ts`. */
    __worldViewport?: {
      benchmark: (options?: Partial<BenchmarkOptions>) => Promise<BenchmarkResult>;
      /**
       * Drag the gizmo to a position in ZenGin space and let go, by firing the
       * events `TransformControls` fires — for `scripts/verify-world-edit.js`,
       * which drives the real app against a real world.
       *
       * What it stands in for is precisely three's pointer-to-position maths;
       * everything below that — the live preview, the commit, the op, the IPC,
       * the native move and the panels — is the real thing.
       */
      dragGizmo: (to: [number, number, number]) => void;
      /** The same, for the rotate gizmo: turn about an axis in ZenGin space by
       *  `radians` and let go. */
      turnGizmo: (axis: [number, number, number], radians: number) => void;
      /** Where the gizmo currently sits, in ZenGin space, or null if detached. */
      gizmoPosition: () => [number, number, number] | null;
      /** The per-instance selection flags the scene is drawing, mesh by mesh and
       *  flattened (§16.24 1). There is no picture to look at without a GPU, and
       *  this is the buffer the shader reads. */
      selectedInstances: () => number[];
      /** Report a click that hit a waypoint in the waynet overlay. It stands in
       *  for `pickWaypoint`'s projection and nothing else. */
      pickWaypoint: (waypoint: number) => void;
      /** The anchor VOB's 3x3 as drawn, row-major, or null if detached. */
      gizmoRotation: () => number[] | null;
      /** Report a click that hit the world mesh rather than a VOB, at a point in
       *  ZenGin space — what the surface's placement flow reads. It stands in
       *  for the BVH raycast that turns a pixel into a point, and nothing else. */
      pickTerrain: (point: [number, number, number]) => void;
      /**
       * Render one frame from `from` looking at `at` — both in **ZenGin space** —
       * once the scene is fully loaded, and hand back the pixels the GPU
       * produced, base64 RGBA, bottom row first.
       *
       * For `scripts/verify-world-render.js`. Nothing about what was drawn is
       * decided here: the frame is the app's own renderer, camera, scene and
       * materials, and every judgement about it belongs to the caller.
       */
      renderFrom: (
        from: [number, number, number], at: [number, number, number],
      ) => Promise<{ width: number; height: number; rgba: string }>;
      /** The orbit pivot — `OrbitControls.target` — in **ZenGin space**.
       *  What a double-click on the mesh moves, and what a navigation press
       *  moves ambiently onto whatever is under the cursor. */
      cameraTarget: () => [number, number, number];
      /** The camera itself, in **ZenGin space** — what a double-click pivot
       *  deliberately leaves alone, unlike the framing keys. */
      cameraPosition: () => [number, number, number];
      /** Where the double-click marker sits, in **ZenGin space**, or null if
       *  a double-click has never hit anything yet. */
      pivotMarkerPoint: () => [number, number, number] | null;
    };
  }
}

export interface WorldViewportProps {
  mesh: WorldMeshPayload;
  visuals: InstancedPayload;
  /**
   * The summary's own VOB columns, for the 38 % of a retail world the worker
   * places nothing for — every sound, light, zone, trigger, mover, startpoint
   * and spot (level-editor.md §16.38). They are drawn as markers, and the index
   * is where a position for them exists.
   *
   * Read through a ref rather than made a dependency of the scene effect: a
   * structural op refreshes the index one commit *before* the new `visuals`
   * arrive, and taking both would rebuild the scene twice per placement. The
   * effect re-runs on `visuals`, which is when the fresh index is read.
   */
  vobIndex: VobIndex;
  /** ZenGin-space world bounds, for framing the camera. */
  bbox: number[];
  /** The waynet, once someone has asked to see it. Null until then: it is a
   *  separate IPC call and an overlay nobody turned on costs nothing. */
  waynet: WaynetPayload | null;
  showWaynet: boolean;
  /**
   * The project's statically resolvable spawns (§16.19 slice 4). Empty when no
   * script project is open — which means "nothing is known", never "nobody is
   * spawned here".
   *
   * Drawn as markers on the waypoints they name, so the layer needs `waynet`
   * for the positions and shows nothing without it.
   */
  spawns: readonly SpawnSite[];
  showSpawns: boolean;
  /**
   * The project's daily routines, for the time slider (§16.19 slice 5). Empty
   * on the same terms as `spawns`: nothing is known, not nobody has a routine.
   */
  routines: RoutineIndex;
  /**
   * The minute of the day the spawn layer is showing, or null for the static
   * spawns. Null is the slider switched off rather than midnight — where an
   * NPC stands at 00:00 is a question the routines answer and this is not.
   */
  spawnTime: number | null;
  /**
   * The quest state the day is drawn through, or null for each NPC's declared
   * routine (§16.19 slice 13). A lens, not a claim the game reaches the state:
   * an NPC with no variant for it keeps his declared day.
   */
  spawnState: string | null;
  /**
   * Draw the name of each nearby waypoint over it (§16.19 slice 8).
   *
   * What gets a name is what is *drawn*: every waypoint while the waynet is on,
   * and otherwise the points the spawn layer is marking. A name over a dot that
   * is not there labels nothing.
   */
  showWaypointNames: boolean;
  loadTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>;
  /** The texture names that could not be decoded, once per scene build. White
   *  geometry is otherwise a fact the user has to reverse-engineer. */
  onTextureFailures?: (names: string[]) => void;
  /** What a camera-slot keystroke did (09-04 review §5.1 item 6). The slots
   *  are handled inside `NavController`, so the surface hears about them only
   *  through here — and it has to, because a stored, a recalled and an empty
   *  slot can all leave the screen exactly as it was. */
  onCameraSlot?: (outcome: CameraSlotOutcome, slot: number) => void;
  /**
   * A click's result: the VOB that was hit, or the point on the world mesh in
   * **ZenGin space** when the click landed on terrain instead. Both null means
   * the click missed everything.
   */
  onPick: (
    vob: number | null,
    point: [number, number, number] | null,
    /** Shift, Ctrl or Cmd was held: add to the selection rather than
     *  replacing it. */
    additive: boolean,
  ) => void;
  /**
   * A right-click that hit a VOB — the same async GPU pick `onPick` uses,
   * reused rather than a second raycast path. Terrain right-click is
   * reserved (level-editor.md §17) and a miss reports
   * nothing. Absent when the surface offers no menu, and then a right-click
   * on the canvas is the browser's own.
   */
  onVobContextMenu?: (vob: number, position: { left: number; top: number }) => void;
  /** What the gizmo drives. Empty hides it; the gizmo sits on the last entry. */
  selection: readonly number[];
  /**
   * A finished drag as a **delta in ZenGin space** — the shell turns it into one
   * op per selected VOB. A delta rather than a destination because one gizmo
   * moves a whole selection and the VOBs keep the spacing they had. The viewport
   * has already drawn the move; this asks for it to be made real.
   */
  onTranslateSelection: (delta: [number, number, number]) => void;
  /** What the gizmo does. A VOB has no scale — `zCVob` has no such field and
   *  nothing in the retail corpus is scaled — so there are two modes, not three. */
  gizmoMode: GizmoMode;
  /**
   * A finished turn as a **delta 3x3 in ZenGin space, row-major** — the shell
   * composes it onto each selected VOB's own matrix, so every one of them turns
   * the same way on screen and each about its own origin.
   */
  onRotateSelection: (delta: ZenRotation) => void;
  /** Ops the main process has applied — a committed edit, an undo, a redo, or
   *  the reversal of a refused one. The scene follows them. */
  appliedOps: WorldOp[] | null;
  /**
   * The waypoint the gizmo is on **instead of** the VOBs, or null.
   *
   * Never both: there is one gizmo, and a waypoint is not a VOB — it has no row
   * in the columnar index, no properties and no place in the scene tree. The
   * store keeps the two exclusive; this is where that shows up on screen.
   */
  selectedWaypoint: number | null;
  /**
   * The last point picked on the terrain, in **ZenGin space** — the one the
   * placement bar names — or null when there is none.
   *
   * Drawn as a marker, because the bar offers to place a VOB at coordinates and
   * coordinates are not somewhere the user can see.
   */
  terrainPoint: [number, number, number] | null;
  /**
   * How bright to draw what is on screen — 1 is the world's own baked light.
   *
   * A view setting and nothing else (`WorldScene.setExposure`): it is a uniform
   * on the finished fragment, so it produces no op, dirties nothing, and is not
   * saved with the world.
   */
  exposure: number;
  /**
   * Which VOBs not to draw: one byte per VOB, 1 for hidden — Spacer's per-class
   * show/hide, answered by the scene tree's own predicate (`matchVobs`). Null
   * draws everything.
   *
   * A view setting like `exposure`, and hidden the same way a filtered row is
   * filtered: nothing is removed from the scene, no op is produced, and a
   * hidden VOB is still in the index, still selectable from the tree.
   */
  hiddenVobs: Uint8Array | null;
  /**
   * How far the selected VOB reaches, when its reach is a radius (architecture §7,
   * #248): a `zCVobSound`'s `radius`, a `zCVobLight`'s `range`, read off the
   * `getVobProps` the property grid already makes. Null for every other class,
   * for a multi-select, and while the read is in flight — a sphere is drawn
   * around exactly the one VOB whose number is known.
   *
   * Optional, and absent means the same as null: nothing to draw. Every
   * viewport spec that predates the sphere leaves it out, and a viewport with
   * no radius to show is the ordinary case rather than a missing argument.
   */
  selectedExtent?: { vob: number; extent: VobExtent } | null;
  /**
   * Light the picture with the selected light (#256). A view setting like
   * `exposure` — uniforms, no op, nothing saved — and **off unless asked for**:
   * the room already carries the light ZenGin baked into it, so this is a
   * preview of one light's reach rather than a lighting model. Optional for the
   * reason `selectedExtent` is: every spec that predates it leaves it out.
   */
  lightPreview?: boolean;
  /**
   * Which VOBs carry the outline (#229). A view setting like `exposure`: one
   * uniform on the pass, no op, nothing saved with the world.
   */
  outlineMode: OutlineMode;
  /**
   * The grid step a drag is quantised to, in **ZenGin centimetres**, or 0 for a
   * free-form drag.
   *
   * The *delta* is quantised, not the position it lands on — `snapping.ts` has
   * the reasoning, and it is the same reason a typed coordinate is a delta. A
   * multi-selection therefore keeps its spacing and moves by a whole number of
   * steps, exactly as it does unsnapped.
   */
  snapGrid: number;
  /** The angle step a turn is quantised to, in **radians**, or 0 for a
   *  free-form turn. Also applied to the delta, and for a stronger reason: an
   *  absolute angle is not something this app can read off a VOB. */
  snapAngle: number;
  /**
   * The scatter brush's radius in **ZenGin centimetres**, or null while the
   * brush is off (level-editor.md §16.25).
   *
   * The radius rather than a boolean because the viewport needs it for the ring
   * cursor and for nothing else: *what* a stroke places is the surface's
   * business, and the whole of what this side does is draw the footprint and
   * report where the cursor went.
   */
  scatterRadius: number | null;
  /**
   * A finished brush stroke — every surface point the cursor passed over while
   * the left button was down, in **ZenGin space**, in the order they were
   * sampled.
   *
   * Raw and undecimated: `strokeCandidates` decimates by a distance derived
   * from the radius, which is a setting rather than something a pointer handler
   * holds. A stroke that never left the sky reports nothing at all.
   */
  onScatterStroke: (samples: Array<[number, number, number]>) => void;
  /** A click that hit a waypoint in the overlay. */
  onSelectWaypoint: (waypoint: number | null) => void;
  /**
   * A finished waypoint drag, in **ZenGin space** — a destination rather than a
   * delta, because one waypoint moves and there is no spacing to keep.
   *
   * `from` goes with it. The overlay's positions are one array shared by the
   * point cloud and the edges, so the live preview has already written `to`
   * over the position the op needs to carry; the shell puts it back with this.
   */
  onMoveWaypoint: (
    waypoint: number,
    from: [number, number, number],
    to: [number, number, number],
  ) => void;
  /**
   * The surface is mounted but off screen — `MainLayout` keeps it that way so
   * its geometry survives a navigate-away (`docs/refactoring-targets.md` §8).
   *
   * The frame loop stops outright rather than drawing into a hidden canvas: a
   * mounted viewport that keeps rendering is a worse defect than the geometry
   * loss the mount is fixing. Nothing else changes — the scene, its buffers and
   * the camera pose are all still here when it comes back.
   */
  paused?: boolean;
}

// Defined with the controller that owns the gizmo, re-exported here because
// the toolbar and `WorldSurface` have always taken it from the viewport.
export type { GizmoMode };

/**
 * The imperative surface `WorldSurface` calls directly, for the one thing that
 * is a query rather than a callback: drop-to-ground and align-to-normal need a
 * per-VOB raycast answered synchronously, in response to a toolbar click
 * rather than a gizmo drag — everything else here is a prop, either data going
 * down or a finished edit coming back up through a callback.
 *
 * `window.__worldViewport` is not it: that global exists solely for scripts
 * and tests to drive the viewport as if a user did (`scripts/verify-world-edit.js`,
 * `WorldViewport.snapping.test.tsx`) and no production component reads it. A
 * real sibling asking the viewport something is a `ref`, the pattern
 * `ActionCard.tsx` already uses for the same reason.
 */
export interface WorldViewportHandle {
  /**
   * A ray straight down from `origin` (ZenGin space) against the world mesh —
   * the terrain, a building, a cave wall. Returns the hit point and its
   * world-space normal, both in ZenGin space, or null for a miss (over the
   * sky, or off the edge of the mesh).
   */
  raycastDown: (origin: ZenPosition) => { point: ZenPosition; normal: ZenPosition } | null;
  /**
   * Jump the camera to a VOB, leaving the orbit pivot on it — the scene tree's
   * double-click.
   *
   * A command and not a state: jumping to the same VOB twice is two of them,
   * and that is precisely when the second one is asked for — after the camera
   * has been flown somewhere else. A VOB that is not drawn at all — a decal, a
   * particle effect; not a sound VOB, which has a marker now (§16.38) — has no
   * position to frame, and neither has any VOB while the scene effect is
   * between a teardown and its rebuild: both are no-ops.
   */
  frameVob: (vob: number) => FrameFailure | null;
  /**
   * The same jump onto a bare position in ZenGin space — a waypoint, which has
   * no row in the VOB index and no bounds (§16.20 slice 2). A no-op while the
   * scene effect is between a teardown and its rebuild, exactly as
   * {@link frameVob} is.
   */
  framePoint: (at: ZenPosition) => FrameFailure | null;
  /**
   * Frame a portal polygon and draw its outline — the Problems panel's click
   * on a portal finding (#222).
   *
   * It takes the polygon's corners rather than its index because the scene
   * cannot turn one into the other: the world mesh is merged draw groups with
   * no polygon mapping, which is why the portal findings were listed without a
   * jump until the corners started riding along with them.
   *
   * Drawing is half the command and not a garnish. A portal is an invisible
   * face inside solid geometry, so a camera flown to its centroid with nothing
   * drawn shows a wall — the same picture the user had before the click.
   *
   * `not-drawn` for a polygon with fewer than three corners; a no-op while the
   * scene effect is between a teardown and its rebuild, exactly as
   * {@link frameVob} is.
   */
  framePolygon: (corners: readonly (readonly [number, number, number])[]) => FrameFailure | null;
  /**
   * The camera's own position, in ZenGin space — what the scene tree's
   * "within reach of the camera" filter measures VOBs against.
   *
   * A query, not a subscription: read once, on demand, the same as
   * {@link raycastDown}. Null while the scene effect is between a teardown
   * and its rebuild, exactly as {@link frameVob} is.
   */
  cameraPosition: () => ZenPosition | null;
}

/**
 * Why a jump did nothing — null when it was made (level-editor.md §16.24 5).
 *
 * The command used to answer nothing at all, and every link on the way to it
 * was optional-chained, so a locator that had stopped working was a no-op with
 * no error anywhere: exactly the symptom reported, and the reason nobody could
 * see which link had gone. The two ways it can legitimately do nothing are told
 * apart because only one of them is a defect — `not-drawn` is the honest answer
 * for a VOB the scene draws nothing for, and `no-scene` means the viewport was
 * asked while the scene effect was between a teardown and its rebuild.
 *
 * That set has shrunk to the decal and the particle effect: a VOB with no
 * visual at all is drawn as a marker now (§16.38), and a marker has a position.
 */
export type FrameFailure = 'no-scene' | 'not-drawn';

/** What the selection and edit effects need of the imperative viewport, so
 *  neither of them can tear the scene down and rebuild 31 MB of buffers. */
interface Gizmo {
  attach: (selection: readonly number[]) => void;
  /** The other thing the gizmo can be on. Null detaches it. */
  attachWaypoint: (waypoint: number | null) => void;
  setMode: (mode: GizmoMode) => void;
}

const WorldViewport = React.forwardRef<WorldViewportHandle, WorldViewportProps>(({
  mesh, visuals, vobIndex, bbox, waynet, showWaynet, spawns, showSpawns, routines, spawnTime, spawnState,
  showWaypointNames, loadTexture, onTextureFailures, onCameraSlot, onPick, onVobContextMenu,
  selection, onTranslateSelection, gizmoMode, onRotateSelection, appliedOps,
  selectedWaypoint, terrainPoint, exposure, hiddenVobs, outlineMode, snapGrid, snapAngle,
  selectedExtent = null,
  lightPreview = false,
  scatterRadius, onScatterStroke,
  onSelectWaypoint, onMoveWaypoint, paused = false,
}, ref) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The overlay is built and torn down independently of the scene, so asking
  // for the waynet does not rebuild 31 MB of geometry.
  /**
   * The world's own identity, as far as the scene is concerned: six numbers,
   * not the array holding them. See the scene effect's dependency list.
   */
  const bboxKey = bbox.join(',');

  const sceneRef = useRef<WorldScene | null>(null);
  // The renderer, its canvas, the outline pass, the camera and the controls —
  // everything a structural op must not throw away (`ViewportRenderer`). Built
  // on the scene effect's first run and disposed only when the viewport goes,
  // which is what the effect below it does.
  const viewportRef = useRef<ViewportRenderer | null>(null);

  useImperativeHandle(ref, () => ({
    raycastDown: (origin) => {
      const world = sceneRef.current;
      if (world === null) return null;

      const raycaster = new THREE.Raycaster();
      raycaster.firstHitOnly = true;
      raycaster.layers.enableAll();
      raycaster.set(
        new THREE.Vector3(...zenToThree(origin)),
        new THREE.Vector3(...zenToThree([0, -1, 0])).normalize(),
      );
      const hit = raycaster.intersectObjects(world.worldMeshes, false)[0];
      if (!hit || !hit.face) return null;

      // `.face.normal` is in the mesh's local space; `transformDirection` puts
      // it in three-space by the mesh's own matrixWorld, mirror included —
      // the inverse-transpose it uses is exactly what a mirror needs and a
      // plain matrix multiply would get backwards.
      const worldNormal = hit.face.normal.clone()
        .transformDirection(hit.object.matrixWorld).normalize();

      return {
        point: threeToZen(hit.point.toArray() as [number, number, number]),
        normal: threeToZen(worldNormal.toArray() as [number, number, number]),
      };
    },
    // Written out rather than `?.() ?? 'no-scene'`: null is what *success*
    // answers, and `??` would turn every landed jump into a reported failure.
    frameVob: (vob) => (frameVobRef.current === null ? 'no-scene' : frameVobRef.current(vob)),
    framePoint: (at) => (framePointRef.current === null ? 'no-scene' : framePointRef.current(at)),
    framePolygon: (corners) => (
      framePolygonRef.current === null ? 'no-scene' : framePolygonRef.current(corners)
    ),
    cameraPosition: () => (cameraPositionRef.current === null ? null : cameraPositionRef.current()),
  }), []);

  const overlayRef = useRef<WaynetOverlay | null>(null);
  const spawnOverlayRef = useRef<SpawnOverlay | null>(null);
  const gizmoRef = useRef<Gizmo | null>(null);
  const onTranslateRef = useRef(onTranslateSelection);
  onTranslateRef.current = onTranslateSelection;
  const onRotateRef = useRef(onRotateSelection);
  onRotateRef.current = onRotateSelection;
  const onSelectWaypointRef = useRef(onSelectWaypoint);
  onSelectWaypointRef.current = onSelectWaypoint;
  const vobIndexRef = useRef(vobIndex);
  vobIndexRef.current = vobIndex;
  const onMoveWaypointRef = useRef(onMoveWaypoint);
  onMoveWaypointRef.current = onMoveWaypoint;
  // Read by the drag, which happens outside React's render path — changing the
  // step must not rebuild the scene, and must apply to the drag already in hand.
  const snapGridRef = useRef(snapGrid);
  snapGridRef.current = snapGrid;
  // The gizmo's anchor depends on the mode (§16.24 2), and the scene effect is
  // built once per world — so the mode it starts from is read through a ref,
  // and every later change reaches it through `setMode`.
  const gizmoModeRef = useRef(gizmoMode);
  gizmoModeRef.current = gizmoMode;
  const snapAngleRef = useRef(snapAngle);
  snapAngleRef.current = snapAngle;
  // The brush is read from pointer handlers built once per world, so switching
  // it on must not rebuild the scene — the same reason the snap steps are refs.
  const scatterRadiusRef = useRef(scatterRadius);
  scatterRadiusRef.current = scatterRadius;
  const onScatterStrokeRef = useRef(onScatterStroke);
  onScatterStrokeRef.current = onScatterStroke;
  const scatterBrushRef = useRef<ScatterBrush | null>(null);
  // The overlay is only pickable while it is on screen, and the scene effect
  // does not re-run when it is toggled.
  const showWaynetRef = useRef(showWaynet);
  showWaynetRef.current = showWaynet;
  // Read from the draw loop, so they are refs rather than dependencies: the
  // loop is built once per world and must not be torn down to change a label.
  const showNamesRef = useRef(showWaypointNames);
  showNamesRef.current = showWaypointNames;
  const showSpawnsRef = useRef(showSpawns);
  showSpawnsRef.current = showSpawns;
  const labelLayerRef = useRef<WaypointLabelLayer | null>(null);
  // Read through refs so a parent re-render cannot tear the scene down and
  // rebuild 31 MB of buffers just because a callback identity changed.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onVobContextMenuRef = useRef(onVobContextMenu);
  onVobContextMenuRef.current = onVobContextMenu;
  const loadTextureRef = useRef(loadTexture);
  loadTextureRef.current = loadTexture;
  const textureFailuresRef = useRef(onTextureFailures);
  textureFailuresRef.current = onTextureFailures;
  const cameraSlotRef = useRef(onCameraSlot);
  cameraSlotRef.current = onCameraSlot;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  // Set by the scene effect, because the camera and the controls live inside
  // it, and cleared by its teardown — which is why the handle's `frameVob`
  // calls it through the ref rather than closing over it.
  const frameVobRef = useRef<((vob: number) => FrameFailure | null) | null>(null);
  const framePointRef = useRef<((at: ZenPosition) => FrameFailure | null) | null>(null);
  const framePolygonRef = useRef<
    ((corners: readonly (readonly [number, number, number])[]) => FrameFailure | null) | null
  >(null);
  const cameraPositionRef = useRef<(() => ZenPosition) | null>(null);
  // Read by the draw loop, which lives outside React's render path: going off
  // screen must not tear the scene down and rebuild 31 MB of buffers — that
  // would be the geometry loss the mount exists to prevent, once per tab
  // switch. Initialised from the prop so a viewport that mounts hidden never
  // draws a frame at all.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // The other half: the scene effect owns the loop, so pausing has to reach it
  // through a handle it publishes. Null while no scene is built.
  const drawLoopRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  // The world the camera has already been pointed at. A rebuild of the same
  // world leaves the view alone — the camera is the viewport's now, not the
  // scene's, so there is nothing to save and restore — and a different world is
  // framed from its own bounds.
  const framedRef = useRef<string | null>(null);
  // Spacer's camera slots (`cameraSlots.ts`): per world, so keyed the same way
  // as the framing and replaced when a different world arrives.
  const slotsRef = useRef<{ key: string; slots: CameraSlots } | null>(null);
  // Where a double-click last set the pivot, in ZenGin space — the dot that
  // confirms it landed somewhere, since `pivotAt` itself is otherwise
  // invisible until the next drag. The dot hangs on the scene's root, so a
  // same-world rebuild has to put it back; the pivot it marks is the camera's
  // and never went anywhere.
  const pivotMarkerRef = useRef<{ key: string; point: [number, number, number] } | null>(null);
  // Survives it for the same reason and keyed the same way: the pixels did not
  // change when a VOB was placed, and re-decoding all 490 of them is the 549 ms
  // the cold open pays. Owned here rather than by the scene, which is torn down
  // and rebuilt underneath it — see `TextureCache`.
  const texturesRef = useRef<TextureCache | null>(null);

  // The world mesh's BVH, and the builder's own memory of it (review §3.3).
  // Every structural op rebuilds the scene, so the geometry is new — but the
  // world mesh is not, and a rebuilt tree is the cold open's 145-590 ms spent
  // again. The builder is keyed on the `mesh` payload and outlives the effect
  // for the same reason the texture cache does.
  const bvhRef = useRef<BvhBuilder | null>(null);

  // Both caches outlive every run of the scene effect, so they are released
  // when the viewport itself goes — the world being closed — and when a
  // different world arrives, which `textureCacheFor` handles below for the
  // textures and the payload key handles for the trees.
  useEffect(() => () => {
    texturesRef.current?.dispose();
    texturesRef.current = null;
    bvhRef.current?.dispose();
    bvhRef.current = null;
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Built on the first run and kept: the renderer, its GL context, the canvas,
    // the outline pass, the camera and the controls are precisely what a
    // structural op must not throw away (`ViewportRenderer`, review §3.2). What
    // this effect rebuilds is the scene under them.
    const viewport = viewportRef.current ?? (viewportRef.current = new ViewportRenderer(host));
    const { scene, renderer, camera, controls, raycaster, pointer } = viewport;

    // The same key the framing and the caches are held against, and the same
    // one this effect is keyed on, so that it is computed once here rather than
    // several times out of step.
    const worldKey = bboxKey;
    texturesRef.current = textureCacheFor(texturesRef.current, worldKey);
    if (slotsRef.current?.key !== worldKey) slotsRef.current = { key: worldKey, slots: new CameraSlots() };
    const cameraSlots = slotsRef.current.slots;

    // The payload's own bbox — which `extractWorldMesh` computes from the
    // vertices it emitted, because every retail zCMesh stores that box as all
    // zeros and a copied one hands the viewport a world with no size.
    const box = zenBoxToThree(bbox);
    const span = Math.max(box.size[0], box.size[2]) || 10;

    // ── the scene this payload gets (level-editor.md §7) ───────────────────
    //
    // `world/SceneHost` owns it (#220): the `WorldScene`, the world mesh's BVH
    // trees and the GPU picker — which is exactly the set of things a
    // structural op rebuilds. The decoded pixels and the builder's memory of
    // the trees are handed in rather than made here, because they are what has
    // to survive that rebuild.
    const sceneHost = new SceneHost({
      scene,
      renderer,
      camera,
      mesh,
      visuals,
      // Through the ref, for the reason the prop's own comment gives: the index
      // arrives one commit ahead of the visuals a rebuild is keyed on.
      vobIndex: vobIndexRef.current,
      textures: texturesRef.current,
      bvh: bvhRef.current ?? (bvhRef.current = new BvhBuilder()),
      // Through the refs, so a parent re-render cannot rebuild the scene.
      loadTexture: (name, maxSize) => loadTextureRef.current(name, maxSize),
      onTextureFailures: (names) => textureFailuresRef.current?.(names),
    });
    const { world, picker } = sceneHost;
    sceneRef.current = world;

    // Where the last click landed, in three space, or null before the first
    // one. The fallback pivot for a drag that begins over the sky.
    let lastPick: THREE.Vector3 | null = null;
    const pivotUnderCursor = (event: PointerEvent, nav: Exclude<Nav, 'none'>) => {
      // An orbit turns *about* the pivot, so it must not move it — re-centring
      // here is what threw away every pivot a double-click set, the orbit
      // being the very press it was aiming (§16.12). Dolly and pan only read
      // the distance to it, so they keep the ambient behaviour.
      if (nav === 'orbit') return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      // The world mesh only. The props are GPU ID-picked, which answers a VOB
      // id asynchronously — no point, and a frame too late to pivot a drag that
      // has already begun. A CPU raycast across the 724 InstancedMeshes is the
      // 14.2 ms this viewport exists to avoid. Terrain, buildings and cave
      // walls are all world mesh, so an interior pivots on the wall in front of
      // the camera either way.
      const hit = raycaster.intersectObjects(world.worldMeshes, false)[0];
      const at = hit ? hit.point : lastPick;
      if (at !== null) pivotAt(camera, controls.target, at);
    };

    // Where a double-click last set the pivot — the dot that confirms it
    // landed somewhere, since `pivotAt` itself moves nothing a screenshot
    // could tell apart from before. Set only by a double-click, replaced
    // rather than moved for the same reason `TerrainMarker`'s own comment
    // gives: a click is not a frame.
    let pivotMarker: TerrainMarker | null = null;
    const setPivotMarker = (point: [number, number, number]) => {
      if (pivotMarker) { world.root.remove(pivotMarker.root); pivotMarker.dispose(); }
      pivotMarker = new TerrainMarker(point, { color: PIVOT_COLOR, size: PIVOT_SIZE });
      world.root.add(pivotMarker.root);
      pivotMarkerRef.current = { key: worldKey, point };
    };

    // Blender's mapping: the middle button navigates (Alt+left stands in for it
    // on a trackpad, see below), the left one selects —
    // and a navigation press first moves the pivot onto what is under the
    // cursor, so the dolly step, the pan speed and the orbit radius are all
    // scaled by the distance to *that* rather than to the middle of the island.
    const detachNav = attachBlenderNav(controls, host, pivotUnderCursor);

    // A structural op — placing a VOB — cannot be applied to the columnar
    // projection, so the scene is rebuilt from the world (level-editor.md §7)
    // and this effect runs again. Re-framing here would throw away the view the
    // placement was aimed from, which is the one view the user needs in order
    // to see whether it landed — so only a world the camera has not been in is
    // framed, and the rest of the time the camera is simply left where it is.
    if (framedRef.current !== worldKey) {
      framedRef.current = worldKey;
      viewport.frameWorld(box.center, span);
    }
    // The marker hangs on the scene's root, so it does not survive the rebuild
    // by itself — it is put back, keyed on the world the same way.
    if (pivotMarkerRef.current?.key === worldKey) setPivotMarker(pivotMarkerRef.current.point);
    controls.update();


    // ── the gizmo (level-editor.md §7, Phase 1b) ────────────────────────────
    //
    // `world/GizmoController` owns it (#220): the proxy under the mirrored
    // root, the `TransformControls`, the snap, the live preview and both
    // commits. It takes the scene and the overlay it drives and hands back a
    // delta.
    const gizmo = new GizmoController({
      camera,
      canvas: renderer.domElement,
      // The **top-level** scene for the helper, never `world.root` — through
      // that 0.01 scale and mirror the handles would be unusable.
      scene,
      world,
      controls,
      // Read per call: a rebuild replaces the overlay, and it is null whenever
      // the waynet is not drawn.
      overlay: () => overlayRef.current,
      mode: gizmoModeRef.current,
      snapGrid: () => snapGridRef.current,
      snapAngle: () => snapAngleRef.current,
      onTranslate: (delta) => onTranslateRef.current(delta),
      onRotate: (delta) => onRotateRef.current(delta),
      onMoveWaypoint: (waypoint, from, to) => onMoveWaypointRef.current(waypoint, from, to),
    });
    gizmoRef.current = gizmo;

    // ── the emulated middle button ──────────────────────────────────────────
    //
    // Alt+left navigates, because a trackpad has no middle button
    // (`cameraNav`). It is the one navigation gesture that shares the left
    // button, so it is the only one that collides with what the left button
    // otherwise does, and both collisions are settled here:
    //
    //   - the browser ends it with a `click` on the canvas — a real middle
    //     button fires `auxclick`, which nothing here listens for — and that
    //     click would pick, so every orbit on a trackpad would throw away the
    //     selection it was orbiting. `navigated` is what the click reads.
    //     Unlike `endedDrag` it is *cleared by the next left press* rather than
    //     only by the click it belongs to: the nav press is `preventDefault`ed
    //     (Chromium's autoscroll), and a prevented pointerdown is allowed to
    //     suppress the compatibility events that follow it — so a flag that
    //     only a click could clear could be left standing and would then eat a
    //     real selection.
    //   - a press that lands on a gizmo axis would drag the VOB *and* the
    //     camera. The gizmo is switched off for the length of the drag, and
    //     given back the state it had rather than a guessed one, since what
    //     `enabled` means here is "something is selected" (`attach`/`detach`).
    //
    // A right press is a fly (`NavController`, below), and it lands on the
    // gizmo the same way, so it switches it off the same way.
    let navigated = false;
    let gizmoBeforeNav: boolean | null = null;
    const onNavPointerDown = (event: PointerEvent) => {
      // Under pointer lock the buttons still fire, at frozen coordinates.
      if (nav.walking()) return;
      if (event.button === 0) {
        navigated = navFor(event) !== 'none';
        if (!navigated) return;
      } else if (event.button !== 2) return;
      gizmoBeforeNav = gizmo.enabled;
      gizmo.enabled = false;
    };
    const onNavPointerUp = () => {
      if (gizmoBeforeNav === null) return;
      gizmo.enabled = gizmoBeforeNav;
      gizmoBeforeNav = null;
    };
    // Capture on `host`, ahead of both OrbitControls and the gizmo, for the
    // same ordering reason `attachBlenderNav` gives.
    host.addEventListener('pointerdown', onNavPointerDown, { capture: true });
    host.addEventListener('pointerup', onNavPointerUp, { capture: true });
    host.addEventListener('pointercancel', onNavPointerUp, { capture: true });

    /** Remember where a click landed, so a later drag over the sky still has a
     *  pivot to fall back on. */
    const rememberPick = (at: THREE.Vector3) => {
      lastPick = (lastPick ?? new THREE.Vector3()).copy(at);
    };

    // ── the scatter brush (level-editor.md §16.25) ──────────────────────────
    //
    // The brush itself is `world/ScatterBrush` (#220): it owns the ring, its
    // own raycaster and its three pointer handlers, and takes what it cannot
    // own — the meshes, the gizmo, the radius — as accessors.
    const scatterBrush = new ScatterBrush({
      host,
      canvas: renderer.domElement,
      camera,
      root: world.root,
      // Read per ray rather than captured: a structural op replaces them.
      worldMeshes: () => world.worldMeshes,
      radius: () => scatterRadiusRef.current,
      // A walk's press is not a stroke.
      walking: () => nav.walking(),
      gizmo,
      onStroke: (samples) => onScatterStrokeRef.current(samples as [number, number, number][]),
    });
    scatterBrushRef.current = scatterBrush;
    scatterBrush.attach();

    // ── what a click means (level-editor.md §3, §16.12, §17) ────────────────
    //
    // `world/PickController` owns the three handlers (#220). The order they
    // try things in is the whole of what is interesting about them — waynet,
    // then props, then world mesh for a click; mesh then props for a
    // double-click; props only for a right-click — and each also has to know
    // when the click it is looking at is the tail of some other gesture.
    const picks = new PickController({
      renderer,
      camera,
      world,
      picker,
      controls,
      // Shared rather than duplicated: the navigation pivot, the fly, the walk
      // and the measurement probe all read this pair.
      raycaster,
      pointer,
      waynet: () => overlayRef.current,
      showWaynet: () => showWaynetRef.current,
      disposed: () => sceneHost.isDisposed(),
      walking: () => nav.walking(),
      consumeGesture: () => {
        // A finished gizmo drag: picking here would select whatever is behind
        // the gizmo — usually nothing — and deselect the VOB it just moved.
        if (gizmo.consumeEndedDrag()) return true;
        // The same, for a drag of the camera on the emulated middle button.
        if (navigated) { navigated = false; return true; }
        // And the same for a brush stroke, which ends on the canvas exactly as
        // a gizmo drag does — a stroke that deselected the palette it had just
        // painted with would make a second stroke impossible.
        return scatterBrush.consumePainted();
      },
      consumeFly: () => nav.consumeFly(),
      contextMenu: () => onVobContextMenuRef.current,
      onPick: (vob, terrain, additive) => {
        // The outline is the answer to one click in the Problems panel, not a
        // layer the user turned on: the next thing they touch in the viewport
        // is them moving on from it (#222).
        world.hidePortal();
        onPickRef.current(vob, terrain, additive);
      },
      onSelectWaypoint: (waypoint) => onSelectWaypointRef.current(waypoint),
      rememberPick,
      onPivot: (at, zen) => {
        rememberPick(at);
        setPivotMarker(zen);
      },
    });
    picks.attach();

    // ── moving the camera (level-editor.md §16.26 row 3) ───────────────────
    //
    // `world/NavController` owns both navigations (#220): the right-button fly,
    // the F3 walk under pointer lock, the camera slots and the framing keys.
    // What is interesting about them is the wiring — which of the two owns the
    // camera on a frame, what a mode switch stands down and gives back, and
    // where each leaves the pivot — and none of it was reachable without a
    // whole mocked viewport.
    //
    // It takes what it cannot own: the world meshes it probes, the gizmo it
    // stands down for a walk, this world's slots, and the framing the surface
    // defines below.
    const nav = new NavController({
      host,
      canvas: renderer.domElement,
      camera,
      controls,
      gizmo,
      // Shared rather than duplicated, as `PickController` shares them.
      raycaster,
      pointer,
      // Read per probe rather than captured: a structural op replaces them.
      worldMeshes: () => world.worldMeshes,
      slots: cameraSlots,
      // Where a walk's entry search gives up: the world's own top.
      ceiling: box.max[1],
      paused: () => pausedRef.current,
      rememberPick,
      onCameraSlot: (outcome, slot) => cameraSlotRef.current?.(outcome, slot),
      // Defined below, and called through the closure for that reason.
      frameSelection: () => { frameSelection(); },
      frameAll: () => { frameAll(); },
    });
    nav.attach();

    // Blender's framing keys, and the reason orbiting is usable at all: the
    // pivot starts at the centre of a 600 m island, so without a way to move it
    // onto what you are looking at, every orbit up close swings the camera
    // through half the world. `NavController` binds them; what they *do* is
    // here, where the selection and the world's own box are.
    const frameFramables = (
      framable: Array<{ at: [number, number, number]; bounds: readonly number[] | null }>,
    ): FrameFailure | null => {
      const center = frameVobs(camera, controls.target, framable);
      // The pivot `frameVobs` left on them is `controls.target`; this is the
      // other one — the fallback a drag begun over the sky uses. Without it the
      // first orbit after a jump swings back to wherever the last click landed,
      // which is the whole complaint the pivot work exists to answer.
      if (center !== null) rememberPick(center);
      // Reported rather than swallowed, so a locator that cannot locate says so
      // — see `FrameFailure`.
      return center === null ? 'not-drawn' : null;
    };

    const frameThese = (vobs: readonly number[]): FrameFailure | null => {
      // A VOB the scene draws nothing for has no position to frame — a decal, a
      // particle effect — and a selection can be nothing but those. A sound VOB
      // is no longer one of them: it has a marker, and `positionOf` answers for
      // it (§16.38).
      const framable = vobs
        .map((vob) => ({ at: world.positionOf(vob), bounds: world.boundsOf(vob) }))
        .filter((vob): vob is { at: [number, number, number]; bounds: readonly number[] | null } => vob.at !== null);

      return frameFramables(framable);
    };

    const frameSelection = () => frameThese(selectionRef.current);
    frameVobRef.current = (vob: number) => frameThese([vob]);
    // A waypoint carries its own position and has no size: `bounds: null` is
    // what `frameVobs` already reads as "a point".
    framePointRef.current = (at: ZenPosition) => frameFramables([{ at, bounds: null }]);
    // Drawn first, then framed off what was drawn — one call answers both, so
    // the outline and the camera can never disagree about which polygon this
    // is. A polygon too degenerate to draw is `not-drawn`, the same answer a
    // VOB the scene places nothing for gets.
    framePolygonRef.current = (corners) => {
      const framed = world.showPortal(corners);
      return framed === null ? 'not-drawn' : frameFramables([framed]);
    };
    // Same math as `window.__worldViewport.cameraPosition()` below — this is
    // the production path, that one is the debug/test double for scripting
    // the viewport without a ref.
    cameraPositionRef.current = () => threeToZen(camera.position.toArray() as [number, number, number]);

    const frameAll = () => {
      frameOn(
        camera, controls.target, new THREE.Vector3(...box.center),
        Math.max(box.size[0], box.size[1], box.size[2]) / 2,
      );
    };

    // The loop is started and stopped through this pair rather than by calling
    // `draw` directly: `paused` stops it while the surface is off screen, and
    // the benchmark and the screenshot both stop it for the length of a fixed
    // camera path. Both callers must leave it in the state they found it, and a
    // second `start` on a running loop would leave an orphaned frame behind
    // that no `cancelAnimationFrame` can reach.
    let frame = 0;
    let running = false;
    // Scratch for the label pass, separate from the pick's: this runs in the
    // draw loop and the pick runs from an event, and sharing one matrix would
    // couple them for no gain.
    const labelClip = new THREE.Matrix4();
    // The camera's own position, one root-inverse away from `positions`'
    // raw ZenGin space — `chooseWaypointLabels` ranks by true distance from
    // the camera, and `camera.position` lives in Three's mirrored, scaled
    // world space instead. `world.root`'s matrix (zen-world's `ROOT_MATRIX`)
    // is a mirror plus a uniform scale, so distance ordering computed here
    // matches ordering by true distance in Three space.
    const labelRootInverse = new THREE.Matrix4();
    const labelCameraPosition = new THREE.Vector3();
    const draw = () => {
      frame = requestAnimationFrame(draw);
      // A fly or a walk writes the camera itself, and OrbitControls would
      // re-aim at a target neither of them is moving.
      if (!nav.step(performance.now())) controls.update();

      // Names, after `controls.update()` so they follow the camera in the same
      // frame it moved rather than trailing it by one.
      //
      // It projects every waypoint — the same loop `pickWaypoint` runs, which
      // its comment calls out as a per-click cost. Per frame it is ~3,000
      // Vector4 transforms, tens of microseconds against a 16 ms budget, and it
      // only runs while the layer is on. `chooseWaypointLabels` caps what
      // reaches the DOM, so the write side does not grow with the world.
      const labels = labelLayerRef.current;
      const netOverlay = overlayRef.current;
      if (labels !== null && netOverlay !== null && showNamesRef.current) {
        // What is drawn, not what exists: the whole waynet when it is on, and
        // otherwise only the points the spawn layer is marking.
        const candidates = showWaynetRef.current
          ? null
          : (showSpawnsRef.current && spawnOverlayRef.current !== null)
            ? spawnOverlayRef.current.labelledPoints
            : [];
        camera.updateMatrixWorld();
        world.root.updateMatrixWorld();
        labelCameraPosition.copy(camera.position)
          .applyMatrix4(labelRootInverse.copy(world.root.matrixWorld).invert());
        labels.update(chooseWaypointLabels(
          netOverlay.positions,
          candidates,
          labelClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
            .multiply(world.root.matrixWorld),
          labelCameraPosition,
          host.clientWidth || 1,
          host.clientHeight || 1,
        ));
      }

      viewport.render();
    };
    const startDraw = () => {
      if (running || pausedRef.current) return;
      running = true;
      draw();
    };
    const stopDraw = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
    };
    drawLoopRef.current = { start: startDraw, stop: stopDraw };
    startDraw();

    // ── the measurement handle (level-editor.md §3) ─────────────────────────
    // Framerate, draw calls per frame and pick latency are the budget rows that
    // still rest on the spike's numbers, and they can only be answered by the
    // scene above: the spike measured a scene the app does not own. So the live
    // renderer, camera, picker and BVH are handed to `runViewportBenchmark` as
    // a probe, exactly as `window.__spike` exposed the spike's.
    const gl = renderer.getContext();
    const pickPointer = new THREE.Vector2();
    const target = new THREE.Vector3();
    const allMeshes: THREE.Object3D[] = [...world.worldMeshes, ...world.instancedMeshes];

    const probe: ViewportProbe = {
      moveCamera: (pose) => {
        camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
        camera.lookAt(target.set(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]));
      },
      render: () => { viewport.render(); },
      finishGpu: () => gl.finish(),
      drawCalls: () => renderer.info.render.calls,
      triangles: () => renderer.info.render.triangles,
      raycastWorldMesh: (x, y) => {
        raycaster.setFromCamera(pickPointer.set(x, y), camera);
        return raycaster.intersectObjects(world.worldMeshes, false).length > 0;
      },
      raycastWholeScene: (x, y) => {
        raycaster.setFromCamera(pickPointer.set(x, y), camera);
        return raycaster.intersectObjects(allMeshes, false).length > 0;
      },
      pickVobs: async (x, y) => {
        const width = renderer.domElement.width;
        const height = renderer.domElement.height;
        const vob = await picker.pickAsync(
          renderer, camera, ((x + 1) / 2) * width, ((1 - y) / 2) * height, width, height,
        );
        return vob !== NO_PICK;
      },
      viewportSize: () => ({ width: renderer.domElement.width, height: renderer.domElement.height }),
    };

    const benchmark = async (options?: Partial<BenchmarkOptions>): Promise<BenchmarkResult> => {
      // A half-loaded scene is a different scene: the BVH decides the terrain
      // pick and the textures decide what the GPU actually samples.
      await sceneHost.ready;

      // The draw loop and OrbitControls both write the camera every frame, and
      // the sweep's whole point is that the camera follows a fixed path.
      stopDraw();
      controls.enabled = false;
      try {
        return await runViewportBenchmark(probe, {
          now: () => performance.now(),
          requestFrame: (callback) => { requestAnimationFrame(() => callback()); },
          setTimer: (callback, ms) => { setTimeout(callback, ms); },
          visible: () => document.visibilityState === 'visible',
          focused: () => document.hasFocus(),
          yieldToBrowser: () => new Promise<void>((resolve) => { setTimeout(resolve, 0); }),
        }, {
          centre: box.center as [number, number, number],
          span,
          ...options,
        });
      } finally {
        controls.enabled = true;
        controls.update();
        startDraw();
      }
    };

    window.__worldViewport = {
      benchmark,
      dragGizmo: (to) => gizmo.dragTo(to),
      turnGizmo: (axis, radians) => gizmo.turnBy(axis, radians),
      // A click that hit the world mesh rather than a VOB, in ZenGin space.
      // What it stands in for is precisely the BVH raycast that turns a pixel
      // into a point — everything above it, including the surface's placement
      // flow, is the real thing.
      pickTerrain: (point) => onPickRef.current(null, point, false),
      // A click that hit a waypoint in the overlay. It stands in for precisely
      // the projection in `pickWaypoint` — turning a pixel into an index — and
      // everything below it, including the gizmo, is the real thing.
      pickWaypoint: (waypoint) => onSelectWaypointRef.current(waypoint),
      renderFrom: async (from, at) => {
        // A half-loaded scene is a different scene, and an untextured material
        // draws its flat colour — which a pixel check would read as ground that
        // is not there. Awaited rather than slept on, like `benchmark`.
        await sceneHost.ready;

        // The draw loop and OrbitControls both write the camera every frame.
        stopDraw();
        controls.enabled = false;
        try {
          camera.position.set(...zenToThree(from));
          camera.lookAt(target.set(...zenToThree(at)));
          camera.updateMatrixWorld();
          viewport.render();

          // The default framebuffer, read in the same task as the render that
          // filled it — the pixels a human would have screenshotted.
          const { width, height } = renderer.domElement;
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

          let binary = '';
          for (let i = 0; i < pixels.length; i += 4096) {
            binary += String.fromCharCode(...pixels.subarray(i, i + 4096));
          }
          return { width, height, rgba: btoa(binary) };
        } finally {
          controls.enabled = true;
          startDraw();
        }
      },
      gizmoRotation: () => gizmo.rotation(),
      gizmoPosition: () => gizmo.position(),
      selectedInstances: () => world.instancedMeshes.flatMap((instanced) => [
        ...(instanced.geometry.getAttribute(SELECTED_ATTRIBUTE).array as Float32Array),
      ]),
      cameraTarget: () => threeToZen(controls.target.toArray() as [number, number, number]),
      cameraPosition: () => threeToZen(camera.position.toArray() as [number, number, number]),
      // Reports the marker that is actually *in the scene*, not merely the
      // point remembered for the next rebuild: reading the ref alone would
      // stay green with the `world.root.add` deleted, and drawing the dot is
      // the whole of what this feature is for.
      pivotMarkerPoint: () => (
        pivotMarker !== null
        && pivotMarker.root.parent === world.root
        && pivotMarkerRef.current?.key === worldKey
          ? pivotMarkerRef.current.point
          : null
      ),
    };

    return () => {
      // First: a walk left standing would keep the pointer lock and hand the
      // rebuilt scene a camera it never re-seated, which `dispose` does before
      // anything else for that reason.
      nav.dispose();
      sceneRef.current = null;
      gizmoRef.current = null;
      frameVobRef.current = null;
      framePointRef.current = null;
      framePolygonRef.current = null;
      cameraPositionRef.current = null;
      delete window.__worldViewport;
      drawLoopRef.current = null;
      stopDraw();
      picks.dispose();
      detachNav();
      host.removeEventListener('pointerdown', onNavPointerDown, { capture: true });
      host.removeEventListener('pointerup', onNavPointerUp, { capture: true });
      host.removeEventListener('pointercancel', onNavPointerUp, { capture: true });
      scatterBrushRef.current = null;
      scatterBrush.dispose();
      gizmo.dispose();
      pivotMarker?.dispose();
      sceneHost.dispose();
      // The renderer, the canvas, the outline pass, the camera and the controls
      // are deliberately not touched here — see `ViewportRenderer`, and the
      // effect below, which is where they go.
    };
    // Re-run whenever a payload arrives — the callbacks are read through refs
    // precisely so they are not dependencies. A structural op brings new
    // `visuals`, which is a rebuild of the scene and of nothing above it: the
    // renderer, its GL context, the canvas, the outline pass and the camera all
    // belong to `ViewportRenderer` now (review §3.2).
    //
    // Keyed on the bbox's *value*, never the array's identity: every structural
    // op re-reads the index and the summary comes back structured-cloned from
    // the main process, so `summary.bbox` is a fresh array of the same six
    // numbers each time — and it arrives one commit before the new visuals do,
    // which is what used to make the rebuild happen twice per op. `bbox` itself
    // is therefore deliberately not a dependency: `bboxKey` is the same
    // information by value, and the array identity is the thing being kept out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh, visuals, bboxKey]);

  // The other half of the scene effect's lifetime. Declared after it so that
  // its cleanup runs after the scene's — React unmounts effects in the order
  // they were declared, and the scene has to be disposed while the context that
  // uploaded it is still there.
  useEffect(() => () => {
    viewportRef.current?.dispose();
    viewportRef.current = null;
  }, []);

  // Going off screen stops the loop; coming back starts it again. Deliberately
  // not a dependency of the scene effect above: `paused` flips on every tab
  // switch and rebuilding the scene for it is the cost the mount was kept for.
  useEffect(() => {
    const loop = drawLoopRef.current;
    if (loop === null) return;
    if (paused) loop.stop(); else loop.start();
  }, [paused, mesh, visuals, bboxKey]);

  // The overlay lives and dies on its own, under the scene's converted root so
  // it needs no conversion of its own. `mesh` and `visuals` are dependencies
  // because a new world — and a structural op, which rebuilds the scene from
  // `visuals` alone — means a new root to hang it under, not because the waynet
  // changed. Without `visuals` the rebuild leaves the overlay on a root that
  // has been disposed and the waynet silently vanishes until it is toggled off
  // and on; the terrain marker below takes it for exactly the same reason.
  useEffect(() => {
    const world = sceneRef.current;
    if (world === null || waynet === null) return;

    const overlay = new WaynetOverlay(waynet);
    overlayRef.current = overlay;
    world.root.add(overlay.root);

    return () => {
      world.root.remove(overlay.root);
      overlay.dispose();
      overlayRef.current = null;
    };
  }, [waynet, mesh, visuals]);

  // The same dependencies as the effect above, because a rebuilt overlay is a
  // fresh one and `WaynetOverlay` starts hidden: without `visuals` a structural
  // op re-attaches the waynet and never shows it, which looks the same as not
  // re-attaching it at all.
  useEffect(() => {
    overlayRef.current?.setVisible(showWaynet);
  }, [showWaynet, waynet, mesh, visuals]);

  // The name layer. DOM over the canvas rather than anything in the scene, so
  // it is not tied to `mesh`/`visuals` the way the overlays are — a structural
  // op rebuilds the scene and leaves this alone. It follows `waynet` because
  // the names are the payload's.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || waynet === null) return;

    // Who is standing there, read through the refs rather than closed over:
    // this layer outlives the spawn overlay — a structural op rebuilds that one
    // and leaves this alone — and the occupancy changes under both on every
    // tick of the time slider. Nobody, with the spawn layer off: occupancy is
    // that layer's fact, and a name over a point it is not marking would be a
    // claim nothing on screen supports (§16.19 slice 14).
    const layer = new WaypointLabelLayer(waynet.names, (waypoint) => (
      showSpawnsRef.current && spawnOverlayRef.current !== null
        ? spawnOverlayRef.current.occupantsAt(waypoint)
        : []
    ));
    layer.setVisible(false);
    labelLayerRef.current = layer;
    host.appendChild(layer.root);

    return () => {
      layer.dispose();
      labelLayerRef.current = null;
    };
  }, [waynet]);

  useEffect(() => {
    labelLayerRef.current?.setVisible(showWaypointNames);
    // A layer switched off keeps whatever the last frame left in it, and the
    // draw loop stops updating it — so it is cleared here rather than left to
    // reappear stale when it comes back on.
    if (!showWaypointNames) labelLayerRef.current?.update([]);
  }, [showWaypointNames, waynet]);

  // The spawn markers, built and torn down exactly like the waynet above and
  // for the same reasons — including `visuals`, or a structural op leaves them
  // on a root that has been disposed. `spawns` is a dependency because the
  // markers are resolved once, at construction: the project index arrives after
  // the world on a cold start, and an overlay built against the empty index
  // would stay empty.
  useEffect(() => {
    const world = sceneRef.current;
    if (world === null || waynet === null) return;

    const overlay = new SpawnOverlay(waynet, spawns, routines);
    spawnOverlayRef.current = overlay;
    world.root.add(overlay.root);

    return () => {
      world.root.remove(overlay.root);
      overlay.dispose();
      spawnOverlayRef.current = null;
    };
  }, [waynet, spawns, routines, mesh, visuals]);

  useEffect(() => {
    spawnOverlayRef.current?.setVisible(showSpawns);
  }, [showSpawns, waynet, spawns, routines, mesh, visuals]);

  // The same rebuild dependencies as the two above, and for the third time the
  // same reason: a fresh overlay draws the static spawns, so without them a
  // structural op silently resets an open slider to no time at all.
  useEffect(() => {
    spawnOverlayRef.current?.setTime(spawnTime, spawnState);
  }, [spawnTime, spawnState, waynet, spawns, routines, mesh, visuals]);

  // The marker for the picked point, built and torn down exactly like the
  // overlay above — under the scene's converted root, so it needs no conversion
  // of its own. `mesh` and `visuals` are dependencies because a structural op
  // rebuilds the scene and with it the root this hangs under, not because the
  // point changed; without them the marker is left on a scene that has been
  // disposed, which is precisely the placement it was drawn for. Built per
  // point rather than moved: a click is not a frame, and this way the point
  // that is gone takes its geometry with it.
  useEffect(() => {
    const world = sceneRef.current;
    if (world === null || terrainPoint === null) return;

    const marker = new TerrainMarker(terrainPoint);
    world.root.add(marker.root);

    return () => {
      world.root.remove(marker.root);
      marker.dispose();
    };
  }, [terrainPoint, mesh, visuals]);

  // The gizmo follows the selection. `mesh` is a dependency because a new
  // world's scene is a new gizmo, not because the selection changed.
  //
  // A waypoint wins when there is one, and the store guarantees there is never
  // both — but the order is written down rather than left to that guarantee,
  // because the two arrive as separate props and a render between the two sets
  // would otherwise decide it.
  useEffect(() => {
    if (selectedWaypoint !== null) gizmoRef.current?.attachWaypoint(selectedWaypoint);
    else gizmoRef.current?.attach(selection);
    // `waynet` is a dependency because the overlay is what a waypoint's position
    // is read from, and it arrives after a waypoint can be selected: the payload
    // is fetched the first time the overlay is switched on.
  }, [selection, selectedWaypoint, waynet, mesh, visuals]);

  useEffect(() => {
    gizmoRef.current?.setMode(gizmoMode);
  }, [gizmoMode, mesh, visuals]);

  // The ring is drawn by the pointer handler and can only be *un*drawn from
  // here: switching the brush off is a prop change, and the cursor may never
  // move again afterwards. Without this the footprint of a brush that is no
  // longer active stays on the ground.
  useEffect(() => {
    if (scatterRadius === null) scatterBrushRef.current?.hide();
  }, [scatterRadius, mesh, visuals]);

  // Brightness. One uniform write for the whole scene, picked up by the next
  // frame the render loop draws — no recompile, and nothing to invalidate, so a
  // slider drag costs one assignment per pointer move.
  //
  // `mesh` and `visuals` are dependencies for the reason the waynet's
  // visibility effect gives: a structural op rebuilds the scene, and a fresh
  // `WorldScene` starts at `DEFAULT_EXPOSURE` — without them a world placed
  // with the brightness turned up would snap back to unchanged.
  useEffect(() => {
    sceneRef.current?.setExposure(exposure);
  }, [exposure, mesh, visuals]);

  // Which VOBs are outlined. One uniform write — and unlike the brightness
  // above it, not on `mesh`/`visuals`: the outline pass belongs to the viewport
  // rather than to the scene, so a structural op leaves its uniform standing.
  useEffect(() => {
    viewportRef.current?.outline.setMode(outlineMode);
  }, [outlineMode]);

  // Per-class visibility, on `mesh`/`visuals` for the same reason: a rebuilt
  // scene draws every instance until it is told again which ones are switched
  // off, and a placement would otherwise bring a hidden class back.
  useEffect(() => {
    sceneRef.current?.setHiddenVobs(hiddenVobs);
  }, [hiddenVobs, mesh, visuals]);

  // The selection, drawn on the VOBs themselves (§16.24 1) — the gizmo is one
  // set of handles and says nothing about the other members of a multi-select,
  // or about a selected VOB whose gizmo is off screen. `mesh`/`visuals` for the
  // reason every effect above them takes them: a rebuilt scene starts with
  // nothing marked.
  useEffect(() => {
    sceneRef.current?.setSelectedVobs(selection);
  }, [selection, mesh, visuals]);

  // The selected VOB's reach (architecture §7). On `mesh`/`visuals` for the reason the
  // effects above take them, and on `appliedOps` as well: the radius is a field
  // an op writes and the VOB is something a move takes elsewhere, so the sphere
  // has to be redrawn from the committed position rather than the one it was
  // first drawn at.
  useEffect(() => {
    const world = sceneRef.current;
    if (world === null) return;
    if (selectedExtent === null) world.hideExtent();
    else world.showExtent(selectedExtent.vob, selectedExtent.extent);
  }, [selectedExtent, mesh, visuals, appliedOps]);

  // The same selection, lit rather than outlined (#256). Its own effect and not
  // the sphere's, because the toggle is a view setting the sphere has no say
  // in — and on the same dependencies for the same reasons, `appliedOps`
  // included: a light that was dragged lights where it is now.
  useEffect(() => {
    sceneRef.current?.setLightPreview(lightPreview ? selectedExtent : null);
  }, [lightPreview, selectedExtent, mesh, visuals, appliedOps]);

  // An edit the main process has taken — a commit, an undo, a redo, or the
  // reversal of a refused one. The scene is a projection and has to follow it;
  // the gizmo has to follow the VOB it is attached to, or it is left floating
  // where the VOB used to be.
  useEffect(() => {
    const world = sceneRef.current;
    if (world === null || appliedOps === null) return;

    // The World surface has already written the waynet payload — which is this
    // buffer — through `applyWaypointPositions`. All that is left is the upload,
    // and putting the gizmo back on the waypoint if it was the one that moved:
    // an undo of a waypoint drag otherwise leaves it floating where the
    // waypoint used to be.
    if (appliedOps.some(isWaynetOp)) {
      overlayRef.current?.refresh();
      // The markers copy the waypoint positions rather than drawing the payload
      // itself, so a moved waypoint leaves them behind without this.
      spawnOverlayRef.current?.refresh();
      if (selectedWaypoint !== null) gizmoRef.current?.attachWaypoint(selectedWaypoint);
    }

    for (const op of appliedOps) {
      if (op.op === 'RotateVob') world.rotateVob(op.vob, op.to);
      else if (op.op === 'MoveVob') world.moveVob(op.vob, op.to);
      // A property op moves nothing: the name and the flags are not drawn at
      // all, and a swapped visual is a different mesh in a different
      // `InstancedMesh` rather than a matrix to rewrite. The surface re-requests
      // the instanced visuals for that one, which rebuilds the scene — there is
      // no in-place edit of it that would be correct.
    }
    // The gizmo has to follow the VOBs it is attached to, or it is left
    // floating where they used to be — an undo of a multi-select drag moves
    // every one of them.
    // A waynet op has no `vob` and moves nothing the gizmo is ever attached to,
    // so it is excluded here rather than defaulted: `selection.includes(
    // undefined)` is false by luck rather than by intent, and the next op
    // without a `vob` might not be so harmless.
    if (appliedOps.some((op) => !isWaynetOp(op) && selection.includes(op.vob))) {
      gizmoRef.current?.attach(selection);
    }
    // `selection` is deliberately not a dependency: this effect is about ops
    // arriving, and re-running it on a selection change would re-apply them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedOps]);

  // `position: relative` is what the name layer's absolute positioning resolves
  // against — without it the labels are placed against the page.
  return (
    <Box
      ref={hostRef}
      data-testid="world-viewport"
      sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}
    />
  );
});

WorldViewport.displayName = 'WorldViewport';

export default WorldViewport;
