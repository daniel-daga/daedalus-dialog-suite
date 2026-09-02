import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { threeToZen, zenToThree } from 'zen-world';
import { FAST_MULTIPLIER, MAX_STEP_SECONDS, turnCamera } from './flyNav';
import { DUMMY_CYLINDER_HEIGHT, DUMMY_HEIGHT, DUMMY_RADIUS } from './SpawnOverlay';

// Walk navigation — the grounded half of §16.26 row 3, beside the fly. A
// modder placing objects along a path walks it in Spacer, at a person's eye
// height, stopped by walls and carried by floors; a fly answers none of that.
// F3 toggles it (Spacer's key), the mouse looks under pointer lock, WASD walks
// along the yaw-flattened view, Shift hurries, gravity does the rest.
//
// No physics engine: the picking BVH already on the world mesh (`BvhBuilder`)
// answers both questions a walker asks — a capsule swept against triangles
// for the walls, a ray down for the floor. The body is the spawn overlay's
// dummy, so the walker is exactly what the overlay draws standing on a
// waypoint.
//
// **Two unit systems meet here, and that is the whole difficulty.** The
// camera lives in Three metres; the world mesh's buffers — and so the BVH —
// are raw ZenGin centimetres under a mirrored root. Integration (wish,
// gravity, the entry search) stays in metres and only the BVH queries cross
// over, through `threeToZen`/`zenToThree`, which carry the mirror as well as
// the scale. A centimetre push-out added straight onto `camera.position` is
// the easiest way to ship this wrong.

export type WalkMove = 'forward' | 'back' | 'left' | 'right';

// Keyed by `KeyboardEvent.code` for the reason `flyNav` gives. No Q/E: a
// walker has no up and down of his own.
const MOVE_FOR_CODE: Record<string, WalkMove> = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
};

/** The movement a key code asks for, or null for a key the walk does not own. */
export function walkMoveFor(code: string): WalkMove | null {
  return MOVE_FOR_CODE[code] ?? null;
}

/** Metres per second: a brisk walk. Shift multiplies by the fly's factor. */
export const WALK_SPEED = 4;
/** Three units are metres, so gravity is Earth's. */
export const GRAVITY_ACCEL = 9.8;
/** Bounds one `MAX_STEP_SECONDS` frame to two metres of fall — under a storey,
 *  so a stalled tab cannot tunnel a floor. */
export const TERMINAL_FALL_SPEED = 20;
export const WALK_RADIUS_CM = DUMMY_RADIUS;
export const WALK_CYLINDER_HEIGHT_CM = DUMMY_CYLINDER_HEIGHT;
/** The eye is the top of the dummy: 180 cm, the hero's. */
export const EYE_HEIGHT_CM = DUMMY_HEIGHT;
/** Push-out rounds per frame. A corner needs more than one — the floor's push
 *  moves the capsule into the wall's — and three settles anything a walker
 *  meets. */
export const COLLISION_ITERATIONS = 3;
/** A round that moved less than this is done; below it is float noise. */
export const COLLISION_EPSILON_CM = 0.1;
/** How far below the feet a floor still catches them — a step down, a slope,
 *  the sag of one gravity frame. Further than that is a fall. */
export const FLOOR_SNAP_DISTANCE_CM = 15;
/** The floor ray starts this far above the feet, so feet resting a hair
 *  inside the floor still see it. */
export const FLOOR_SNAP_PROBE_ABOVE_CM = 10;
/** The entry search climbs by this much per test, in metres. */
export const ENTRY_SEARCH_STEP = 0.5;
/** Where the orbit pivot lands when a walk ends, in metres ahead of the eye:
 *  the fly's own reach does not transfer, since a walk can cross the level. */
export const WALK_EXIT_PIVOT_DISTANCE = 5;

// Scratch, so a frame allocates nothing. Everything in this block is ZenGin
// centimetres, the BVH's space.
const feetCm = new THREE.Vector3();
const segment = new THREE.Line3();
const segmentBounds = new THREE.Box3();
const triPoint = new THREE.Vector3();
const segPoint = new THREE.Vector3();
const push = new THREE.Vector3();
const floorRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

const treeOf = (mesh: THREE.Mesh): MeshBVH | null => (
  // The trees land asynchronously, mesh by mesh; a mesh without one yet is
  // walked through rather than waited for, and the next frame sees the tree.
  (mesh.geometry.boundsTree as MeshBVH | undefined) ?? null
);

/**
 * Push the capsule standing on `feetThree` (Three metres, mutated in place)
 * out of every triangle it overlaps. Returns the total distance corrected, in
 * centimetres — under `COLLISION_EPSILON_CM` means it was already clear.
 *
 * The capsule is a segment from the bottom sphere's centre to the top's,
 * swept by the radius; the BVH is walked directly, not through `Raycaster`,
 * because a capsule is not a ray. Each overlapping triangle moves the whole
 * segment along the closest-points direction by the overlap, and the rounds
 * repeat until nothing moves.
 */
export function resolveWalkCapsule(feetThree: THREE.Vector3, worldMeshes: readonly THREE.Mesh[]): number {
  feetCm.set(...threeToZen(feetThree.toArray() as [number, number, number]));
  segment.start.copy(feetCm).setY(feetCm.y + WALK_RADIUS_CM);
  segment.end.copy(feetCm).setY(feetCm.y + EYE_HEIGHT_CM - WALK_RADIUS_CM);

  let total = 0;
  for (let round = 0; round < COLLISION_ITERATIONS; round++) {
    let moved = 0;
    for (const mesh of worldMeshes) {
      const tree = treeOf(mesh);
      if (tree === null) continue;
      segmentBounds.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end)
        .expandByScalar(WALK_RADIUS_CM);
      tree.shapecast({
        intersectsBounds: (box) => box.intersectsBox(segmentBounds),
        intersectsTriangle: (tri) => {
          const distance = tri.closestPointToSegment(segment, triPoint, segPoint);
          if (distance >= WALK_RADIUS_CM) return false;
          push.subVectors(segPoint, triPoint);
          // The axis runs through the triangle: no direction to push along,
          // so the face's own normal stands in for it.
          if (push.lengthSq() < 1e-12) tri.getNormal(push); else push.normalize();
          const overlap = WALK_RADIUS_CM - distance;
          segment.start.addScaledVector(push, overlap);
          segment.end.addScaledVector(push, overlap);
          moved += overlap;
          return false;
        },
      });
    }
    total += moved;
    if (moved < COLLISION_EPSILON_CM) break;
  }

  feetCm.copy(segment.start).setY(segment.start.y - WALK_RADIUS_CM);
  feetThree.set(...zenToThree(feetCm.toArray() as [number, number, number]));
  return total;
}

/**
 * Set `feetThree` (Three metres, mutated in place) down on the floor beneath
 * it, if there is one within `FLOOR_SNAP_DISTANCE_CM`. True when it landed.
 */
export function snapWalkToFloor(feetThree: THREE.Vector3, worldMeshes: readonly THREE.Mesh[]): boolean {
  feetCm.set(...threeToZen(feetThree.toArray() as [number, number, number]));
  floorRay.origin.copy(feetCm).setY(feetCm.y + FLOOR_SNAP_PROBE_ABOVE_CM);

  let nearest: THREE.Intersection | null = null;
  for (const mesh of worldMeshes) {
    const tree = treeOf(mesh);
    if (tree === null) continue;
    // Both sides: a floor's winding is whatever the level's author left it.
    const hit = tree.raycastFirst(floorRay, THREE.DoubleSide);
    if (hit !== null && (nearest === null || hit.distance < nearest.distance)) nearest = hit;
  }
  if (nearest === null || nearest.distance > FLOOR_SNAP_PROBE_ABOVE_CM + FLOOR_SNAP_DISTANCE_CM) return false;

  feetCm.setY(nearest.point.y);
  feetThree.set(...zenToThree(feetCm.toArray() as [number, number, number]));
  return true;
}

// Scratch for the entry search and the step, in Three metres.
const probeFeet = new THREE.Vector3();
const candidateFeet = new THREE.Vector3();
const wish = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Where a walk begun with the eye at `eyePositionThree` should start, or null
 * if there is nowhere: the spot itself when it is clear — the common open-air
 * case, one test — and otherwise the first clear spot straight above it, in
 * `ENTRY_SEARCH_STEP` steps, up to the world's own top (`ceilingThreeY`,
 * the bbox's converted max). Starting inside geometry is not refused
 * outright, because the camera is very often inside a hill when F3 is
 * pressed; only a search that finds nothing is.
 */
export function findWalkEntry(
  eyePositionThree: THREE.Vector3, worldMeshes: readonly THREE.Mesh[], ceilingThreeY: number,
): THREE.Vector3 | null {
  const eye = EYE_HEIGHT_CM / 100;
  for (let offset = 0; ; offset += ENTRY_SEARCH_STEP) {
    const feetY = eyePositionThree.y - eye + offset;
    if (feetY > ceilingThreeY) return null;
    probeFeet.set(eyePositionThree.x, feetY, eyePositionThree.z);
    if (resolveWalkCapsule(probeFeet, worldMeshes) < COLLISION_EPSILON_CM) {
      return new THREE.Vector3(eyePositionThree.x, feetY + eye, eyePositionThree.z);
    }
  }
}

/** One walk: lives from F3 to F3, or to the pointer lock being lost. */
export class Walk {
  private readonly held = new Set<WalkMove>();
  private fast = false;
  private last: number | null = null;
  /** Vertical velocity, metres per second, negative downward. */
  private vertical = 0;
  private onFloor = false;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly worldMeshes: readonly THREE.Mesh[],
  ) {}

  /** Turn by a mouse delta in pixels — the fly's look, under pointer lock. */
  look(dx: number, dy: number): void {
    turnCamera(this.camera, dx, dy);
  }

  /** A key went down. True if the walk took it, so the caller keeps it from
   *  whoever else binds that letter; `shiftKey` as in `Fly.press`. */
  press(code: string, shiftKey: boolean): boolean {
    this.fast = shiftKey;
    const move = walkMoveFor(code);
    if (move === null) return false;
    this.held.add(move);
    return true;
  }

  release(code: string, shiftKey: boolean): void {
    this.fast = shiftKey;
    const move = walkMoveFor(code);
    if (move !== null) this.held.delete(move);
  }

  /** Standing on something, as of the last step. */
  get grounded(): boolean {
    return this.onFloor;
  }

  /**
   * Advance to `now` (milliseconds, `performance.now()`).
   *
   * Reads `camera.position` fresh and caches nothing about it, so a `Home` or
   * a camera-slot recall mid-walk is simply re-grounded next frame. The wish
   * direction is the yaw alone: looking at the floor while pressing W walks
   * forward, as in every first-person game, rather than into the floor.
   */
  step(now: number): void {
    const dt = this.last === null ? 0 : Math.min((now - this.last) / 1000, MAX_STEP_SECONDS);
    this.last = now;
    if (dt === 0) return;

    euler.setFromQuaternion(this.camera.quaternion);
    const yaw = euler.y;
    const forward = (this.held.has('forward') ? 1 : 0) - (this.held.has('back') ? 1 : 0);
    const right = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    wish.set(
      -Math.sin(yaw) * forward + Math.cos(yaw) * right,
      0,
      -Math.cos(yaw) * forward - Math.sin(yaw) * right,
    );
    if (wish.lengthSq() > 0) {
      wish.normalize().multiplyScalar(WALK_SPEED * (this.fast ? FAST_MULTIPLIER : 1) * dt);
    }

    if (this.onFloor) this.vertical = Math.max(this.vertical, 0);
    this.vertical = Math.max(this.vertical - GRAVITY_ACCEL * dt, -TERMINAL_FALL_SPEED);

    const eye = EYE_HEIGHT_CM / 100;
    wish.y += this.vertical * dt;
    candidateFeet.copy(this.camera.position).setY(this.camera.position.y - eye);
    // In pieces no longer than half the radius: the push-out is by nearest
    // point, so an axis that has already crossed a wall's plane is pushed on
    // through it. A sprint at 60 fps moves more than a radius per frame, and
    // a stalled frame at `MAX_STEP_SECONDS` moves more than a metre.
    const pieces = Math.max(1, Math.ceil(wish.length() / (WALK_RADIUS_CM / 100 / 2)));
    wish.divideScalar(pieces);
    for (let piece = 0; piece < pieces; piece++) {
      candidateFeet.add(wish);
      resolveWalkCapsule(candidateFeet, this.worldMeshes);
    }
    this.onFloor = snapWalkToFloor(candidateFeet, this.worldMeshes);
    this.camera.position.copy(candidateFeet).setY(candidateFeet.y + eye);
  }
}
