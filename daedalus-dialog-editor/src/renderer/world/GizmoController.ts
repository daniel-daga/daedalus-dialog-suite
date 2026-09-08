import * as THREE from 'three';
import { multiplyRotation, mirrorRotation, type ZenRotation } from 'zen-world';
import { DampedTransformControls } from './DampedTransformControls';
import { snapDelta, snapTurn } from './snapping';
import type { WaynetOverlay } from './WaynetOverlay';
import type { WorldScene } from './WorldScene';

// The transform gizmo (level-editor.md §7, Phase 1b), lifted out of
// `WorldViewport`'s one big effect (#220).
//
// A VOB is an *instance*, not an Object3D, so there is nothing for
// TransformControls to attach to. The proxy is that something: it hangs under
// the same mirrored root as everything else, which means its local position is
// ZenGin centimetres and reading it back needs no conversion — the root stays
// the only one in the app. The gizmo's own helper goes in the top-level scene
// instead, or it would be drawn through that same 0.01 scale and mirror.
//
// Everything the drag needs is here: where the gizmo stands for a selection,
// what a drag started from, the snap, the live preview and the two commits. It
// takes the scene and the overlay it drives, and hands back a delta.

export type GizmoMode = 'translate' | 'rotate';

export interface GizmoControllerOptions {
  camera: THREE.Camera;
  canvas: HTMLElement;
  /** The **top-level** scene the helper is drawn in, never the mirrored root. */
  scene: THREE.Scene;
  world: WorldScene;
  /** OrbitControls: a drag must not also orbit the camera. */
  controls: { enabled: boolean };
  /** The waynet overlay, read per call — a rebuild replaces it, and it is null
   *  whenever the waynet is not drawn. */
  overlay: () => WaynetOverlay | null;
  mode: GizmoMode;
  /** The drag's quantisation, in ZenGin centimetres and in degrees; 0 is off. */
  snapGrid: () => number;
  snapAngle: () => number;
  onTranslate: (delta: [number, number, number]) => void;
  onRotate: (delta: ZenRotation) => void;
  onMoveWaypoint: (
    waypoint: number,
    from: [number, number, number],
    to: [number, number, number],
  ) => void;
}

/** A rotation as ZenGin reads it — row-major — out of three's column-major
 *  `Matrix4`. `elements[col * 4 + row]` is element [row][col]. */
export function rowMajor(matrix: THREE.Matrix4): ZenRotation {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out.push(matrix.elements[col * 4 + row]);
  }
  return out as ZenRotation;
}

export class GizmoController {
  private readonly proxy = new THREE.Object3D();
  private readonly transform: DampedTransformControls;

  /** What the gizmo drives, and where each of them started the drag. A
   *  selection can hold VOBs that are not drawn at all — a decal, a sound VOB,
   *  anything unresolved — and those have no instance to preview. They are
   *  still in the batch: the op is built from the index, which knows where they
   *  are, and only the preview needs an instance. */
  private vobs: readonly number[] = [];
  /** The other thing the gizmo can be on, and never at the same time as the
   *  VOBs above. A waypoint's position is in the *same* space as the proxy's
   *  local one — the overlay hangs under the same mirrored root — so unlike a
   *  VOB there is nothing to convert on the way in or out. */
  private waypoint: number | null = null;
  private waypointFrom: [number, number, number] | null = null;
  private readonly dragFrom = new Map<number, [number, number, number]>();
  private readonly turnFrom = new Map<number, ZenRotation>();
  private readonly proxyFrom = new THREE.Vector3();
  private readonly proxyTurnFrom = new THREE.Quaternion();
  // Scratch, so a drag frame allocates nothing.
  private readonly turn = new THREE.Quaternion();
  private readonly turnMatrix = new THREE.Matrix4();
  /** A drag ends with a pointerup that the browser also delivers as a click on
   *  the canvas, *after* the gizmo has already reported the drag finished — so
   *  a flag that is true only during the drag would already be false by then.
   *  This one is consumed by the click it belongs to. */
  private endedDrag = false;
  /** Which anchor `attach` uses, and therefore a value the mode switch has to
   *  re-attach on — see `anchorFor`. */
  private modeNow: GizmoMode;

  constructor(private readonly options: GizmoControllerOptions) {
    this.modeNow = options.mode;
    options.world.root.add(this.proxy);

    // Damped rather than the library's own, because its rotate rate is a
    // turntable's — see `DampedTransformControls`.
    this.transform = new DampedTransformControls(options.camera, options.canvas);
    this.transform.setSpace('world');
    // The mode it is built in, rather than the library's `translate` default:
    // the viewport's mode effect corrects it a tick later anyway, and a
    // controller whose constructor argument did not take effect is one whose
    // rules cannot be read on their own.
    this.transform.setMode(options.mode);
    options.scene.add(this.transform.getHelper());
    this.transform.enabled = false;
    this.transform.getHelper().visible = false;

    this.transform.addEventListener('dragging-changed', this.onDraggingChanged);
    this.transform.addEventListener('objectChange', this.onObjectChange);
  }

  /** What `enabled` means here is "something is selected" (`attach`/`detach`),
   *  which is why a nav press, a stroke and a walk each give back the state
   *  they found rather than a guessed one. */
  get enabled(): boolean { return this.transform.enabled; }
  set enabled(on: boolean) { this.transform.enabled = on; }

  get helperVisible(): boolean { return this.transform.getHelper().visible; }
  set helperVisible(visible: boolean) { this.transform.getHelper().visible = visible; }

  /** Whether the click now arriving is the tail of a drag, and clears it —
   *  picking here would select whatever sits behind the gizmo, usually nothing,
   *  so a finished drag would deselect the VOB it just moved. */
  consumeEndedDrag(): boolean {
    if (!this.endedDrag) return false;
    this.endedDrag = false;
    return true;
  }

  /**
   * Where the gizmo stands for a selection (§16.24 2).
   *
   * The middle of it while translating, and the last VOB picked while rotating.
   * Not one answer for both, because `rotateVobs` turns each VOB about *its
   * own* origin: a rotate gizmo at the centroid would show a pivot the op does
   * not use, and the first multi-VOB rotate would look broken. Translating has
   * no such pivot — the drag reports a delta from wherever the proxy was picked
   * up — so the centre is free there and is what the handles should sit in.
   */
  private anchorFor(vobs: readonly number[]) {
    return this.modeNow === 'rotate'
      ? this.options.world.anchorOf(vobs)
      : this.options.world.centroidOf(vobs);
  }

  attach(vobs: readonly number[]): void {
    const position = this.anchorFor(vobs);
    this.vobs = position === null ? [] : vobs;
    this.waypoint = null;

    if (position === null) { this.detach(); return; }
    this.proxy.position.set(position[0], position[1], position[2]);
    // The proxy's own orientation is reset on every attach: the gizmo reports a
    // *delta* from where it was picked up, so what it starts from only has to
    // be the same at the press and at the release.
    this.proxy.quaternion.identity();
    this.transform.attach(this.proxy);
    this.transform.enabled = true;
    this.transform.getHelper().visible = true;
  }

  /**
   * Put the gizmo on a waypoint instead.
   *
   * Translate only, and that is a fact about the op set rather than about the
   * gizmo: `MoveWaypoint` is the only waynet op there is. A waypoint does carry
   * a direction, but nothing writes one yet, so a rotate ring here would turn
   * something the world would never be told about.
   */
  attachWaypoint(waypoint: number | null): void {
    this.vobs = [];
    this.waypoint = null;

    const overlay = this.options.overlay();
    if (waypoint === null || overlay === null) { this.detach(); return; }

    this.waypoint = waypoint;
    const position = overlay.positionOf(waypoint);
    this.proxy.position.set(position[0], position[1], position[2]);
    this.proxy.quaternion.identity();
    this.transform.setMode('translate');
    this.transform.attach(this.proxy);
    this.transform.enabled = true;
    this.transform.getHelper().visible = true;
  }

  /**
   * The mode buttons and the W/E keys keep working while a waypoint is
   * selected; they just have nothing to switch to. Ignored rather than
   * disabled, so the mode the VOBs were in survives a detour through the
   * waynet.
   */
  setMode(mode: GizmoMode): void {
    this.modeNow = mode;
    this.transform.setMode(this.waypoint === null ? mode : 'translate');
    // The anchor is the mode's, so W and E move the gizmo as well as changing
    // its handles — a rotate gizmo left standing at the centroid would turn
    // about a pivot no op uses.
    if (this.waypoint === null && this.vobs.length > 0) this.attach(this.vobs);
  }

  private detach(): void {
    this.transform.detach();
    this.transform.enabled = false;
    this.transform.getHelper().visible = false;
  }

  private readonly onDraggingChanged = (event: { value: unknown }) => {
    const dragging = event.value as boolean;
    this.options.controls.enabled = !dragging;

    if (dragging) {
      // Where everything was when the drag began. Read once: the preview writes
      // the instance matrices this would otherwise be read back out of, so a
      // per-frame read would compound the delta. For a waypoint, reading once
      // is not an optimisation but the only way to still know where it started
      // — the preview writes the overlay's own positions, which is the array
      // this would be read out of.
      this.waypointFrom = this.waypoint === null
        ? null
        : this.options.overlay()?.positionOf(this.waypoint) ?? null;
      this.proxyFrom.copy(this.proxy.position);
      this.proxyTurnFrom.copy(this.proxy.quaternion);
      this.dragFrom.clear();
      this.turnFrom.clear();
      for (const vob of this.vobs) {
        const position = this.options.world.positionOf(vob);
        if (position !== null) this.dragFrom.set(vob, position);
        const rotation = this.options.world.rotationOf(vob);
        if (rotation !== null) this.turnFrom.set(vob, rotation as ZenRotation);
      }
      return;
    }

    this.endedDrag = true;

    if (this.waypoint !== null) {
      const from = this.waypointFrom;
      if (from === null) return;
      const to: [number, number, number] = [
        this.proxy.position.x, this.proxy.position.y, this.proxy.position.z,
      ];
      // A click that dragged nothing. Committing it would put an op on the undo
      // stack that undoes nothing.
      if (to.every((component, axis) => component === from[axis])) return;
      this.options.onMoveWaypoint(this.waypoint, from, to);
      return;
    }

    if (this.vobs.length === 0) return;

    if (this.transform.getMode() === 'rotate') {
      const delta = this.turnDelta();
      // Identity is a click that turned nothing, and committing it would put
      // one op per selected VOB on the undo stack for a batch that undoes
      // nothing.
      if (delta === null) return;
      this.options.onRotate(delta);
      return;
    }

    const delta: [number, number, number] = [
      this.proxy.position.x - this.proxyFrom.x,
      this.proxy.position.y - this.proxyFrom.y,
      this.proxy.position.z - this.proxyFrom.z,
    ];
    if (delta.every((component) => component === 0)) return;
    this.options.onTranslate(delta);
  };

  /**
   * The turn since the drag began, row-major in ZenGin space — or null if the
   * gizmo has not actually turned.
   *
   * **The proxy's local orientation is not in ZenGin's basis, though its local
   * position is.** `TransformControls` builds its parent-inverse by decomposing
   * the parent's `matrixWorld`, and `Matrix4.decompose` answers a negative
   * determinant by negating `scale.x` — so the mirrored root decomposes to a
   * scale of (-0.01, 0.01, 0.01) and a rotation of *identity*, and the flip
   * never reaches the quaternion. Translation survives that (the offset is
   * divided by the same negative scale); a rotation does not, and the VOB
   * turned the opposite way to the ring about Y and about Z, X being the
   * mirrored axis and therefore the one that looked correct.
   *
   * So the delta is conjugated by the mirror on the way out, in `coords`, with
   * the rest of the conversion. `tests/gizmoRotation.test.ts` pins both library
   * behaviours this depends on.
   */
  private turnDelta(): ZenRotation | null {
    // q_now = delta * q_start, so delta = q_now * q_start⁻¹.
    this.turn.copy(this.proxyTurnFrom).invert().premultiply(this.proxy.quaternion);
    if (Math.abs(this.turn.w) >= 1) return null;
    return mirrorRotation(rowMajor(this.turnMatrix.makeRotationFromQuaternion(this.turn)));
  }

  /**
   * Quantise the drag, by writing the snapped pose back onto the proxy.
   *
   * On the proxy rather than on the delta the commit reports, because the proxy
   * is what everything downstream reads: the live preview, the two commits, a
   * waypoint's destination and `verify-world-edit.js`'s harness all take their
   * number from it, and snapping any one of them separately would be a second
   * place the step has to be applied. `TransformControls` recomputes the pose
   * from where the press left it on every pointer move, so writing back cannot
   * accumulate — this is what its own snapping does.
   */
  private snapProxy(): void {
    if (this.transform.getMode() === 'rotate') {
      // The turn since the press, snapped and put back — the proxy's start
      // orientation is arbitrary (`attach` resets it), so only the delta is a
      // quantity a step means anything against.
      this.turn.copy(this.proxyTurnFrom).invert().premultiply(this.proxy.quaternion);
      snapTurn(this.turn, this.options.snapAngle());
      this.proxy.quaternion.copy(this.proxyTurnFrom).premultiply(this.turn);
      return;
    }

    const snapped = snapDelta([
      this.proxy.position.x - this.proxyFrom.x,
      this.proxy.position.y - this.proxyFrom.y,
      this.proxy.position.z - this.proxyFrom.z,
    ], this.options.snapGrid());
    this.proxy.position.set(
      this.proxyFrom.x + snapped[0], this.proxyFrom.y + snapped[1], this.proxyFrom.z + snapped[2],
    );
  }

  /** The live preview. The world in the main process still has the VOBs where
   *  they were; this is the drag being drawn, and it is made real on release. */
  private readonly onObjectChange = () => {
    this.snapProxy();

    if (this.waypoint !== null) {
      // Straight into the array the point cloud and the edge lines share, so
      // the edges into this waypoint follow the drag instead of pointing at
      // where it used to be for as long as the drag lasts.
      this.options.overlay()?.setPosition(this.waypoint, [
        this.proxy.position.x, this.proxy.position.y, this.proxy.position.z,
      ]);
      return;
    }

    if (this.transform.getMode() === 'rotate') {
      const delta = this.turnDelta();
      if (delta === null) return;
      for (const [vob, from] of this.turnFrom) {
        this.options.world.rotateVob(vob, multiplyRotation(delta, from));
      }
      return;
    }

    for (const [vob, from] of this.dragFrom) {
      this.options.world.moveVob(vob, [
        from[0] + this.proxy.position.x - this.proxyFrom.x,
        from[1] + this.proxy.position.y - this.proxyFrom.y,
        from[2] + this.proxy.position.z - this.proxyFrom.z,
      ]);
    }
  };

  // ── the `__worldViewport` harness (verify-world-edit.js) ──────────────────
  //
  // Driving the gizmo means firing the whole sequence a real drag fires, in
  // order: the press is what records where everything started, and a delta
  // measured from a stale origin is the defect this stands to catch. It lives
  // here rather than in the harness object because the proxy and the controls
  // are this class's, and reaching into them is what the split removes.

  /** Drag the gizmo to a point, in the proxy's own (ZenGin) local space. */
  dragTo(to: readonly [number, number, number]): void {
    if (this.vobs.length === 0 && this.waypoint === null) {
      throw new Error('nothing is selected');
    }
    this.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    this.proxy.position.set(to[0], to[1], to[2]);
    this.transform.dispatchEvent({ type: 'objectChange' });
    this.transform.dispatchEvent({ type: 'dragging-changed', value: false });
  }

  /** Turn the gizmo about an axis given **in ZenGin space**, like everything an
   *  op carries, so the driver can predict the answer. The proxy's quaternion
   *  is not in that basis (see `turnDelta`), so the turn is built in ZenGin and
   *  conjugated into the proxy's frame by the same function that converts it
   *  back — which is its own inverse, so this cannot be applied the wrong way. */
  turnBy(axis: readonly [number, number, number], radians: number): void {
    if (this.vobs.length === 0) throw new Error('no VOB is selected');
    this.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    const inZen = rowMajor(this.turnMatrix.makeRotationFromQuaternion(
      this.turn.setFromAxisAngle(
        new THREE.Vector3(axis[0], axis[1], axis[2]).normalize(), radians,
      ),
    ));
    const asProxy = mirrorRotation(inZen);
    this.proxy.quaternion.setFromRotationMatrix(this.turnMatrix.set(
      asProxy[0], asProxy[1], asProxy[2], 0,
      asProxy[3], asProxy[4], asProxy[5], 0,
      asProxy[6], asProxy[7], asProxy[8], 0,
      0, 0, 0, 1,
    ));
    this.transform.dispatchEvent({ type: 'objectChange' });
    this.transform.dispatchEvent({ type: 'dragging-changed', value: false });
  }

  /** The rotation of the VOB the rotate anchor stands on, or null. */
  rotation(): ZenRotation | null {
    return this.vobs.length === 0
      ? null
      : this.options.world.rotationOf(this.vobs[this.vobs.length - 1]) as ZenRotation | null;
  }

  /** Where the gizmo stands, or null when it stands on nothing. */
  position(): [number, number, number] | null {
    return this.vobs.length === 0 && this.waypoint === null
      ? null
      : [this.proxy.position.x, this.proxy.position.y, this.proxy.position.z];
  }

  dispose(): void {
    this.transform.removeEventListener('dragging-changed', this.onDraggingChanged);
    this.transform.removeEventListener('objectChange', this.onObjectChange);
    this.transform.detach();
    this.options.scene.remove(this.transform.getHelper());
    this.transform.dispose();
  }
}
