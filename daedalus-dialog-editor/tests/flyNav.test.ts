/**
 * Fly navigation — the first-person half of the viewport's camera (plan
 * §16.26 row 3). Right-mouse-hold looks, WASD/QE moves, Shift is faster, and
 * the speed comes from how far the orbit pivot was when the hold began, so a
 * 1 km island and a barrel are both crossable at a sensible pace.
 *
 * Real `three` under jsdom: this is camera arithmetic, and none of it needs a
 * GL context.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import {
  Fly, flyMoveFor, flySpeedFor, pivotAhead,
  FAST_MULTIPLIER, MIN_FLY_SPEED, MAX_FLY_SPEED, LOOK_RADIANS_PER_PIXEL,
} from '../src/renderer/world/flyNav';

const lookingDownMinusZ = () => {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
};

const direction = (camera: THREE.Camera) => camera.getWorldDirection(new THREE.Vector3());

describe('flyNav', () => {
  test('WASD moves, Q/E climb and descend, by key *code* so a layout cannot rename them', () => {
    expect(flyMoveFor('KeyW')).toBe('forward');
    expect(flyMoveFor('KeyS')).toBe('back');
    expect(flyMoveFor('KeyA')).toBe('left');
    expect(flyMoveFor('KeyD')).toBe('right');
    expect(flyMoveFor('KeyE')).toBe('up');
    expect(flyMoveFor('KeyQ')).toBe('down');
    expect(flyMoveFor('KeyF')).toBeNull();
    expect(flyMoveFor('Space')).toBeNull();
  });

  test('speed is the pivot distance per second, clamped so a wall and a whole island both work', () => {
    expect(flySpeedFor(300)).toBe(300);
    expect(flySpeedFor(0.01)).toBe(MIN_FLY_SPEED);
    expect(flySpeedFor(1e6)).toBe(MAX_FLY_SPEED);
  });

  test('a horizontal mouse drag turns about the world up axis, a vertical one pitches', () => {
    const camera = lookingDownMinusZ();
    const fly = new Fly(camera, 10);

    fly.look(100, 0);
    const turned = direction(camera);
    expect(turned.y).toBeCloseTo(0, 9);
    // Dragging right looks right: from -Z, that is towards +X.
    expect(turned.x).toBeGreaterThan(0);
    expect(Math.atan2(turned.x, -turned.z)).toBeCloseTo(100 * LOOK_RADIANS_PER_PIXEL, 9);

    fly.look(0, 100);
    // Dragging down looks down, and the yaw the first drag set is kept.
    const pitched = direction(camera);
    expect(pitched.y).toBeLessThan(0);
    expect(Math.atan2(pitched.x, -pitched.z)).toBeCloseTo(100 * LOOK_RADIANS_PER_PIXEL, 9);
    expect(camera.position.toArray()).toEqual([0, 0, 0]);
  });

  test('pitch stops short of straight down, so the view never rolls over', () => {
    const camera = lookingDownMinusZ();
    const fly = new Fly(camera, 10);

    fly.look(0, 100000);
    const down = direction(camera);
    expect(down.y).toBeLessThan(-0.99);
    // Still pointing the way it was, not flipped through the pole.
    expect(down.z).toBeLessThan(0);

    fly.look(0, -200000);
    expect(direction(camera).y).toBeGreaterThan(0.99);
    expect(direction(camera).z).toBeLessThan(0);
  });

  test('a held key moves along the view at speed × time (10 m/s, 100 ms frames), and nothing moves with nothing held', () => {
    const camera = lookingDownMinusZ();
    const fly = new Fly(camera, 10);

    fly.step(1000);
    fly.step(1500);
    expect(camera.position.toArray()).toEqual([0, 0, 0]);
    expect(fly.moved).toBe(false);

    expect(fly.press('KeyW', false)).toBe(true);
    fly.step(1600);
    expect(camera.position.z).toBeCloseTo(-1, 9);
    expect(fly.moved).toBe(true);

    fly.release('KeyW', false);
    fly.press('KeyD', false);
    fly.step(1700);
    expect(camera.position.x).toBeCloseTo(1, 9);
    expect(camera.position.z).toBeCloseTo(-1, 9);
  });

  test('forward follows the pitch, but up and down are the world\'s, so a dive can still climb out', () => {
    const camera = lookingDownMinusZ();
    const fly = new Fly(camera, 10);
    fly.look(0, 100000);

    fly.press('KeyW', false);
    fly.step(0);
    fly.step(100);
    expect(camera.position.y).toBeLessThan(-0.99);
    fly.release('KeyW', false);

    fly.press('KeyE', false);
    fly.step(200);
    expect(camera.position.y).toBeGreaterThan(-0.02);
    expect(camera.position.x).toBeCloseTo(0, 9);
  });

  test('Shift multiplies the speed for as long as it is held', () => {
    const camera = lookingDownMinusZ();
    const fly = new Fly(camera, 10);

    fly.press('KeyW', true);
    fly.step(0);
    fly.step(100);
    expect(camera.position.z).toBeCloseTo(-FAST_MULTIPLIER, 9);

    fly.release('ShiftLeft', false);
    fly.step(200);
    expect(camera.position.z).toBeCloseTo(-FAST_MULTIPLIER - 1, 9);
  });

  test('a frame after a long stall moves one bounded step, not the whole stall', () => {
    const camera = lookingDownMinusZ();
    const fly = new Fly(camera, 10);
    fly.press('KeyW', false);
    fly.step(0);
    fly.step(60000);
    expect(-camera.position.z).toBeLessThan(2);
  });

  test('keys the fly does not own are declined, so the caller lets them through', () => {
    const fly = new Fly(lookingDownMinusZ(), 10);
    expect(fly.press('Delete', false)).toBe(false);
    expect(fly.press('KeyZ', false)).toBe(false);
  });

  test('pivotAhead puts the orbit target on the view axis at the given distance', () => {
    const camera = lookingDownMinusZ();
    camera.position.set(3, 4, 5);
    new Fly(camera, 10).look(100, 50);
    const target = new THREE.Vector3(-999, -999, -999);

    pivotAhead(camera, target, 40);

    const expected = camera.position.clone().addScaledVector(direction(camera), 40);
    expect(target.distanceTo(expected)).toBeLessThan(1e-9);
    expect(target.distanceTo(camera.position)).toBeCloseTo(40, 9);
  });
});
