/**
 * Gizmo snapping — the maths (level-editor.md §14.1 item 1.6).
 *
 * Both halves are relative: what is quantised is the *delta* the drag has
 * produced, never the resulting position or orientation. `snapping.ts` says why;
 * these are the properties that reasoning has to hold to.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { snapDelta, snapTurn } from '../src/renderer/world/snapping';

/** The turn a quaternion represents, in radians, regardless of which of the two
 *  double-cover representations it is. */
function angleOf(quaternion: THREE.Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(quaternion.w)));
}

describe('snapDelta', () => {
  it('is off at a step of zero — the default', () => {
    expect(snapDelta([7.5, -3.25, 0.1], 0)).toEqual([7.5, -3.25, 0.1]);
  });

  it('quantises each axis to the nearest multiple, ZenGin centimetres', () => {
    // 100 cm is one metre, the step a designer reaches for first.
    expect(snapDelta([137, 149, 151], 100)).toEqual([100, 100, 200]);
  });

  it('quantises a negative delta the same way', () => {
    expect(snapDelta([-137, -60, -40], 100)).toEqual([-100, -100, -0]);
  });

  it('quantises a drag that has barely moved to nothing', () => {
    // Which the viewport then declines to commit at all: a zero delta is a
    // click, and an op for it would undo nothing.
    expect(snapDelta([3, -4, 1], 50)).toEqual([0, -0, 0]);
  });
});

describe('snapTurn', () => {
  const STEP = Math.PI / 12; // 15 degrees

  it('is off at a step of zero', () => {
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
    snapTurn(turn, 0);
    expect(angleOf(turn)).toBeCloseTo(0.3, 6);
  });

  it('rounds the angle to the nearest step and keeps the axis', () => {
    const axis = new THREE.Vector3(0, 1, 0);
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, 0.3);
    snapTurn(turn, STEP);

    expect(angleOf(turn)).toBeCloseTo(STEP, 6);
    // Same axis, same direction: a snap must not turn the VOB the other way.
    const snappedAxis = new THREE.Vector3(turn.x, turn.y, turn.z).normalize();
    expect(snappedAxis.dot(axis)).toBeCloseTo(1, 6);
  });

  it('rounds an angle over half a step up', () => {
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4);
    snapTurn(turn, STEP);
    expect(angleOf(turn)).toBeCloseTo(2 * STEP, 6);
  });

  it('leaves a turn of nothing alone rather than dividing by a zero axis', () => {
    // A press with no drag: the axis is undefined here, and reconstructing one
    // from it would author a rotation out of floating-point noise.
    const turn = new THREE.Quaternion();
    snapTurn(turn, STEP);
    expect(angleOf(turn)).toBe(0);
    expect(turn.w).toBe(1);
  });

  it('quantises a small turn to no turn', () => {
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.05);
    snapTurn(turn, STEP);
    // Identity, which the viewport reads as "turned nothing" and does not commit.
    expect(angleOf(turn)).toBeCloseTo(0, 6);
  });
});
