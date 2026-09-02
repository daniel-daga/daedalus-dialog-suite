import * as THREE from 'three';

// Fly navigation — the first-person half of the camera, beside the orbit in
// `cameraNav` (plan §16.26 row 3). The idiom every 3D editor shares: hold the
// right button to look, WASD to move, Q/E for down/up, Shift to hurry. No
// mode to enter and none to leave, which is what lets it share the viewport
// with a right *click* that opens the context menu — the hold and the click
// are told apart by whether anything moved (`moved`).
//
// No gravity and no collision: this is a fly, not a walk. The walk that
// collides against the picking BVH is the open half of §16.26 row 3.

export type FlyMove = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';

// Keyed by `KeyboardEvent.code`, the physical key: on an AZERTY or a German
// layout W/A/S/D are still the cluster under the left hand.
const MOVE_FOR_CODE: Record<string, FlyMove> = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyE: 'up', KeyQ: 'down',
};

/** The movement a key code asks for, or null for a key the fly does not own. */
export function flyMoveFor(code: string): FlyMove | null {
  return MOVE_FOR_CODE[code] ?? null;
}

/** A screen width of drag is a little over a full turn — the rate a
 *  pointer-lock first-person view uses, and OrbitControls' own is a full turn
 *  per width. */
export const LOOK_RADIANS_PER_PIXEL = 0.003;
export const FAST_MULTIPLIER = 4;
/** Three units are metres (`ZEN_TO_THREE_SCALE`). Two metres a second is a
 *  walk indoors; two kilometres a second crosses the largest retail world in
 *  under a second, which is as fast as anyone can steer. */
export const MIN_FLY_SPEED = 2;
export const MAX_FLY_SPEED = 2000;
/** Short of the pole, so the Euler decomposition never flips and the
 *  `lookAt` that OrbitControls does on the way back has an up to use. */
const PITCH_LIMIT = Math.PI / 2 - 0.01;
/** A frame after a stall — a hidden tab, a debugger — moves this much at most,
 *  rather than the whole stall's worth in one jump. */
const MAX_STEP_SECONDS = 0.1;

/**
 * Metres per second for a fly begun with the orbit pivot this far away: the
 * distance itself, so that a camera framed on a barrel creeps and one framed
 * on the island crosses it in about a second — the same scaling OrbitControls
 * gives its dolly and pan, for the same reason.
 */
export function flySpeedFor(pivotDistance: number): number {
  return Math.min(Math.max(pivotDistance, MIN_FLY_SPEED), MAX_FLY_SPEED);
}

// Scratch, so a frame allocates nothing.
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const stride = new THREE.Vector3();

/** One right-mouse hold: lives from the press to the release. */
export class Fly {
  private readonly held = new Set<FlyMove>();
  private fast = false;
  private last: number | null = null;
  /** Whether the hold turned or moved the camera at all — what tells a fly
   *  from a right click. */
  moved = false;

  constructor(
    private readonly camera: THREE.Camera,
    /** Metres per second, before Shift. */
    readonly speed: number,
  ) {}

  /** Turn by a mouse delta in pixels. Yaw about the world's up, pitch about
   *  the camera's right, never any roll: YXZ Euler is exactly that. */
  look(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    euler.setFromQuaternion(this.camera.quaternion);
    euler.y -= dx * LOOK_RADIANS_PER_PIXEL;
    euler.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, euler.x - dy * LOOK_RADIANS_PER_PIXEL));
    this.camera.quaternion.setFromEuler(euler);
    this.moved = true;
  }

  /** A key went down. True if the fly took it, so the caller can keep it from
   *  whoever else binds that letter. `shiftKey` is read on every key event,
   *  which is how Shift itself is seen going down and up. */
  press(code: string, shiftKey: boolean): boolean {
    this.fast = shiftKey;
    const move = flyMoveFor(code);
    if (move === null) return false;
    this.held.add(move);
    return true;
  }

  release(code: string, shiftKey: boolean): void {
    this.fast = shiftKey;
    const move = flyMoveFor(code);
    if (move !== null) this.held.delete(move);
  }

  /** Advance to `now` (milliseconds, `performance.now()`), moving by whatever
   *  is held. Forward follows the view, including its pitch; up and down are
   *  the world's, so a dive can be climbed out of without looking up first. */
  step(now: number): void {
    const dt = this.last === null ? 0 : Math.min((now - this.last) / 1000, MAX_STEP_SECONDS);
    this.last = now;
    if (this.held.size === 0 || dt === 0) return;

    const distance = this.speed * (this.fast ? FAST_MULTIPLIER : 1) * dt;
    stride.set(
      (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0),
      0,
      (this.held.has('back') ? 1 : 0) - (this.held.has('forward') ? 1 : 0),
    );
    if (stride.lengthSq() > 0) {
      stride.normalize().multiplyScalar(distance).applyQuaternion(this.camera.quaternion);
      this.camera.position.add(stride);
    }
    this.camera.position.y += distance * ((this.held.has('up') ? 1 : 0) - (this.held.has('down') ? 1 : 0));
    this.moved = true;
  }
}

// Scratch for `pivotAhead`.
const ahead = new THREE.Vector3();

/**
 * Re-seat the orbit pivot on the view axis, `distance` ahead of the camera —
 * what a fly does on release. OrbitControls re-aims at its target on every
 * `update()`, so a pivot left where it was would snap the view back to it,
 * and one at a different distance would rescale the next dolly and pan.
 */
export function pivotAhead(camera: THREE.Camera, target: THREE.Vector3, distance: number): void {
  camera.getWorldDirection(ahead);
  target.copy(camera.position).addScaledVector(ahead, distance);
}
