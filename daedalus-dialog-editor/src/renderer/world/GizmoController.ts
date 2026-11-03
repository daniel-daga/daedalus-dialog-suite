import * as THREE from 'three';
import {
  multiplyRotation, turnAbout, type SubtreeMember, type ZenRotation,
} from 'zen-world';
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

/** Which axes the gizmo's handles stand on: the VOB's own, or the world's. */
export type GizmoSpace = 'local' | 'world';

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
  /** Which axes the handles stand on: the anchor VOB's own, or the world's. */
  space: GizmoSpace;
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
  /**
   * What a drag of `vobs` moves: each of them and its descendants, with the
   * selected VOB each turns about (#292) — `subtreeMembers` over the index, the
   * same answer the ops are built from, so the preview is the commit. Absent,
   * a drag moves the selection alone.
   */
  membersOf?: (vobs: readonly number[]) => readonly SubtreeMember[];
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

/** A row-major 3x3 as a 4x4 with no translation — the form every rotation here
 *  travels in. */
const rotationMatrix = (rotation: readonly number[]): THREE.Matrix4 => new THREE.Matrix4().set(
  rotation[0], rotation[1], rotation[2], 0,
  rotation[3], rotation[4], rotation[5], 0,
  rotation[6], rotation[7], rotation[8], 0,
  0, 0, 0, 1,
);

/**
 * The proxy's own rotation for a translate drag: the anchor VOB's, verbatim
 * (level-editor.md §7, #414).
 *
 * A VOB turned on a table has to still move along the table's edges, which a
 * world-aligned gizmo cannot do. The proxy hangs under the mirrored root, so
 * its *position* is ZenGin and its orientation plainly is not — but a
 * quaternion cannot carry a mirror, and the gizmo's own layout reads the
 * orientation back through `Matrix4.decompose`, which folds the X flip into
 * `scale.x`. Carrying the stored rotation unchanged is therefore what puts the
 * handles on the VOB's axes; `localDragFix` is the other half of the pair.
 *
 * A **turn** carries the same frame, so the rings follow the VOB too; the delta
 * it reports is conjugated back out through `turnReflection`. A selection still
 * turns as one shared delta about the anchor's axis, which is the semantic
 * `rotateVobs` has (§16.4).
 */
export function localGizmoFrame(rotation: ZenRotation): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(rotationMatrix(rotation));
}

/**
 * What puts a local translate drag back on the axis it was drawn along.
 *
 * `TransformControls` lays its handles out from the *decomposed world*
 * rotation, but turns the pointer travel by the object's own quaternion, and
 * under the mirrored root those two disagree by `A F A⁻¹ F` — F being the X
 * mirror. Uncorrected, a VOB turned a quarter about Y drags the wrong way along
 * its own X and Z. Applied to the travel rather than to the pose, so the live
 * preview, the snap and the commit all still read one number off the proxy.
 */
export function localDragFix(frame: THREE.Quaternion): THREE.Quaternion {
  const turn = new THREE.Matrix4().makeRotationFromQuaternion(frame);
  const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
  return new THREE.Quaternion().setFromRotationMatrix(
    turn.clone().multiply(mirror).multiply(turn.clone().invert()).multiply(mirror),
  );
}

/**
 * The reflection a turn is conjugated by: `A F A⁻¹`, with `A` the anchor's own
 * rotation — F alone (`A` = identity) in world space.
 *
 * A turn leaves the gizmo as the proxy's own rotation, and taking it back to
 * the op means changing basis twice: out of the proxy's frame with `A`, and
 * across the mirrored root with the same conjugation a world-space turn
 * already gets (`mirrorRotation`). The composition is one reflection, and a
 * conjugation by a reflection squares to the identity — which is why
 * `turnBy` reads the same function backwards without a second derivation.
 */
export function turnReflection(frame: THREE.Quaternion | null): THREE.Matrix4 {
  const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
  if (frame === null) return mirror;
  const anchor = new THREE.Matrix4().makeRotationFromQuaternion(frame);
  return anchor.clone().multiply(mirror).multiply(anchor.clone().invert());
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
  /** The selected VOB each dragged one turns about — itself for a selected
   *  VOB, its selected ancestor for a descendant carried along (#292). */
  private readonly rootOf = new Map<number, number>();
  private readonly proxyFrom = new THREE.Vector3();
  private readonly proxyTurnFrom = new THREE.Quaternion();
  /** The anchor's own axes, in ZenGin space, while the handles stand on them
   *  (#414) — null in world space, or for a VOB the scene draws no orientation
   *  for. Kept with its inverse because the snap reads the pair every frame. */
  private localFrame: THREE.Quaternion | null = null;
  private readonly localFrameInverse = new THREE.Quaternion();
  /** The rotation that corrects the library's local travel — `localDragFix`. */
  private localFix: THREE.Quaternion | null = null;
  /** What a turn's proxy rotation is conjugated by on the way out — see
   *  `turnReflection`. F in world space, `A F A⁻¹` when the gizmo stands on the
   *  anchor's axes. */
  private readonly turnMirror = new THREE.Matrix4();
  /** True while `dragTo` drives the gizmo: the harness supplies the proxy's
   *  final pose itself, so the library's reflected travel is not in play. */
  private harnessDrag = false;
  // Scratch, so a drag frame allocates nothing.
  private readonly turn = new THREE.Quaternion();
  private readonly turnMatrix = new THREE.Matrix4();
  /** Where `turnDelta` builds the conjugated turn — scratch, like the two
   *  above, because this runs on every frame of a drag. */
  private readonly turnOut = new THREE.Matrix4();
  private readonly travel = new THREE.Vector3();
  /** A drag ends with a pointerup that the browser also delivers as a click on
   *  the canvas, *after* the gizmo has already reported the drag finished — so
   *  a flag that is true only during the drag would already be false by then.
   *  This one is consumed by the click it belongs to. */
  private endedDrag = false;
  /** Which anchor `attach` uses, and therefore a value the mode switch has to
   *  re-attach on — see `anchorFor`. */
  private modeNow: GizmoMode;
  /** The axes the translate handles stand on, read by `orientProxy`. */
  private spaceNow: GizmoSpace;

  constructor(private readonly options: GizmoControllerOptions) {
    this.modeNow = options.mode;
    this.spaceNow = options.space;
    this.turnMirror.copy(turnReflection(null));
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
    this.orientProxy();
    this.transform.attach(this.proxy);
    this.transform.enabled = true;
    this.transform.getHelper().visible = true;
  }

  /**
   * Stand the proxy on the selection's own axes (#414) — the last VOB picked,
   * as every other row of the grid describes the last one. A VOB the scene
   * draws no orientation for (a sound, a decal) has none to give, and the gizmo
   * falls back to the world's.
   */
  private orientProxy(): void {
    // Only in local space does the library draw its handles from the object's
    // orientation at all; in world space it draws them axis-aligned whatever
    // the proxy says.
    const local = this.spaceNow === 'local';
    this.transform.setSpace(local ? 'local' : 'world');

    let anchor: number[] | null = null;
    if (local) {
      for (let at = this.vobs.length - 1; at >= 0 && anchor === null; at--) {
        anchor = this.options.world.rotationOf(this.vobs[at]);
      }
    }

    if (anchor === null) {
      this.localFrame = null;
      this.localFix = null;
      this.turnMirror.copy(turnReflection(null));
      this.proxy.quaternion.identity();
      return;
    }

    this.localFrame = localGizmoFrame(anchor as ZenRotation);
    this.localFrameInverse.copy(this.localFrame).invert();
    this.localFix = localDragFix(this.localFrame);
    this.turnMirror.copy(turnReflection(this.localFrame));
    this.proxy.quaternion.copy(this.localFrame);
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
    // No VOB under it, so no axes to stand on.
    this.localFrame = null;
    this.localFix = null;
    this.transform.setMode('translate');
    this.transform.attach(this.proxy);
    this.transform.enabled = true;
    this.transform.getHelper().visible = true;
  }

  /**
   * The mode buttons and the 1/2 keys keep working while a waypoint is
   * selected; they just have nothing to switch to. Ignored rather than
   * disabled, so the mode the VOBs were in survives a detour through the
   * waynet.
   */
  setMode(mode: GizmoMode): void {
    this.modeNow = mode;
    this.transform.setMode(this.waypoint === null ? mode : 'translate');
    // The anchor is the mode's, so 1 and 2 move the gizmo as well as changing
    // its handles — a rotate gizmo left standing at the centroid would turn
    // about a pivot no op uses.
    if (this.waypoint === null && this.vobs.length > 0) this.attach(this.vobs);
  }

  /** Local or world axes for the handles. Re-attaches, because the axes are
   *  what `attach` puts on the proxy — nothing else about the selection
   *  changes. */
  setSpace(space: GizmoSpace): void {
    this.spaceNow = space;
    if (this.waypoint === null && this.vobs.length > 0) this.attach(this.vobs);
  }

  private detach(): void {
    this.transform.detach();
    this.transform.enabled = false;
    this.transform.getHelper().visible = false;
  }

  /** Where everything was when the drag began. Read once: the preview writes
   *  the instance matrices this would otherwise be read back out of, so a
   *  per-frame read would compound the delta. For a waypoint, reading once is
   *  not an optimisation but the only way to still know where it started — the
   *  preview writes the overlay's own positions, which is the array this would
   *  be read out of. */
  private recordDragStart(): void {
    this.waypointFrom = this.waypoint === null
      ? null
      : this.options.overlay()?.positionOf(this.waypoint) ?? null;
    this.proxyFrom.copy(this.proxy.position);
    this.proxyTurnFrom.copy(this.proxy.quaternion);
    this.dragFrom.clear();
    this.turnFrom.clear();
    this.rootOf.clear();
    const members = this.options.membersOf?.(this.vobs)
      ?? this.vobs.map((vob) => ({ vob, root: vob }));
    for (const { vob, root } of members) {
      this.rootOf.set(vob, root);
      const position = this.options.world.positionOf(vob);
      if (position !== null) this.dragFrom.set(vob, position);
      const rotation = this.options.world.rotationOf(vob);
      if (rotation !== null) this.turnFrom.set(vob, rotation as ZenRotation);
    }
  }

  /** Draw the selection moved by the proxy's travel since the drag began. */
  private previewTranslation(): void {
    for (const [vob, from] of this.dragFrom) {
      this.options.world.moveVob(vob, [
        from[0] + this.proxy.position.x - this.proxyFrom.x,
        from[1] + this.proxy.position.y - this.proxyFrom.y,
        from[2] + this.proxy.position.z - this.proxyFrom.z,
      ]);
    }
  }

  /**
   * A keyboard nudge (WASD held down) is drawn like a translate drag: it
   * records where the selection starts, then `previewNudge` moves the proxy
   * and the preview by a delta from there. No commit of its own — the caller
   * already holds the delta and commits it as a drag's would be. False with
   * no VOBs under the gizmo, a waypoint included: `MoveWaypoint` is not what
   * a nudge commits.
   */
  beginNudge(): boolean {
    if (this.vobs.length === 0) return false;
    this.recordDragStart();
    return true;
  }

  previewNudge(delta: readonly [number, number, number]): void {
    if (this.vobs.length === 0) return;
    this.proxy.position.set(
      this.proxyFrom.x + delta[0], this.proxyFrom.y + delta[1], this.proxyFrom.z + delta[2],
    );
    this.previewTranslation();
  }

  /** A keyboard turn (#387), the rotate counterpart of `previewNudge`: begun
   *  by `beginNudge`, drawn as the selection turned by `delta` (row-major,
   *  ZenGin space) from where it began. */
  previewTurn(delta: ZenRotation): void {
    if (this.vobs.length === 0) return;
    this.previewRotation(delta);
  }

  private readonly onDraggingChanged = (event: { value: unknown }) => {
    const dragging = event.value as boolean;
    this.options.controls.enabled = !dragging;

    if (dragging) {
      this.recordDragStart();
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
   *
   * **In local space there is no such conversion.** The proxy then carries the
   * anchor's own rotation `A`, and the library multiplies its turn onto it —
   * `q_now = A R A⁻¹` — which is already the delta the VOB wants: `rotateVobs`
   * applies a delta on the left, and `A R A⁻¹` turns the VOB about its own
   * axis, exactly as the ring does on screen. Conjugating that by the mirror
   * again (as the world branch must) would turn it about a different axis.
   */
  private turnDelta(): ZenRotation | null {
    // q_now = delta * q_start, so delta = q_now * q_start⁻¹.
    this.turn.copy(this.proxyTurnFrom).invert().premultiply(this.proxy.quaternion);
    if (Math.abs(this.turn.w) >= 1) return null;
    // The proxy's own turn, conjugated out of its basis and across the mirror —
    // `C Q C⁻¹`, which is the world branch's `mirrorRotation` when C is F.
    this.turnOut
      .multiplyMatrices(this.turnMirror, this.turnMatrix.makeRotationFromQuaternion(this.turn))
      .multiply(this.turnMirror);
    return rowMajor(this.turnOut);
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
      // orientation is whatever `attach` gave it (the anchor's, or the identity
      // in world space), so only the delta is a quantity a step means anything
      // against.
      this.turn.copy(this.proxyTurnFrom).invert().premultiply(this.proxy.quaternion);
      snapTurn(this.turn, this.options.snapAngle());
      this.proxy.quaternion.copy(this.proxyTurnFrom).premultiply(this.turn);
      return;
    }

    const delta: [number, number, number] = [
      this.proxy.position.x - this.proxyFrom.x,
      this.proxy.position.y - this.proxyFrom.y,
      this.proxy.position.z - this.proxyFrom.z,
    ];
    const snapped = this.localFrame === null
      ? snapDelta(delta, this.options.snapGrid())
      : this.snapAlongAnchor(delta, this.localFrame);
    this.proxy.position.set(
      this.proxyFrom.x + snapped[0], this.proxyFrom.y + snapped[1], this.proxyFrom.z + snapped[2],
    );
  }

  /** The step measured along the anchor's own axes — the ones the handles are
   *  drawn on — rather than along the world's. */
  private snapAlongAnchor(
    delta: [number, number, number], frame: THREE.Quaternion,
  ): [number, number, number] {
    this.travel.set(delta[0], delta[1], delta[2]).applyQuaternion(this.localFrameInverse);
    const snapped = snapDelta(
      [this.travel.x, this.travel.y, this.travel.z], this.options.snapGrid());
    this.travel.set(snapped[0], snapped[1], snapped[2]).applyQuaternion(frame);
    return [this.travel.x, this.travel.y, this.travel.z];
  }

  /** Put a local translate drag back on the axis it was drawn along — see
   *  `localDragFix` — before the snap and the preview read the proxy. */
  private correctLocalTranslate(): void {
    if (this.localFix === null || this.harnessDrag) return;
    this.travel.set(
      this.proxy.position.x - this.proxyFrom.x,
      this.proxy.position.y - this.proxyFrom.y,
      this.proxy.position.z - this.proxyFrom.z,
    ).applyQuaternion(this.localFix);
    this.proxy.position.set(
      this.proxyFrom.x + this.travel.x,
      this.proxyFrom.y + this.travel.y,
      this.proxyFrom.z + this.travel.z,
    );
  }

  /** The live preview. The world in the main process still has the VOBs where
   *  they were; this is the drag being drawn, and it is made real on release. */
  private readonly onObjectChange = () => {
    this.correctLocalTranslate();
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
      this.previewRotation(delta);
      return;
    }

    this.previewTranslation();
  };

  /** Draw the selection turned by `delta` since the drag began. */
  private previewRotation(delta: ZenRotation): void {
    for (const [vob, from] of this.turnFrom) {
      this.options.world.rotateVob(vob, multiplyRotation(delta, from));
      // A descendant also swings round the selected VOB it belongs to, as
      // `rotateSubtrees` swings it. One whose root is not drawn has no
      // origin to swing round here, and waits for the commit.
      const root = this.rootOf.get(vob) ?? vob;
      const at = this.dragFrom.get(vob);
      const origin = this.dragFrom.get(root);
      if (root !== vob && at !== undefined && origin !== undefined) {
        this.options.world.moveVob(vob, turnAbout(at, origin, delta));
      }
    }
  }

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
    this.harnessDrag = true;
    this.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    this.proxy.position.set(to[0], to[1], to[2]);
    this.transform.dispatchEvent({ type: 'objectChange' });
    this.transform.dispatchEvent({ type: 'dragging-changed', value: false });
    this.harnessDrag = false;
  }

  /** Turn the gizmo about an axis given **in ZenGin space**, like everything an
   *  op carries, so the driver can predict the answer. The proxy's quaternion is
   *  not in that basis (see `turnDelta`), so the turn is built in ZenGin and
   *  conjugated into the proxy's frame by the same reflection `turnDelta` takes
   *  it back out with. */
  turnBy(axis: readonly [number, number, number], radians: number): void {
    if (this.vobs.length === 0) throw new Error('no VOB is selected');
    this.transform.dispatchEvent({ type: 'dragging-changed', value: true });
    const inZen = rowMajor(this.turnMatrix.makeRotationFromQuaternion(
      this.turn.setFromAxisAngle(
        new THREE.Vector3(axis[0], axis[1], axis[2]).normalize(), radians,
      ),
    ));
    // `turnDelta` conjugates by a reflection, and a reflection squared is the
    // identity — so reading it backwards is the same conjugation, and the
    // proxy rotation it needs is the delta turned into its own frame.
    const asProxy = this.turnMirror.clone()
      .multiply(rotationMatrix(inZen))
      .multiply(this.turnMirror);
    // The drag starts wherever the proxy already stands — identity in world
    // space, the anchor's rotation in local space — so the delta composes onto
    // it rather than replacing it.
    this.proxy.quaternion
      .setFromRotationMatrix(asProxy)
      .multiply(this.localFrame ?? new THREE.Quaternion());
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
