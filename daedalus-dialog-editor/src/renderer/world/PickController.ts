import * as THREE from 'three';
import { threeToZen, zenToThree, type ZenPosition } from 'zen-world';
import { NO_PICK } from './pickIds';
import { pickWaypoint, NO_WAYPOINT } from './pickWaypoint';
import type { SpawnOverlay } from './SpawnOverlay';
import type { VobPicker } from './VobPicker';
import type { WaynetOverlay } from './WaynetOverlay';
import type { WorldScene } from './WorldScene';

// What a click means (level-editor.md §3, §16.12, §17), lifted out of
// `WorldViewport`'s one big effect (#220).
//
// Three handlers, and the whole of what is interesting about them is the
// *order* they try things in — which is a rule, not an implementation detail,
// and was previously reachable only by rendering the entire viewport:
//
//   - a click asks the waynet first, because the overlay draws with
//     `depthTest: false` and is plainly on top; then the markers for the VOBs
//     with no visual (§16.38) that the world mesh leaves in view, which the GPU
//     id-pass has nothing to draw into; then the props, by GPU ID-pick; then
//     the world mesh, through its BVH.
//   - a double-click asks the world mesh first and falls back to the props,
//     because "make this the centre" wants the surface, not an origin.
//   - a right-click asks the props and nothing else: a miss opens no menu.
//
// Each handler also has to know when the click it is looking at is not a click
// at all — the tail of a gizmo drag, a camera drag, a brush stroke, a fly —
// and those arrive as `consume*` accessors, because the state belongs to
// whoever owns the gesture.

/** How far short of a marker the occlusion ray stops, in three units (metres):
 *  a surface closer to the marker than this does not hide it. */
const MARKER_SLACK = 0.1;

export interface PickControllerOptions {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  world: WorldScene;
  picker: VobPicker;
  /** OrbitControls' pivot — a double-click writes it. */
  controls: { target: THREE.Vector3 };
  /** The viewport's own world-mesh raycaster and pointer, shared rather than
   *  duplicated: the navigation pivot, the fly, the walk and the measurement
   *  probe all read the same pair, and a click is one more caller. */
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;

  /** The waynet overlay, read per click — a rebuild replaces it, and it is
   *  null whenever the waynet is not drawn. */
  waynet: () => WaynetOverlay | null;
  showWaynet: () => boolean;
  /** The scene is being torn down: a pick still in flight must not answer. */
  disposed: () => boolean;
  /** A walk's click lands at the frozen pointer-lock coordinates, so it would
   *  pick whatever sat under wherever the cursor was when the walk began. */
  walking: () => boolean;
  /** Whether this click is the tail of a gesture that is not a pick. Consumed
   *  by the click it belongs to. */
  consumeGesture: () => boolean;
  /** Whether this right-click is the tail of a fly. Consumed likewise. */
  consumeFly: () => boolean;

  onPick: (vob: number | null, terrain: ZenPosition | null, additive: boolean) => void;
  onSelectWaypoint: (waypoint: number) => void;
  /** Undefined where the surface offers no menu — then a right-click does
   *  nothing at all, the browser's own menu included. */
  contextMenu: () => ((vob: number, at: { left: number; top: number }) => void) | undefined;
  /** Defined while a placement is armed (#364): a right-click then puts it
   *  down, and opens no menu, and a click asks the ground alone. */
  cancelArmed?: () => (() => void) | undefined;
  /** Where a click landed, in three space: the fallback pivot for a later drag
   *  that begins over the sky. */
  rememberPick: (at: THREE.Vector3) => void;
  /** A double-click makes the point clicked the pivot. */
  onPivot: (at: THREE.Vector3, zen: ZenPosition) => void;
  /** The spawn markers, read per click like the waynet — null while none are
   *  drawn. A marker's click selects the waypoint it stands on. */
  spawns?: () => { pickWaypoint: SpawnOverlay['pickWaypoint'] } | null;
}

export class PickController {
  /** Scratch for the two pixel picks, so a click allocates no matrix. */
  private readonly toClip = new THREE.Matrix4();
  /** Scratch for a picked VOB's position on its way back out. */
  private readonly pivotPoint = new THREE.Vector3();
  /** Scratch for the marker occlusion ray. */
  private readonly eye = new THREE.Vector3();
  private readonly toMarker = new THREE.Vector3();

  constructor(private readonly options: PickControllerOptions) {}

  attach(): void {
    const canvas = this.options.renderer.domElement;
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    const canvas = this.options.renderer.domElement;
    canvas.removeEventListener('click', this.onClick);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  /** The event's position inside the canvas, and the canvas's own size. */
  private at(event: MouseEvent) {
    const rect = this.options.renderer.domElement.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * Projection × view × the mirrored root — what a pixel pick projects through.
   *
   * The root has to be in it: both point layers hold ZenGin centimetres and the
   * root is what puts them in the world, so without it every point is picked at
   * a position it is not drawn at. `updateMatrixWorld` for the reason `meshHit`
   * gives — the draw loop keeps these fresh in practice, and a pick must not
   * depend on one having already run.
   */
  private clip(): THREE.Matrix4 {
    const { camera, world } = this.options;
    camera.updateMatrixWorld();
    world.root.updateMatrixWorld();
    return this.toClip
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(world.root.matrixWorld);
  }

  /**
   * The world mesh under a canvas position, or null.
   *
   * The mesh's own vertices stay in raw ZenGin centimetres — only
   * `world.root`'s matrix carries the unit scale and the handedness mirror
   * (`zen-world`'s `ROOT_MATRIX`) — so a stale `matrixWorld` raycasts against
   * geometry sitting at identity, two orders of magnitude out of scale with the
   * camera. The draw loop's own `renderer.render()` keeps this fresh as a side
   * effect every frame in practice, but a pick must not depend on one having
   * already run.
   */
  private meshHit(x: number, y: number, width: number, height: number) {
    const { camera, world, raycaster, pointer } = this.options;
    camera.updateMatrixWorld();
    world.root.updateMatrixWorld();
    pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(world.worldMeshes, false)[0] ?? null;
  }

  /**
   * Whether the world mesh leaves a marker in view — root space in, the same
   * question the marker's depth test answers on the GPU. Only the world mesh:
   * a marker behind a prop is drawn faint but still taken, because the props'
   * depth lives in the GPU pick, not in anything a ray can ask cheaply.
   *
   * `MARKER_SLACK` short of the marker, so a startpoint standing on the floor
   * is not hidden by the floor it stands on. Called after `clip()`, which has
   * just refreshed the root's matrix.
   */
  private readonly markerInView = (at: readonly [number, number, number]): boolean => {
    const { camera, world, raycaster } = this.options;
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.toMarker.set(at[0], at[1], at[2]).applyMatrix4(world.root.matrixWorld).sub(this.eye);
    const distance = this.toMarker.length();
    if (distance <= MARKER_SLACK) return true;

    const far = raycaster.far;
    raycaster.set(this.eye, this.toMarker.divideScalar(distance));
    raycaster.far = distance - MARKER_SLACK;
    const hidden = raycaster.intersectObjects(world.worldMeshes, false).length > 0;
    raycaster.far = far;
    return !hidden;
  };

  private vobHit(x: number, y: number, width: number, height: number): Promise<number> {
    const { picker, renderer, camera } = this.options;
    return picker.pickAsync(renderer, camera, x, y, width, height);
  }

  private readonly onClick = async (event: MouseEvent) => {
    const o = this.options;
    if (o.walking()) return;
    // A gizmo drag, a camera drag or a brush stroke ends with a `click` on the
    // canvas. Picking on it would select whatever is behind the gizmo — usually
    // nothing — so the gesture would throw away the very thing it just acted on.
    if (o.consumeGesture()) return;

    const { x, y, width, height } = this.at(event);

    // Read before the await: a modifier released while the readback is in
    // flight would otherwise turn a Shift+click into a plain one.
    //
    // Shift is free for this because panning is on Shift+*middle*
    // (`cameraNav.navFor`), so no left-button gesture is spoken for — and it is
    // the modifier a level editor is reached for with.
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;

    // An armed placement wants the ground and nothing else: a click that lands
    // on a prop, a marker or a waypoint places there rather than selecting it,
    // and a miss places nothing and leaves the selection alone.
    if (o.cancelArmed?.() !== undefined) {
      const hit = this.meshHit(x, y, width, height);
      if (hit === null) return;
      o.rememberPick(hit.point);
      o.onPick(null, threeToZen(hit.point.toArray() as ZenPosition), additive);
      return;
    }

    // The waynet first, and only while it is on screen. It draws with
    // `depthTest: false` — over everything, including whatever VOB is behind it
    // — so picking it second would mean clicking a dot that is plainly on top
    // and selecting the wall behind it. The modifiers do not apply: one
    // waypoint is the whole selection, so there is no batch to add to.
    const overlay = o.waynet();
    if (o.showWaynet() && overlay !== null) {
      const waypoint = pickWaypoint(
        overlay.positions, this.clip(), x, y, width, height,
      );
      if (waypoint !== NO_WAYPOINT) { o.onSelectWaypoint(waypoint); return; }
    }

    // Then a spawn marker: drawn on top like the waynet and on the same points,
    // and it *is* the waypoint it stands on — so its click is the waypoint's,
    // whether or not the waynet is shown. Who stands there is the waypoint
    // panel's to list.
    const spawns = o.spawns?.() ?? null;
    if (spawns !== null) {
      const waypoint = spawns.pickWaypoint(this.clip(), x, y, width, height);
      if (waypoint !== NO_WAYPOINT) { o.onSelectWaypoint(waypoint); return; }
    }

    // Then the markers for the VOBs that have no visual at all (§16.38): a
    // sound, a light, a zone, a trigger — 38 % of a retail world. Before the
    // props for two reasons, and the first is the waynet's: the layer draws
    // over the props at a fixed pixel size, so a marker the user can see is a
    // marker the user expects to hit. The second is that the GPU id-pass has
    // nothing to answer with here — it draws instances, and a marker is a
    // vertex in a `THREE.Points` — so asking it first would return whatever
    // wall is behind the marker. Only a marker in view, though: one behind a
    // wall is drawn faint, and a click there means the wall.
    const markers = o.world.markers;
    if (markers !== null) {
      const marker = markers.pick(this.clip(), x, y, width, height, undefined, this.markerInView);
      if (marker !== NO_PICK) {
        const at = o.world.positionOf(marker);
        if (at !== null) o.rememberPick(this.pivotPoint.set(...zenToThree(at)));
        o.onPick(marker, null, additive);
        return;
      }
    }

    // The props next: GPU ID-picking is one draw pass into a 1x1 buffer, where
    // the equivalent CPU raycast is 14.2 ms. The readback is awaited rather
    // than stalled on, so the draw loop keeps running underneath it — and the
    // world can be closed while a pick is still in flight.
    const vob = await this.vobHit(x, y, width, height);
    if (o.disposed()) return;
    if (vob !== NO_PICK) {
      const at = o.world.positionOf(vob);
      if (at !== null) o.rememberPick(this.pivotPoint.set(...zenToThree(at)));
      o.onPick(vob, null, additive);
      return;
    }

    // Then the world mesh, through its BVH — 0.2 ms p50 against 476k triangles.
    // Terrain is not a VOB, so a hit reports the point rather than inventing a
    // selection, and it comes back in ZenGin space: the conversion is one-way
    // at the root and `threeToZen` is the way back.
    const hit = this.meshHit(x, y, width, height);
    if (hit) o.rememberPick(hit.point);
    o.onPick(null, hit ? threeToZen(hit.point.toArray() as ZenPosition) : null, additive);
  };

  /**
   * Double-click to pivot **on the point clicked** (§16.12).
   *
   * Deliberately not `pivotAt`: its view-axis projection put the pivot metres
   * from the cursor, so the orbit swung around the screen middle. That
   * projection is right for `pivotUnderCursor`, which must not snap the view
   * mid-drag, and wrong for the one gesture that means "make this the centre" —
   * OrbitControls re-aims at `target`, so writing the point is the whole of it:
   * the camera holds its position and only turns.
   *
   * World mesh first; a VOB is the fallback, through the GPU pick the click
   * already pays for, so no CPU raycast over the 724 InstancedMeshes. Without
   * it a double-click over sky did nothing.
   */
  private readonly onDoubleClick = async (event: MouseEvent) => {
    const o = this.options;
    if (o.walking()) return;
    const { x, y, width, height } = this.at(event);

    const hit = this.meshHit(x, y, width, height);
    if (hit) {
      o.controls.target.copy(hit.point);
      o.onPivot(hit.point, threeToZen(hit.point.toArray() as ZenPosition));
      return;
    }

    const vob = await this.vobHit(x, y, width, height);
    if (o.disposed() || vob === NO_PICK) return;
    const at = o.world.positionOf(vob);
    if (at === null) return;
    this.pivotPoint.set(...zenToThree(at));
    o.controls.target.copy(this.pivotPoint);
    o.onPivot(this.pivotPoint, at);
  };

  /**
   * The context menu's own pick (level-editor.md §17) — the same async GPU pick
   * the click uses, VOB hits only. A miss reports nothing, so a right-click
   * over terrain or empty sky opens no menu; that pick is reserved.
   * `preventDefault` runs first, unconditionally: swallowing the browser's own
   * menu is not something the (awaited) pick's outcome should decide.
   */
  private readonly onContextMenu = async (event: MouseEvent) => {
    const o = this.options;
    // A walk's right click opens nothing — neither menu — for the reason the
    // click gives.
    if (o.walking()) { event.preventDefault(); return; }
    // The right button was a fly, not a click: the menu it would open at the
    // release stays shut, and so does the browser's.
    if (o.consumeFly()) { event.preventDefault(); return; }
    const cancel = o.cancelArmed?.();
    if (cancel !== undefined) { event.preventDefault(); cancel(); return; }
    const open = o.contextMenu();
    if (open === undefined) return;
    event.preventDefault();

    const { x, y, width, height } = this.at(event);
    const vob = await this.vobHit(x, y, width, height);
    if (o.disposed() || vob === NO_PICK) return;
    open(vob, { left: event.clientX, top: event.clientY });
  };
}
