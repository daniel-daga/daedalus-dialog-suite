/**
 * Fly navigation — the first-person half of the viewport's camera (plan
 * §16.26 row 3). Right-mouse-hold looks, WASD moves, Space/X climbs and
 * descends, Shift is faster and Ctrl is not the fly's at all (#405, #415).
 * One fixed base speed, whatever the orbit pivot is doing (#405).
 *
 * Real `three` under jsdom: this is camera arithmetic, and none of it needs a
 * GL context.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import {
  Fly, flyMoveFor, pivotAhead,
  FLY_SPEED, FAST_MULTIPLIER, LOOK_RADIANS_PER_PIXEL,
} from '../src/renderer/world/flyNav';

const lookingDownMinusZ = () => {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
};

const direction = (camera: THREE.Camera) => camera.getWorldDirection(new THREE.Vector3());

describe('flyNav', () => {
  test('WASD moves, Space/X climb and descend, by key *code* so a layout cannot rename them', () => {
    expect(flyMoveFor('KeyW')).toBe('forward');
    expect(flyMoveFor('KeyS')).toBe('back');
    expect(flyMoveFor('KeyA')).toBe('left');
    expect(flyMoveFor('KeyD')).toBe('right');
    expect(flyMoveFor('Space')).toBe('up');
    expect(flyMoveFor('KeyX')).toBe('down');
    expect(flyMoveFor('KeyF')).toBeNull();
    expect(flyMoveFor('KeyQ')).toBeNull();
  });

  test('a tap moves the base speed times the time held, so a press is a step and not a leap', () => {
    const camera = lookingDownMinusZ();
    const fly = new Fly(camera, FLY_SPEED);

    // A 150 ms tap at real frame times: three 50 ms frames.
    fly.press('Space', false);
    fly.step(0);
    fly.step(50);
    fly.step(100);
    fly.step(150);
    expect(camera.position.y).toBeCloseTo(FLY_SPEED * 0.15, 9);
    // A click-sized tap is a metre and a half whatever the pivot is doing: the
    // pivot's distance is not a speed any more (#405).
    expect(camera.position.y).toBeLessThan(5);
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

    fly.press('Space', false);
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

  test("Ctrl is not the fly's: a Ctrl-modified move is declined, so the app's chord runs (#415)", () => {
    const camera = lookingDownMinusZ();
    const fly = new Fly(camera, 10);

    expect(fly.press('KeyW', false, true)).toBe(false);
    expect(fly.press('KeyS', false, true)).toBe(false);
    expect(fly.press('KeyA', false, true)).toBe(false);
    fly.step(0);
    fly.step(100);
    expect(camera.position.toArray()).toEqual([0, 0, 0]);

    // And Ctrl letting go mid-hold does not strand a key: a plain press moves.
    expect(fly.press('KeyW', false, false)).toBe(true);
    fly.step(200);
    expect(camera.position.z).toBeCloseTo(-1, 9);
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
