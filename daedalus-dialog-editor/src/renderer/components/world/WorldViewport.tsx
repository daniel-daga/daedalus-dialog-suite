import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { Box } from '@mui/material';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast } from 'three-mesh-bvh';
import {
  multiplyRotation, mirrorRotation, threeToZen, zenToThree, zenBoxToThree,
  isWaynetOp, type ZenPosition, type ZenRotation,
} from 'zen-world';
import type {
  DecodedTexture, InstancedPayload, WaynetPayload, WorldMeshPayload, WorldOp,
} from '../../../shared/worldTypes';
import type { SpawnSite } from '../../../shared/types';
import { DampedTransformControls } from '../../world/DampedTransformControls';
import { WaynetOverlay } from '../../world/WaynetOverlay';
import { SpawnOverlay } from '../../world/SpawnOverlay';
import type { RoutineIndex } from '../../routines/routineSchedule';
import { TerrainMarker, PIVOT_COLOR, PIVOT_SIZE } from '../../world/TerrainMarker';
import { ScatterRing } from '../../world/ScatterRing';
import {
  SELECTED_ATTRIBUTE, WorldScene, textureCacheFor, type TextureCache,
} from '../../world/WorldScene';
import { VobOutline } from '../../world/VobOutline';
import { BvhBuilder } from '../../world/BvhBuilder';
import { VobPicker } from '../../world/VobPicker';
import { NO_PICK } from '../../world/pickIds';
import { pickWaypoint, NO_WAYPOINT } from '../../world/pickWaypoint';
import { chooseWaypointLabels } from '../../world/waypointLabels';
import { WaypointLabelLayer } from '../../world/WaypointLabelLayer';
import {
  attachBlenderNav, frameOn, frameVobs, navFor, pivotAt, type Nav,
} from '../../world/cameraNav';
import { Fly, flyMoveFor, flySpeedFor, pivotAhead } from '../../world/flyNav';
import { Walk, walkMoveFor, findWalkEntry, WALK_EXIT_PIVOT_DISTANCE } from '../../world/walkNav';
import { CameraSlots, cameraSlotFor } from '../../world/cameraSlots';
import { snapDelta, snapTurn } from '../../world/snapping';
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

/** Textures are decoded at this cap by picking a mipmap rather than resampling.
 *  Every NewWorld texture at full size is ~490 MB of RGBA; the spike's measured
 *  scene used 256 and 96 MB. */
const TEXTURE_MAX_SIZE = 256;

export interface WorldViewportProps {
  mesh: WorldMeshPayload;
  visuals: InstancedPayload;
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

export type GizmoMode = 'translate' | 'rotate';

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
   * has been flown somewhere else. A VOB that is not drawn (a decal, a sound
   * VOB) has no position to frame, and neither has any VOB while the scene
   * effect is between a teardown and its rebuild: both are no-ops.
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
 * for a decal or a sound VOB, and `no-scene` means the viewport was asked while
 * the scene effect was between a teardown and its rebuild.
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

/** A rotation as ZenGin reads it — row-major — out of three's column-major
 *  `Matrix4`. `elements[col * 4 + row]` is element [row][col]. */
function rowMajor(matrix: THREE.Matrix4): ZenRotation {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out.push(matrix.elements[col * 4 + row]);
  }
  return out as ZenRotation;
}

const WorldViewport = React.forwardRef<WorldViewportHandle, WorldViewportProps>(({
  mesh, visuals, bbox, waynet, showWaynet, spawns, showSpawns, routines, spawnTime, spawnState,
  showWaypointNames, loadTexture, onPick, onVobContextMenu,
  selection, onTranslateSelection, gizmoMode, onRotateSelection, appliedOps,
  selectedWaypoint, terrainPoint, exposure, hiddenVobs, snapGrid, snapAngle,
  scatterRadius, onScatterStroke,
  onSelectWaypoint, onMoveWaypoint, paused = false,
}, ref) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The overlay is built and torn down independently of the scene, so asking
  // for the waynet does not rebuild 31 MB of geometry.
  const sceneRef = useRef<WorldScene | null>(null);

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
  const scatterRingRef = useRef<ScatterRing | null>(null);
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
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  // Set by the scene effect, because the camera and the controls live inside
  // it, and cleared by its teardown — which is why the handle's `frameVob`
  // calls it through the ref rather than closing over it.
  const frameVobRef = useRef<((vob: number) => FrameFailure | null) | null>(null);
  const framePointRef = useRef<((at: ZenPosition) => FrameFailure | null) | null>(null);
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
  // Survives the scene rebuild a structural op forces — see the restore below.
  const poseRef = useRef<{
    key: string; position: number[]; target: number[];
  } | null>(null);
  // Spacer's camera slots (`cameraSlots.ts`): per world, so keyed the same way
  // as the pose and replaced when a different world arrives.
  const slotsRef = useRef<{ key: string; slots: CameraSlots } | null>(null);
  // Where a double-click last set the pivot, in ZenGin space — the dot that
  // confirms it landed somewhere, since `pivotAt` itself is otherwise
  // invisible until the next drag. Survives a same-world rebuild the same
  // way `poseRef` does, and for the same reason: the pivot itself does.
  const pivotMarkerRef = useRef<{ key: string; point: [number, number, number] } | null>(null);
  // Survives it for the same reason and keyed the same way: the pixels did not
  // change when a VOB was placed, and re-decoding all 490 of them is the 549 ms
  // the cold open pays. Owned here rather than by the scene, which is torn down
  // and rebuilt underneath it — see `TextureCache`.
  const texturesRef = useRef<TextureCache | null>(null);

  // The cache outlives every run of the scene effect, so it is released when
  // the viewport itself goes — the world being closed — and when a different
  // world arrives, which `textureCacheFor` handles below.
  useEffect(() => () => {
    texturesRef.current?.dispose();
    texturesRef.current = null;
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const scene = new THREE.Scene();
    // No `scene.background`: the outline pass owns every clear of the frame,
    // and a Scene with a background forces one of its own. The sky is its.
    const outline = new VobOutline(0x10141c);

    // The same key the camera pose is restored on, below.
    const worldKey = bbox.join(',');
    texturesRef.current = textureCacheFor(texturesRef.current, worldKey);
    if (slotsRef.current?.key !== worldKey) slotsRef.current = { key: worldKey, slots: new CameraSlots() };
    const cameraSlots = slotsRef.current.slots;

    const world = new WorldScene(texturesRef.current);
    sceneRef.current = world;
    world.setWorldMesh(mesh);
    world.setInstancedVisuals(visuals);
    scene.add(world.root);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(host.clientWidth || 1, host.clientHeight || 1);
    outline.setSize(host.clientWidth || 1, host.clientHeight || 1);
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      70, (host.clientWidth || 1) / (host.clientHeight || 1), 0.5, 4000,
    );
    // Framed from the payload's own bbox — which `extractWorldMesh` computes
    // from the vertices it emitted, because every retail zCMesh stores that box
    // as all zeros and a copied one hands the viewport a world with no size.
    const box = zenBoxToThree(bbox);
    const span = Math.max(box.size[0], box.size[2]) || 10;
    camera.position.set(
      box.center[0] + span * 0.6, box.center[1] + span * 0.35, box.center[2] + span * 0.6,
    );

    // Picking the world mesh: the pivot below reads it on every navigation
    // press, and a click reads it when nothing else was hit. Declared here
    // rather than beside the click handler because the pivot needs it first.
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    // The world mesh draws on `WORLD_LAYER` (the outline pass draws the frame
    // in two halves), and a raycaster only meets what it shares a layer with.
    raycaster.layers.enableAll();
    const pointer = new THREE.Vector2();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(box.center[0], box.center[1], box.center[2]);
    controls.enableDamping = true;

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
    // could tell apart from before. Set only by `handleDoubleClick`, replaced
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
    // projection, so the scene is rebuilt from the world (level-editor.md §7),
    // which runs this effect again and re-frames the camera from the bbox. That
    // throws away the view the placement was aimed from, which is the one view
    // the user needs to see whether it landed. So the pose survives a rebuild
    // of the *same* world, keyed on the bbox so that opening a different one
    // still frames it.
    if (poseRef.current?.key === worldKey) {
      camera.position.fromArray(poseRef.current.position);
      controls.target.fromArray(poseRef.current.target);
    }
    // The marker survives the same rebuild, and for the same reason.
    if (pivotMarkerRef.current?.key === worldKey) setPivotMarker(pivotMarkerRef.current.point);
    controls.update();

    // Only what is pickable gets a tree, and off the main thread.
    const bvh = new BvhBuilder();
    const bvhReady = Promise.all(world.worldMeshes.map((worldMesh) => bvh.build(worldMesh.geometry)));

    const picker = new VobPicker();
    picker.setInstancedMeshes(
      world.instancedMeshes,
      (instanced, instance) => world.resolveInstance(instanced, instance),
      world.root.matrix,
    );
    // Measured: the first GPU pick of a session costs 53 ms — once, 276 ms —
    // compiling the pick shader. Paying it here makes the first click cost what
    // every later one does.
    // The world mesh, depth only: without it the pick scene held the props and
    // nothing else, so no geometry wrote depth into the 1x1 target and a VOB
    // behind a wall won the pixel (§16.24 3).
    picker.setWorldMeshes(world.worldMeshes, world.root.matrix);
    picker.warm(renderer, camera);

    // Textures on demand, and only the ones the cache above does not already
    // hold — a rebuilt scene asks for nothing at all unless the edit brought a
    // visual whose texture is new.
    const texturesReady = world.loadPendingTextures(
      (name) => loadTextureRef.current(name, TEXTURE_MAX_SIZE),
      () => disposed,
    );

    // ── the gizmo (level-editor.md §7, Phase 1b) ────────────────────────────
    //
    // A VOB is an *instance*, not an Object3D, so there is nothing for
    // TransformControls to attach to. The proxy is that something: it hangs
    // under the same mirrored root as everything else, which means its local
    // position is ZenGin centimetres and reading it back needs no conversion —
    // the root stays the only one in the app.
    //
    // The gizmo's own helper goes in the top-level scene instead, or it would
    // be drawn through that same 0.01 scale and mirror.
    const proxy = new THREE.Object3D();
    world.root.add(proxy);

    // Damped rather than the library's own, because its rotate rate is a
    // turntable's — see `DampedTransformControls`.
    const transform = new DampedTransformControls(camera, renderer.domElement);
    transform.setSpace('world');
    scene.add(transform.getHelper());
    transform.enabled = false;
    transform.getHelper().visible = false;

    // What the gizmo drives, and where each of them started the drag. A
    // selection can hold VOBs that are not drawn at all — a decal, a sound VOB,
    // anything unresolved — and those have no instance to preview. They are
    // still in the batch: the op is built from the index, which knows where
    // they are, and only the preview needs an instance.
    let gizmoVobs: readonly number[] = [];
    // The other thing the gizmo can be on, and never at the same time as the
    // VOBs above. A waypoint's position is in the *same* space as the proxy's
    // local one — the overlay hangs under the same mirrored root — so unlike a
    // VOB there is nothing to convert on the way in or out.
    let gizmoWaypoint: number | null = null;
    let waypointFrom: [number, number, number] | null = null;
    const dragFrom = new Map<number, [number, number, number]>();
    const turnFrom = new Map<number, ZenRotation>();
    const proxyFrom = new THREE.Vector3();
    const proxyTurnFrom = new THREE.Quaternion();
    // Scratch, so a drag frame allocates nothing.
    const turn = new THREE.Quaternion();
    const turnMatrix = new THREE.Matrix4();
    // A drag ends with a pointerup that the browser also delivers as a click on
    // the canvas, *after* the gizmo has already reported the drag finished — so
    // a flag that is true only during the drag would already be false by then.
    // This one is consumed by the click it belongs to.
    let endedDrag = false;

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
    // A right press is a fly (`flyNav`, below), and it lands on the gizmo the
    // same way, so it switches it off the same way.
    let navigated = false;
    let gizmoBeforeNav: boolean | null = null;
    const onNavPointerDown = (event: PointerEvent) => {
      // Under pointer lock the buttons still fire, at frozen coordinates.
      if (walk !== null) return;
      if (event.button === 0) {
        navigated = navFor(event) !== 'none';
        if (!navigated) return;
      } else if (event.button !== 2) return;
      gizmoBeforeNav = transform.enabled;
      transform.enabled = false;
    };
    const onNavPointerUp = () => {
      if (gizmoBeforeNav === null) return;
      transform.enabled = gizmoBeforeNav;
      gizmoBeforeNav = null;
    };
    // Capture on `host`, ahead of both OrbitControls and the gizmo, for the
    // same ordering reason `attachBlenderNav` gives.
    host.addEventListener('pointerdown', onNavPointerDown, { capture: true });
    host.addEventListener('pointerup', onNavPointerUp, { capture: true });
    host.addEventListener('pointercancel', onNavPointerUp, { capture: true });

    const detach = () => {
      transform.detach();
      transform.enabled = false;
      transform.getHelper().visible = false;
    };

    // Which anchor `attach` uses, and therefore a value the mode switch has to
    // re-attach on — see `anchorFor`.
    let gizmoModeNow: GizmoMode = gizmoModeRef.current;

    /**
     * Where the gizmo stands for a selection (§16.24 2).
     *
     * The middle of it while translating, and the last VOB picked while
     * rotating. Not one answer for both, because `rotateVobs` turns each VOB
     * about *its own* origin: a rotate gizmo at the centroid would show a pivot
     * the op does not use, and the first multi-VOB rotate would look broken.
     * Translating has no such pivot — the drag reports a delta from wherever
     * the proxy was picked up — so the centre is free there and is what the
     * handles should sit in.
     */
    const anchorFor = (vobs: readonly number[]) => (
      gizmoModeNow === 'rotate' ? world.anchorOf(vobs) : world.centroidOf(vobs)
    );

    const attach = (vobs: readonly number[]) => {
      const position = anchorFor(vobs);
      gizmoVobs = position === null ? [] : vobs;
      gizmoWaypoint = null;

      if (position === null) { detach(); return; }
      proxy.position.set(position[0], position[1], position[2]);
      // The proxy's own orientation is reset on every attach: the gizmo reports
      // a *delta* from where it was picked up, so what it starts from only has
      // to be the same at the press and at the release.
      proxy.quaternion.identity();
      transform.attach(proxy);
      transform.enabled = true;
      transform.getHelper().visible = true;
    };
    /**
     * Put the gizmo on a waypoint instead.
     *
     * Translate only, and that is a fact about the op set rather than about the
     * gizmo: `MoveWaypoint` is the only waynet op there is. A waypoint does
     * carry a direction, but nothing writes one yet, so a rotate ring here
     * would turn something the world would never be told about.
     */
    const attachWaypoint = (waypoint: number | null) => {
      gizmoVobs = [];
      gizmoWaypoint = null;

      const overlay = overlayRef.current;
      if (waypoint === null || overlay === null) { detach(); return; }

      gizmoWaypoint = waypoint;
      const position = overlay.positionOf(waypoint);
      proxy.position.set(position[0], position[1], position[2]);
      proxy.quaternion.identity();
      transform.setMode('translate');
      transform.attach(proxy);
      transform.enabled = true;
      transform.getHelper().visible = true;
    };

    gizmoRef.current = {
      attach,
      attachWaypoint,
      // The mode buttons and the W/E keys keep working while a waypoint is
      // selected; they just have nothing to switch to. Ignored rather than
      // disabled, so the mode the VOBs were in survives a detour through the
      // waynet.
      setMode: (mode) => {
        gizmoModeNow = mode;
        transform.setMode(gizmoWaypoint === null ? mode : 'translate');
        // The anchor is the mode's, so W and E move the gizmo as well as
        // changing its handles — a rotate gizmo left standing at the centroid
        // would turn about a pivot no op uses.
        if (gizmoWaypoint === null && gizmoVobs.length > 0) attach(gizmoVobs);
      },
    };

    // A drag must not also orbit the camera.
    transform.addEventListener('dragging-changed', (event) => {
      const dragging = event.value as boolean;
      controls.enabled = !dragging;

      if (dragging) {
        // Where everything was when the drag began. Read once: the preview
        // writes the instance matrices this would otherwise be read back out
        // of, so a per-frame read would compound the delta. For a waypoint,
        // reading once is not an optimisation but the only way to still know
        // where it started — the preview writes the overlay's own positions,
        // which is the array this would be read out of.
        waypointFrom = gizmoWaypoint === null
          ? null
          : overlayRef.current?.positionOf(gizmoWaypoint) ?? null;
        proxyFrom.copy(proxy.position);
        proxyTurnFrom.copy(proxy.quaternion);
        dragFrom.clear();
        turnFrom.clear();
        for (const vob of gizmoVobs) {
          const position = world.positionOf(vob);
          if (position !== null) dragFrom.set(vob, position);
          const rotation = world.rotationOf(vob);
          if (rotation !== null) turnFrom.set(vob, rotation as ZenRotation);
        }
        return;
      }

      endedDrag = true;

      if (gizmoWaypoint !== null) {
        const from = waypointFrom;
        if (from === null) return;
        const to: [number, number, number] = [
          proxy.position.x, proxy.position.y, proxy.position.z,
        ];
        // A click that dragged nothing. Committing it would put an op on the
        // undo stack that undoes nothing.
        if (to.every((component, axis) => component === from[axis])) return;
        onMoveWaypointRef.current(gizmoWaypoint, from, to);
        return;
      }

      if (gizmoVobs.length === 0) return;

      if (transform.getMode() === 'rotate') {
        const delta = turnDelta();
        // Identity is a click that turned nothing, and committing it would put
        // one op per selected VOB on the undo stack for a batch that undoes
        // nothing.
        if (delta === null) return;
        onRotateRef.current(delta);
        return;
      }

      const delta: [number, number, number] = [
        proxy.position.x - proxyFrom.x, proxy.position.y - proxyFrom.y, proxy.position.z - proxyFrom.z,
      ];
      if (delta.every((component) => component === 0)) return;
      onTranslateRef.current(delta);
    });

    /**
     * The turn since the drag began, row-major in ZenGin space — or null if the
     * gizmo has not actually turned.
     *
     * **The proxy's local orientation is not in ZenGin's basis, though its local
     * position is.** `TransformControls` builds its parent-inverse by
     * decomposing the parent's `matrixWorld`, and `Matrix4.decompose` answers a
     * negative determinant by negating `scale.x` — so the mirrored root
     * decomposes to a scale of (-0.01, 0.01, 0.01) and a rotation of *identity*,
     * and the flip never reaches the quaternion. Translation survives that (the
     * offset is divided by the same negative scale); a rotation does not, and
     * the VOB turned the opposite way to the ring about Y and about Z, X being
     * the mirrored axis and therefore the one that looked correct.
     *
     * So the delta is conjugated by the mirror on the way out, in `coords`, with
     * the rest of the conversion. `tests/gizmoRotation.test.ts` pins both
     * library behaviours this depends on.
     */
    const turnDelta = (): ZenRotation | null => {
      // q_now = delta * q_start, so delta = q_now * q_start⁻¹.
      turn.copy(proxyTurnFrom).invert().premultiply(proxy.quaternion);
      if (Math.abs(turn.w) >= 1) return null;
      return mirrorRotation(rowMajor(turnMatrix.makeRotationFromQuaternion(turn)));
    };

    /**
     * Quantise the drag, by writing the snapped pose back onto the proxy.
     *
     * On the proxy rather than on the delta the commit reports, because the
     * proxy is what everything downstream reads: the live preview, the two
     * commits, a waypoint's destination and `verify-world-edit.js`'s harness all
     * take their number from it, and snapping any one of them separately would
     * be a second place the step has to be applied. `TransformControls`
     * recomputes the pose from where the press left it on every pointer move, so
     * writing back cannot accumulate — this is what its own snapping does.
     */
    const snapProxy = () => {
      if (transform.getMode() === 'rotate') {
        // The turn since the press, snapped and put back — the proxy's start
        // orientation is arbitrary (`attach` resets it), so only the delta is a
        // quantity a step means anything against.
        turn.copy(proxyTurnFrom).invert().premultiply(proxy.quaternion);
        snapTurn(turn, snapAngleRef.current);
        proxy.quaternion.copy(proxyTurnFrom).premultiply(turn);
        return;
      }

      const snapped = snapDelta([
        proxy.position.x - proxyFrom.x,
        proxy.position.y - proxyFrom.y,
        proxy.position.z - proxyFrom.z,
      ], snapGridRef.current);
      proxy.position.set(
        proxyFrom.x + snapped[0], proxyFrom.y + snapped[1], proxyFrom.z + snapped[2],
      );
    };

    // The live preview. The world in the main process still has the VOBs where
    // they were; this is the drag being drawn, and it is made real on release.
    transform.addEventListener('objectChange', () => {
      snapProxy();

      if (gizmoWaypoint !== null) {
        // Straight into the array the point cloud and the edge lines share, so
        // the edges into this waypoint follow the drag instead of pointing at
        // where it used to be for as long as the drag lasts.
        overlayRef.current?.setPosition(gizmoWaypoint, [
          proxy.position.x, proxy.position.y, proxy.position.z,
        ]);
        return;
      }

      if (transform.getMode() === 'rotate') {
        const delta = turnDelta();
        if (delta === null) return;
        for (const [vob, from] of turnFrom) world.rotateVob(vob, multiplyRotation(delta, from));
        return;
      }

      for (const [vob, from] of dragFrom) {
        world.moveVob(vob, [
          from[0] + proxy.position.x - proxyFrom.x,
          from[1] + proxy.position.y - proxyFrom.y,
          from[2] + proxy.position.z - proxyFrom.z,
        ]);
      }
    });

    // Scratch for the waypoint pick, so a click allocates no matrix.
    const toClip = new THREE.Matrix4();
    // Scratch for a picked VOB's position on its way into `rememberPick`.
    const pivotPoint = new THREE.Vector3();

    /** Remember where a click landed, so a later drag over the sky still has a
     *  pivot to fall back on. */
    const rememberPick = (at: THREE.Vector3) => {
      lastPick = (lastPick ?? new THREE.Vector3()).copy(at);
    };

    // ── the scatter brush (level-editor.md §16.25) ──────────────────────────
    //
    // The left button is free for this: `attachBlenderNav` maps LEFT to null, so
    // nothing here has to fight OrbitControls for it, and the only other thing a
    // left press can land on is a gizmo axis. That one is real — the palette
    // *is* the selection, so the gizmo is standing exactly where the user is
    // about to paint — and it is settled the way a nav press settles it, by
    // switching the gizmo off for the length of the stroke.
    //
    // What the brush emits is where the cursor went and nothing else. It does
    // not know the palette, the spacing or the seed; `WorldSurface` turns a
    // stroke into candidates, raycasts them and commits the batch.
    const scatterRing = new ScatterRing();
    scatterRingRef.current = scatterRing;
    world.root.add(scatterRing.root);

    const brushPointer = new THREE.Vector2();
    const brushRaycaster = new THREE.Raycaster();
    brushRaycaster.firstHitOnly = true;
    /** The stroke in hand, or null when the button is up. */
    let stroke: Array<[number, number, number]> | null = null;
    /** Consumed by the click that ends a stroke, exactly as `endedDrag` is. */
    let painted = false;
    let gizmoBeforeStroke: boolean | null = null;

    /** What is under the cursor, in ZenGin space — the same conversion
     *  `raycastDown` makes, against the same meshes. */
    const brushHit = (event: PointerEvent): {
      point: [number, number, number]; normal: [number, number, number];
    } | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      brushPointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      brushRaycaster.setFromCamera(brushPointer, camera);
      const hit = brushRaycaster.intersectObjects(world.worldMeshes, false)[0];
      if (!hit || !hit.face) return null;

      const normal = hit.face.normal.clone()
        .transformDirection(hit.object.matrixWorld).normalize();
      return {
        point: threeToZen(hit.point.toArray() as [number, number, number]),
        normal: threeToZen(normal.toArray() as [number, number, number]),
      };
    };

    const onBrushDown = (event: PointerEvent) => {
      if (scatterRadiusRef.current === null || walk !== null) return;
      // Alt+left is the emulated middle button, so a modified press is a
      // navigation and never a stroke — the brush must not take the one gesture
      // a trackpad orbits with.
      if (event.button !== 0 || navFor(event) !== 'none') return;

      const hit = brushHit(event);
      if (hit === null) return;

      stroke = [hit.point];
      painted = true;
      gizmoBeforeStroke = transform.enabled;
      transform.enabled = false;
      // Ahead of the gizmo and the picker, both of which listen on the canvas.
      event.stopPropagation();
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    /**
     * The ground at a horizontal position, for the ring's drape — the same
     * downward ray a placement makes, so the ring predicts rather than
     * decorates.
     *
     * It starts a radius above the cursor's own height for the reason the
     * placements do: a vertex uphill of the cursor has its ground *above* the
     * cursor, and a ray from the cursor's height would pass through the inside
     * of the slope and report the far side of the hill.
     */
    const brushGround = (from: number, lift: number) => (x: number, z: number) => {
      const origin = zenToThree([x, from + lift, z]);
      brushRaycaster.set(
        new THREE.Vector3(...origin),
        new THREE.Vector3(...zenToThree([0, -1, 0])).normalize(),
      );
      const hit = brushRaycaster.intersectObjects(world.worldMeshes, false)[0];
      if (!hit || !hit.face) return null;

      const normal = hit.face.normal.clone()
        .transformDirection(hit.object.matrixWorld).normalize();
      return {
        y: threeToZen(hit.point.toArray() as [number, number, number])[1],
        normal: threeToZen(normal.toArray() as [number, number, number]),
      };
    };

    const onBrushMove = (event: PointerEvent) => {
      const radius = scatterRadiusRef.current;
      if (radius === null) return;

      const hit = brushHit(event);
      if (hit === null) {
        // Off the mesh: no footprint to show, and a stale ring would be a lie
        // about where a press would land. The stroke itself is not ended — a
        // cursor crossing the sky between two hillsides is one stroke.
        scatterRing.hide();
        return;
      }

      scatterRing.moveTo(hit.point, hit.normal, radius, brushGround(hit.point[1], radius));
      if (stroke !== null) {
        stroke.push(hit.point);
        event.stopPropagation();
      }
    };

    const onBrushUp = (event: PointerEvent) => {
      if (stroke === null) return;
      const samples = stroke;
      stroke = null;
      if (gizmoBeforeStroke !== null) {
        transform.enabled = gizmoBeforeStroke;
        gizmoBeforeStroke = null;
      }
      event.stopPropagation();
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      onScatterStrokeRef.current(samples);
    };

    host.addEventListener('pointerdown', onBrushDown, { capture: true });
    // On the window rather than the host: a stroke that runs off the edge of
    // the canvas and comes back is one stroke, and a button released outside it
    // still has to commit what was painted.
    window.addEventListener('pointermove', onBrushMove);
    window.addEventListener('pointerup', onBrushUp, { capture: true });
    window.addEventListener('pointercancel', onBrushUp, { capture: true });

    const handleClick = async (event: MouseEvent) => {
      // A walk's click lands at the frozen pointer-lock coordinates: it would
      // pick whatever sits under wherever the cursor was when F3 was pressed.
      if (walk !== null) return;
      // Picking here would select whatever is behind the gizmo — usually
      // nothing, so a finished drag would deselect the VOB it just moved.
      if (endedDrag) { endedDrag = false; return; }
      // The same, for a drag of the camera on the emulated middle button.
      if (navigated) { navigated = false; return; }
      // And the same for a brush stroke, which ends on the canvas exactly as a
      // gizmo drag does — a stroke that deselected the palette it had just
      // painted with would make a second stroke impossible.
      if (painted) { painted = false; return; }
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // The props first: GPU ID-picking is one draw pass into a 1x1 buffer,
      // where the equivalent CPU raycast is 14.2 ms. The readback is awaited
      // rather than stalled on, so the draw loop keeps running underneath it —
      // and the world can be closed while a pick is still in flight.
      // Read before the await: a modifier released while the readback is in
      // flight would otherwise turn a Shift+click into a plain one.
      //
      // Shift is free for this because panning is on Shift+*middle*
      // (`cameraNav.navFor`), so no left-button gesture is spoken for — and it
      // is the modifier a level editor is reached for with.
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;

      // The waynet first, and only while it is on screen. It draws with
      // `depthTest: false` — over everything, including whatever VOB is behind
      // it — so picking it second would mean clicking a dot that is plainly on
      // top and selecting the wall behind it. The modifiers do not apply: one
      // waypoint is the whole selection, so there is no batch to add to.
      const overlay = overlayRef.current;
      if (showWaynetRef.current && overlay !== null) {
        // Projection x view x the mirrored root, because the overlay's
        // positions are ZenGin centimetres and the root is what puts them in
        // the world.
        camera.updateMatrixWorld();
        world.root.updateMatrixWorld();
        const waypoint = pickWaypoint(
          overlay.positions,
          toClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
            .multiply(world.root.matrixWorld),
          x, y, rect.width, rect.height,
        );
        if (waypoint !== NO_WAYPOINT) { onSelectWaypointRef.current(waypoint); return; }
      }

      const vob = await picker.pickAsync(renderer, camera, x, y, rect.width, rect.height);
      if (disposed) return;
      if (vob !== NO_PICK) {
        const at = world.positionOf(vob);
        if (at !== null) rememberPick(pivotPoint.set(...zenToThree(at)));
        onPickRef.current(vob, null, additive);
        return;
      }

      // Then the world mesh, through its BVH — 0.2 ms p50 against 476k
      // triangles. Terrain is not a VOB, so a hit reports the point rather
      // than inventing a selection, and it comes back in ZenGin space: the
      // conversion is one-way at the root and `threeToZen` is the way back.
      pointer.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(world.worldMeshes, false)[0];
      if (hit) rememberPick(hit.point);
      onPickRef.current(null, hit ? threeToZen(hit.point.toArray()) : null, additive);
    };
    renderer.domElement.addEventListener('click', handleClick);

    /**
     * Double-click to pivot **on the point clicked** (§16.12).
     *
     * Deliberately not `pivotAt`: its view-axis projection put the pivot
     * metres from the cursor, so the orbit swung around the screen middle.
     * That projection is right for `pivotUnderCursor`, which must not snap
     * the view mid-drag, and wrong for the one gesture that means "make this
     * the centre" — OrbitControls re-aims at `target`, so writing the point
     * is the whole of it: the camera holds its position and only turns.
     *
     * World mesh first; a VOB is the fallback, through the GPU pick
     * `handleClick` already pays for, so no CPU raycast over the 724
     * InstancedMeshes. Without it a double-click over sky did nothing.
     */
    const handleDoubleClick = async (event: MouseEvent) => {
      if (walk !== null) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      pointer.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      // The mesh's own vertices stay in raw ZenGin centimetres — only
      // `world.root`'s matrix carries the unit scale and the handedness
      // mirror (`zen-world`'s `ROOT_MATRIX`) — so a stale `matrixWorld`
      // raycasts against geometry sitting at identity, two orders of
      // magnitude out of scale with the camera. The draw loop's own
      // `renderer.render()` keeps this fresh as a side effect every frame
      // in practice, but a pick must not depend on one having already run;
      // `handleClick`'s waynet branch makes the same call for the same
      // reason.
      camera.updateMatrixWorld();
      world.root.updateMatrixWorld();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(world.worldMeshes, false)[0];
      if (hit) {
        controls.target.copy(hit.point);
        rememberPick(hit.point);
        setPivotMarker(threeToZen(hit.point.toArray()));
        return;
      }

      const vob = await picker.pickAsync(renderer, camera, x, y, rect.width, rect.height);
      if (disposed || vob === NO_PICK) return;
      const at = world.positionOf(vob);
      if (at === null) return;
      pivotPoint.set(...zenToThree(at));
      controls.target.copy(pivotPoint);
      rememberPick(pivotPoint);
      setPivotMarker(at);
    };
    renderer.domElement.addEventListener('dblclick', handleDoubleClick);

    /**
     * The context menu's own pick (level-editor.md §17) — the same
     * async GPU pick `handleClick` uses, VOB hits only. A
     * miss reports nothing, so a right-click over terrain or empty sky
     * opens no menu; that pick is reserved. `preventDefault` runs first,
     * unconditionally: swallowing the browser's own menu is not something
     * the (awaited) pick's outcome should decide.
     */
    const handleContextMenu = async (event: MouseEvent) => {
      // A walk's right click opens nothing — neither menu — for the reason
      // `handleClick` gives.
      if (walk !== null) { event.preventDefault(); return; }
      // The right button was a fly, not a click: the menu it would open at
      // the release stays shut, and so does the browser's.
      if (flew) { flew = false; event.preventDefault(); return; }
      if (onVobContextMenuRef.current === undefined) return;
      event.preventDefault();
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const vob = await picker.pickAsync(renderer, camera, x, y, rect.width, rect.height);
      if (disposed || vob === NO_PICK) return;
      onVobContextMenuRef.current(vob, { left: event.clientX, top: event.clientY });
    };
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);

    // ── fly navigation (plan §16.26 row 3) ─────────────────────────────────
    //
    // Hold the right button: the drag looks, WASD/QE moves, Shift hurries
    // (`flyNav`). The right button is free — OrbitControls' RIGHT is `null` —
    // except for the click that opens the context menu, and a hold is told
    // from a click by whether it moved anything (`flew`, read by the
    // `contextmenu` handler above, which on Windows fires after the release).
    //
    // OrbitControls re-aims the camera at its target on every `update()`, so
    // for the length of the hold the draw loop steps the fly instead, and the
    // release re-seats the target ahead of the camera — on the world mesh
    // under the centre of the view if there is one, else at the distance the
    // hold began with — so the next orbit turns about what is being looked
    // at and the next dolly and pan keep their scale.
    let fly: Fly | null = null;
    let flew = false;
    let flyReach = 0;
    let flyLastX = 0;
    let flyLastY = 0;
    const onFlyPointerDown = (event: PointerEvent) => {
      // A walk and a fly would both write the camera every frame.
      if (event.button !== 2 || fly !== null || walk !== null) return;
      flew = false;
      flyReach = camera.position.distanceTo(controls.target);
      fly = new Fly(camera, flySpeedFor(flyReach));
      flyLastX = event.clientX;
      flyLastY = event.clientY;
      controls.enabled = false;
    };
    // Window listeners, so a drag that leaves the canvas keeps looking and a
    // release over another panel still ends the hold.
    const onFlyPointerMove = (event: PointerEvent) => {
      if (fly === null) return;
      fly.look(event.clientX - flyLastX, event.clientY - flyLastY);
      flyLastX = event.clientX;
      flyLastY = event.clientY;
    };
    const onFlyPointerUp = (event: PointerEvent) => {
      if (fly === null || event.button !== 2) return;
      flew = fly.moved;
      fly = null;
      controls.enabled = true;
      if (!flew) return;
      raycaster.setFromCamera(pointer.set(0, 0), camera);
      const hit = raycaster.intersectObjects(world.worldMeshes, false)[0];
      if (hit) pivotAt(camera, controls.target, hit.point);
      else pivotAhead(camera, controls.target, flyReach);
      // The sky-fallback pivot too, for the same reason `frameFramables` does.
      rememberPick(controls.target);
    };
    // Capture on the window, ahead of the surface's own W/E gizmo-mode keys:
    // while the right button is down, W is "forward".
    const onFlyKey = (event: KeyboardEvent) => {
      if (fly === null) return;
      const taken = event.type === 'keydown'
        ? fly.press(event.code, event.shiftKey)
        : (fly.release(event.code, event.shiftKey), flyMoveFor(event.code) !== null);
      if (!taken) return;
      event.preventDefault();
      event.stopPropagation();
    };
    host.addEventListener('pointerdown', onFlyPointerDown, { capture: true });
    window.addEventListener('pointermove', onFlyPointerMove);
    window.addEventListener('pointerup', onFlyPointerUp);
    window.addEventListener('pointercancel', onFlyPointerUp);
    window.addEventListener('keydown', onFlyKey, { capture: true });
    window.addEventListener('keyup', onFlyKey, { capture: true });

    // ── walk navigation (plan §16.26 row 3, the grounded half) ─────────────
    //
    // F3 toggles a walk (`walkNav`): the mouse looks under pointer lock — the
    // app's first use of it, and the only way a look has no edge to run
    // into — WASD walks, gravity and the world mesh do the rest. Unlike the
    // fly it is a long-lived mode, not a press-scoped hold, so what it
    // switches off is snapshotted and given back exactly (the `gizmoBeforeNav`
    // precedent); the selection is never touched.
    //
    // Entry is optimistic: the walk begins on the keydown, where the lock
    // request needs the user's activation, and a refused lock rolls it back
    // through `pointerlockerror`. A camera with nowhere to stand — the search
    // above it finds nothing before the world's top — enters nothing and says
    // nothing.
    let walk: Walk | null = null;
    let walkBeforeControlsEnabled: boolean | null = null;
    let walkBeforeGizmo: { enabled: boolean; helperVisible: boolean } | null = null;
    const enterWalk = () => {
      const entry = findWalkEntry(camera.position, world.worldMeshes, box.max[1]);
      if (entry === null) return;
      walkBeforeControlsEnabled = controls.enabled;
      walkBeforeGizmo = { enabled: transform.enabled, helperVisible: transform.getHelper().visible };
      controls.enabled = false;
      transform.enabled = false;
      transform.getHelper().visible = false;
      camera.position.copy(entry);
      // A promise in Chromium, nothing in older engines; a refusal arrives as
      // `pointerlockerror` either way, so the rejection carries nothing new.
      Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {});
      walk = new Walk(camera, world.worldMeshes);
    };
    // The one teardown, for every way a walk ends: F3 again, the lock lost
    // to Escape or a window switch, a refused lock, the scene going away.
    const exitWalk = () => {
      if (walk === null) return;
      walk = null;
      if (walkBeforeControlsEnabled !== null) controls.enabled = walkBeforeControlsEnabled;
      if (walkBeforeGizmo !== null) {
        transform.enabled = walkBeforeGizmo.enabled;
        transform.getHelper().visible = walkBeforeGizmo.helperVisible;
      }
      walkBeforeControlsEnabled = null;
      walkBeforeGizmo = null;
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      // The pivot as the fly's release leaves it, but at a fixed reach: the
      // fly's own is the distance it began with, and a walk can have crossed
      // the level since F3.
      raycaster.setFromCamera(pointer.set(0, 0), camera);
      const hit = raycaster.intersectObjects(world.worldMeshes, false)[0];
      if (hit) pivotAt(camera, controls.target, hit.point);
      else pivotAhead(camera, controls.target, WALK_EXIT_PIVOT_DISTANCE);
      rememberPick(controls.target);
    };
    // `mousemove`, not the `pointermove` the fly reads: under pointer lock
    // the deltas are `movementX/Y`, which is a mouse event's field.
    const onWalkMouseMove = (event: MouseEvent) => {
      if (walk === null) return;
      walk.look(event.movementX, event.movementY);
    };
    const onWalkKey = (event: KeyboardEvent) => {
      if (walk === null) return;
      const taken = event.type === 'keydown'
        ? walk.press(event.code, event.shiftKey)
        : (walk.release(event.code, event.shiftKey), walkMoveFor(event.code) !== null);
      if (!taken) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onPointerLockChange = () => {
      if (walk !== null && document.pointerLockElement !== renderer.domElement) exitWalk();
    };
    const onPointerLockError = () => { exitWalk(); };
    window.addEventListener('mousemove', onWalkMouseMove);
    window.addEventListener('keydown', onWalkKey, { capture: true });
    window.addEventListener('keyup', onWalkKey, { capture: true });
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);

    // Blender's framing keys, and the reason orbiting is usable at all: the
    // pivot starts at the centre of a 600 m island, so without a way to move it
    // onto what you are looking at, every orbit up close swings the camera
    // through half the world.
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
      // A VOB that is not drawn has no position to frame — a decal, a sound
      // VOB — and a selection can be nothing but those.
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

    const onKeyDown = (event: KeyboardEvent) => {
      // Another view is on screen: this is a window listener, and framing a
      // camera nobody can see is at best a swallowed keystroke.
      if (pausedRef.current) return;
      // The property grid is a pile of text fields, and a '.' typed into one of
      // them is a decimal point, not a camera move.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;

      // Spacer's camera slots: Ctrl+Shift+N stores the pose, Ctrl+N brings it
      // back — camera and pivot both, so the next orbit turns about the same
      // point. `Ctrl+digit` is bound nowhere else in the app.
      const slot = cameraSlotFor(event);
      if (slot !== null) {
        event.preventDefault();
        if (slot.action === 'store') {
          cameraSlots.store(slot.slot, camera.position, controls.target);
        } else if (cameraSlots.recall(slot.slot, camera.position, controls.target)) {
          controls.update();
          // The sky-fallback pivot too, as `frameFramables` does.
          rememberPick(controls.target);
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Spacer's walk key. Not during a fly — both would write the camera —
      // and not while something else owns the controls (a gizmo drag, a
      // benchmark), for the same reason.
      if (event.code === 'F3') {
        event.preventDefault();
        if (walk !== null) exitWalk();
        else if (fly === null && controls.enabled) enterWalk();
        return;
      }

      // Blender's key is numpad-period; laptops without a numpad send the
      // ordinary one, and both mean the same thing here.
      if (event.code === 'NumpadDecimal' || event.key === '.') { frameSelection(); return; }
      if (event.key === 'Home') frameAll();
    };
    window.addEventListener('keydown', onKeyDown);

    const resize = new ResizeObserver(() => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height);
      outline.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(host);

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
      if (fly !== null) fly.step(performance.now());
      else if (walk !== null) walk.step(performance.now());
      else controls.update();

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

      outline.render(renderer, scene, camera);
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
      render: () => outline.render(renderer, scene, camera),
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
      await Promise.all([bvhReady, texturesReady]);

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
      dragGizmo: (to) => {
        if (gizmoVobs.length === 0 && gizmoWaypoint === null) {
          throw new Error('nothing is selected');
        }
        // The whole sequence a real drag fires, in order: the press is what
        // records where everything started, and a delta measured from a stale
        // origin is the defect this stands to catch.
        transform.dispatchEvent({ type: 'dragging-changed', value: true });
        proxy.position.set(to[0], to[1], to[2]);
        transform.dispatchEvent({ type: 'objectChange' });
        transform.dispatchEvent({ type: 'dragging-changed', value: false });
      },
      turnGizmo: (axis, radians) => {
        if (gizmoVobs.length === 0) throw new Error('no VOB is selected');
        transform.dispatchEvent({ type: 'dragging-changed', value: true });
        // The axis is in ZenGin space, like everything an op carries, so the
        // driver can predict the answer. The proxy's quaternion is *not* in that
        // basis (see `turnDelta`), so the turn is built in ZenGin and conjugated
        // into the proxy's frame by the same function that converts it back —
        // which is its own inverse, so this cannot be applied the wrong way.
        const inZen = rowMajor(turnMatrix.makeRotationFromQuaternion(
          turn.setFromAxisAngle(new THREE.Vector3(axis[0], axis[1], axis[2]).normalize(), radians),
        ));
        const asProxy = mirrorRotation(inZen);
        proxy.quaternion.setFromRotationMatrix(turnMatrix.set(
          asProxy[0], asProxy[1], asProxy[2], 0,
          asProxy[3], asProxy[4], asProxy[5], 0,
          asProxy[6], asProxy[7], asProxy[8], 0,
          0, 0, 0, 1,
        ));
        transform.dispatchEvent({ type: 'objectChange' });
        transform.dispatchEvent({ type: 'dragging-changed', value: false });
      },
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
        await Promise.all([bvhReady, texturesReady]);

        // The draw loop and OrbitControls both write the camera every frame.
        stopDraw();
        controls.enabled = false;
        try {
          camera.position.set(...zenToThree(from));
          camera.lookAt(target.set(...zenToThree(at)));
          camera.updateMatrixWorld();
          outline.render(renderer, scene, camera);

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
      gizmoRotation: () => (gizmoVobs.length === 0 ? null : world.rotationOf(gizmoVobs[gizmoVobs.length - 1])),
      gizmoPosition: () => (gizmoVobs.length === 0 && gizmoWaypoint === null
        ? null
        : [proxy.position.x, proxy.position.y, proxy.position.z]),
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
      disposed = true;
      // Before the pose is read: a walk left standing would keep the lock and
      // hand the rebuilt scene a pivot it never re-seated.
      if (walk !== null) exitWalk();
      poseRef.current = {
        key: worldKey,
        position: camera.position.toArray(),
        target: controls.target.toArray(),
      };
      sceneRef.current = null;
      gizmoRef.current = null;
      frameVobRef.current = null;
      framePointRef.current = null;
      cameraPositionRef.current = null;
      delete window.__worldViewport;
      drawLoopRef.current = null;
      stopDraw();
      resize.disconnect();
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.domElement.removeEventListener('dblclick', handleDoubleClick);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('pointerdown', onFlyPointerDown, { capture: true });
      window.removeEventListener('pointermove', onFlyPointerMove);
      window.removeEventListener('pointerup', onFlyPointerUp);
      window.removeEventListener('pointercancel', onFlyPointerUp);
      window.removeEventListener('keydown', onFlyKey, { capture: true });
      window.removeEventListener('keyup', onFlyKey, { capture: true });
      window.removeEventListener('mousemove', onWalkMouseMove);
      window.removeEventListener('keydown', onWalkKey, { capture: true });
      window.removeEventListener('keyup', onWalkKey, { capture: true });
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('pointerlockerror', onPointerLockError);
      detachNav();
      host.removeEventListener('pointerdown', onNavPointerDown, { capture: true });
      host.removeEventListener('pointerup', onNavPointerUp, { capture: true });
      host.removeEventListener('pointercancel', onNavPointerUp, { capture: true });
      host.removeEventListener('pointerdown', onBrushDown, { capture: true });
      window.removeEventListener('pointermove', onBrushMove);
      window.removeEventListener('pointerup', onBrushUp, { capture: true });
      window.removeEventListener('pointercancel', onBrushUp, { capture: true });
      scatterRingRef.current = null;
      world.root.remove(scatterRing.root);
      scatterRing.dispose();
      controls.dispose();
      transform.detach();
      scene.remove(transform.getHelper());
      transform.dispose();
      picker.dispose();
      outline.dispose();
      bvh.dispose();
      pivotMarker?.dispose();
      world.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
    // Rebuilt only when a different world's payloads arrive — the callbacks are
    // read through refs precisely so they are not dependencies.
  }, [mesh, visuals, bbox]);

  // Going off screen stops the loop; coming back starts it again. Deliberately
  // not a dependency of the scene effect above: `paused` flips on every tab
  // switch and rebuilding the scene for it is the cost the mount was kept for.
  useEffect(() => {
    const loop = drawLoopRef.current;
    if (loop === null) return;
    if (paused) loop.stop(); else loop.start();
  }, [paused, mesh, visuals, bbox]);

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
    if (scatterRadius === null) scatterRingRef.current?.hide();
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
