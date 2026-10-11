/**
 * Walk navigation — the half of §16.26 row 3 that touches the ground: WASD
 * along the yaw-flattened view, gravity, and a capsule resolved against the
 * picking BVH so a wall stops the walker and a floor carries him.
 *
 * Real `three` and a real `MeshBVH` built on the main thread over a
 * hand-authored floor and wall in ZenGin centimetres — the space the world
 * mesh's buffers are in and the BVH is built against. Everything the walker
 * integrates is in Three metres, so every case here crosses the unit boundary
 * the implementation has to get right.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import {
  Walk, walkMoveFor, resolveWalkCapsule, snapWalkToFloor, findWalkEntry,
  WALK_SPEED, GRAVITY_ACCEL, TERMINAL_FALL_SPEED, WALK_RADIUS_CM, EYE_HEIGHT_CM,
  COLLISION_EPSILON_CM, FLOOR_SNAP_DISTANCE_CM,
} from '../src/renderer/world/walkNav';
import { turnCamera, FAST_MULTIPLIER, LOOK_RADIANS_PER_PIXEL, MAX_STEP_SECONDS } from '../src/renderer/world/flyNav';

const EYE = EYE_HEIGHT_CM / 100;
const R = WALK_RADIUS_CM / 100;

/** A mesh in ZenGin centimetres with a BVH on it, exactly as `BvhBuilder`
 *  leaves the world mesh — the tree on `geometry.boundsTree`, the vertices
 *  untouched. */
function meshOf(vertices: number[], triangles: number[]): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(triangles), 1));
  geometry.boundsTree = new MeshBVH(geometry);
  return new THREE.Mesh(geometry);
}

/** A 40 m square floor at ZenGin y = 0. */
const floor = () => meshOf(
  [-2000, 0, -2000, 2000, 0, -2000, 2000, 0, 2000, -2000, 0, 2000],
  [0, 1, 2, 0, 2, 3],
);
/** A wall across ZenGin z = 100 (Three z = 1 m), 4 m tall, spanning x. */
const wall = () => meshOf(
  [-2000, 0, 100, 2000, 0, 100, 2000, 400, 100, -2000, 400, 100],
  [0, 1, 2, 0, 2, 3],
);
/** A slab the walker can stand on 3 m up, for the ceiling case. */
const slabAt = (zenY: number) => meshOf(
  [-2000, zenY, -2000, 2000, zenY, -2000, 2000, zenY, 2000, -2000, zenY, 2000],
  [0, 1, 2, 0, 2, 3],
);

const lookingDownMinusZ = () => {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
  camera.lookAt(0, 0, -1);
  return camera;
};

const direction = (camera: THREE.Camera) => camera.getWorldDirection(new THREE.Vector3());

describe('walkNav', () => {
  test('WASD walk; Q and E, the fly\'s climb and dive, are not the walker\'s', () => {
    expect(walkMoveFor('KeyW')).toBe('forward');
    expect(walkMoveFor('KeyS')).toBe('back');
    expect(walkMoveFor('KeyA')).toBe('left');
    expect(walkMoveFor('KeyD')).toBe('right');
    expect(walkMoveFor('KeyQ')).toBeNull();
    expect(walkMoveFor('KeyE')).toBeNull();
    expect(walkMoveFor('Space')).toBeNull();
  });

  describe('resolveWalkCapsule', () => {
    test('a capsule sunk into the floor is pushed up by the overlap, in metres', () => {
      const feet = new THREE.Vector3(0, -0.1, 0);
      const pushed = resolveWalkCapsule(feet, [floor()]);
      expect(pushed).toBeCloseTo(10, 3);
      expect(feet.y).toBeCloseTo(0, 6);
      expect(feet.x).toBeCloseTo(0, 6);
      expect(feet.z).toBeCloseTo(0, 6);
    });

    test('a capsule standing clear reports next to nothing and is not moved', () => {
      const feet = new THREE.Vector3(1, 0.5, -1);
      expect(resolveWalkCapsule(feet, [floor(), wall()])).toBeLessThan(COLLISION_EPSILON_CM);
      expect(feet.toArray()).toEqual([1, 0.5, -1]);
    });

    test('a mesh without a tree yet is skipped, not a crash: trees land asynchronously', () => {
      const bare = new THREE.Mesh(new THREE.BufferGeometry());
      const feet = new THREE.Vector3(0, -0.1, 0);
      expect(resolveWalkCapsule(feet, [bare, floor()])).toBeCloseTo(10, 3);
    });

    test('walking into the wall pushes straight back out, with no vertical drift', () => {
      // Feet on the floor, axis 10 cm short of the wall's plane: 15 cm into it.
      const feet = new THREE.Vector3(0, 0, 0.9);
      resolveWalkCapsule(feet, [floor(), wall()]);
      expect(feet.z).toBeCloseTo(1 - R, 4);
      expect(feet.y).toBeCloseTo(0, 4);
      expect(feet.x).toBeCloseTo(0, 6);
    });

    test('a floor-and-wall corner settles at least a radius from both within the iteration budget', () => {
      const feet = new THREE.Vector3(0, -0.15, 0.9);
      resolveWalkCapsule(feet, [floor(), wall()]);
      expect(feet.y).toBeGreaterThanOrEqual(-COLLISION_EPSILON_CM / 100);
      expect(feet.z).toBeLessThanOrEqual(1 - R + COLLISION_EPSILON_CM / 100);
      expect(feet.x).toBeCloseTo(0, 6);
    });
  });

  describe('snapWalkToFloor', () => {
    test('feet hovering within the snap distance are set down on the floor', () => {
      const feet = new THREE.Vector3(2, (FLOOR_SNAP_DISTANCE_CM - 1) / 100, -3);
      expect(snapWalkToFloor(feet, [floor()])).toBe(true);
      expect(feet.y).toBeCloseTo(0, 6);
      expect(feet.x).toBe(2);
      expect(feet.z).toBe(-3);
    });

    test('feet further up than that are in the air', () => {
      const feet = new THREE.Vector3(0, (FLOOR_SNAP_DISTANCE_CM + 5) / 100, 0);
      expect(snapWalkToFloor(feet, [floor()])).toBe(false);
      expect(feet.y).toBeCloseTo((FLOOR_SNAP_DISTANCE_CM + 5) / 100, 6);
    });

    test('over nothing at all — the edge of the world — nothing is grounded', () => {
      expect(snapWalkToFloor(new THREE.Vector3(500, 0, 500), [floor()])).toBe(false);
    });
  });

  describe('findWalkEntry', () => {
    test('a camera already standing in the open enters where it is', () => {
      const eye = new THREE.Vector3(3, EYE + 0.5, -3);
      const entry = findWalkEntry(eye, [floor()], 100);
      expect(entry).not.toBeNull();
      expect(entry!.toArray()).toEqual([3, EYE + 0.5, -3]);
    });

    test('a camera with its feet in the floor searches upward to the first clear spot', () => {
      const eye = new THREE.Vector3(0, EYE - 0.1, 0);
      const entry = findWalkEntry(eye, [floor()], 100);
      expect(entry).not.toBeNull();
      // Feet above the floor, and no further up than one search step — the
      // stepping is what finds the way out, not a guess.
      expect(entry!.y - EYE).toBeGreaterThanOrEqual(-1e-6);
      expect(entry!.y - EYE).toBeLessThan(1);
      expect(entry!.x).toBe(0);
      expect(entry!.z).toBe(0);
    });

    test('a world whose top is below the only clear spot refuses, with null', () => {
      // Feet 10 cm under a slab at 3 m: the first clear spot is above the
      // slab, and the world is declared to end before it.
      const eye = new THREE.Vector3(0, EYE + 2.9, 0);
      expect(findWalkEntry(eye, [slabAt(300), floor()], 10)!.y - EYE).toBeCloseTo(3.4, 6);
      expect(findWalkEntry(eye, [slabAt(300), floor()], 3.2)).toBeNull();
    });
  });

  describe('Walk.step', () => {
    const standing = (meshes: THREE.Mesh[], at = new THREE.Vector3(0, EYE, 0)) => {
      const camera = lookingDownMinusZ();
      camera.position.copy(at);
      return { camera, walk: new Walk(camera, meshes) };
    };

    test('a held W walks along the view at WALK_SPEED, kept on the floor', () => {
      const { camera, walk } = standing([floor()]);
      walk.step(1000);
      expect(walk.press('KeyW', false)).toBe(true);
      walk.step(1100);
      expect(camera.position.z).toBeCloseTo(-WALK_SPEED * 0.1, 6);
      expect(camera.position.y).toBeCloseTo(EYE, 6);
      expect(camera.position.x).toBeCloseTo(0, 9);
      expect(walk.grounded).toBe(true);
    });

    test('looking straight down, W still walks horizontally — the wish direction is the yaw alone', () => {
      const { camera, walk } = standing([floor()]);
      walk.look(0, 100000);
      expect(direction(camera).y).toBeLessThan(-0.99);
      walk.press('KeyW', false);
      walk.step(0);
      walk.step(100);
      expect(camera.position.z).toBeCloseTo(-WALK_SPEED * 0.1, 6);
      expect(camera.position.y).toBeCloseTo(EYE, 6);
    });

    test('A and D strafe along the flattened right, turning with the yaw', () => {
      const { camera, walk } = standing([]);
      walk.look(Math.PI / 2 / LOOK_RADIANS_PER_PIXEL, 0);
      walk.press('KeyD', false);
      walk.step(0);
      walk.step(100);
      // A quarter turn to the right from -Z looks along +X; right of that is +Z.
      expect(camera.position.z).toBeCloseTo(WALK_SPEED * 0.1, 6);
      expect(camera.position.x).toBeCloseTo(0, 6);
    });

    test('a walk into the wall stops at the wall', () => {
      const { camera, walk } = standing([floor(), wall()], new THREE.Vector3(0, EYE, 0.5));
      walk.look(Math.PI / LOOK_RADIANS_PER_PIXEL, 0);
      walk.press('KeyW', false);
      walk.step(0);
      for (let t = 100; t <= 1000; t += 100) walk.step(t);
      expect(camera.position.z).toBeCloseTo(1 - R, 3);
      expect(camera.position.y).toBeCloseTo(EYE, 4);
    });

    test('gravity accelerates at GRAVITY_ACCEL and caps at TERMINAL_FALL_SPEED', () => {
      const { camera, walk } = standing([], new THREE.Vector3(0, 100, 0));
      walk.step(0);
      walk.step(100);
      expect(100 - camera.position.y).toBeCloseTo(GRAVITY_ACCEL * 0.1 * 0.1, 9);
      walk.step(200);
      expect(100 - camera.position.y).toBeCloseTo(GRAVITY_ACCEL * 0.1 * 0.1 * 3, 9);
      expect(walk.grounded).toBe(false);

      let t = 200;
      for (let i = 0; i < 40; i++) walk.step(t += 100);
      const before = camera.position.y;
      walk.step(t += 100);
      expect(before - camera.position.y).toBeCloseTo(TERMINAL_FALL_SPEED * 0.1, 9);
    });

    test('landing sets grounded and stops the descent', () => {
      const { camera, walk } = standing([floor()], new THREE.Vector3(0, EYE + 3, 0));
      let t = 0;
      walk.step(t);
      for (let i = 0; i < 20; i++) walk.step(t += 100);
      expect(walk.grounded).toBe(true);
      expect(camera.position.y).toBeCloseTo(EYE, 4);
      walk.step(t += 100);
      expect(camera.position.y).toBeCloseTo(EYE, 4);
    });

    test('Shift walks FAST_MULTIPLIER times faster for as long as it is held', () => {
      const { camera, walk } = standing([floor()]);
      walk.press('KeyW', true);
      walk.step(0);
      walk.step(100);
      expect(camera.position.z).toBeCloseTo(-WALK_SPEED * FAST_MULTIPLIER * 0.1, 6);
      walk.release('ShiftLeft', false);
      walk.step(200);
      expect(camera.position.z).toBeCloseTo(-WALK_SPEED * (FAST_MULTIPLIER + 1) * 0.1, 6);
    });

    test('a frame after a long stall moves one bounded step', () => {
      const { camera, walk } = standing([floor()]);
      walk.press('KeyW', false);
      walk.step(0);
      walk.step(60000);
      expect(-camera.position.z).toBeCloseTo(WALK_SPEED * MAX_STEP_SECONDS, 6);
    });

    test('keys the walk does not own are declined, so the caller lets them through', () => {
      const { walk } = standing([]);
      expect(walk.press('KeyQ', false)).toBe(false);
      expect(walk.press('Delete', false)).toBe(false);
    });
  });

  describe('turnCamera, shared with the fly', () => {
    test('a horizontal delta yaws about the world up, a vertical one pitches', () => {
      const camera = lookingDownMinusZ();
      turnCamera(camera, 100, 0);
      const turned = direction(camera);
      expect(turned.y).toBeCloseTo(0, 9);
      expect(Math.atan2(turned.x, -turned.z)).toBeCloseTo(100 * LOOK_RADIANS_PER_PIXEL, 9);
      turnCamera(camera, 0, 100);
      const pitched = direction(camera);
      expect(pitched.y).toBeLessThan(0);
      expect(Math.atan2(pitched.x, -pitched.z)).toBeCloseTo(100 * LOOK_RADIANS_PER_PIXEL, 9);
    });

    test('pitch stops short of the poles', () => {
      const camera = lookingDownMinusZ();
      turnCamera(camera, 0, 100000);
      expect(direction(camera).y).toBeLessThan(-0.99);
      expect(direction(camera).z).toBeLessThan(0);
      turnCamera(camera, 0, -200000);
      expect(direction(camera).y).toBeGreaterThan(0.99);
      expect(direction(camera).z).toBeLessThan(0);
    });
  });
});
