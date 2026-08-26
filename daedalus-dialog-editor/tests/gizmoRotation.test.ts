/**
 * Why a gizmo rotation has to be conjugated by the mirror (level-editor.md §7).
 *
 * `WorldViewport` reads a turn off the proxy's *local* quaternion, and the proxy
 * hangs under the mirrored root — so the obvious reading is that its local
 * orientation is already in ZenGin's basis and needs no conversion. That is true
 * of its position and false of its orientation, and the difference is not
 * visible anywhere in this repo's code: it lives inside `Matrix4.decompose` and
 * `TransformControls`.
 *
 * These tests pin the two library behaviours the conversion exists to survive.
 * Delete `mirrorRotation` from the turn path and they still pass — they are not
 * a test *of* the fix, they are the evidence for it, and the fix's own test is
 * in `zen-world/test/coords.test.ts`.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { ROOT_MATRIX, mirrorRotation, zenToThree } from 'zen-world';

const rowMajor = (m: THREE.Matrix4): number[] => {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out.push(m.elements[col * 4 + row]);
  }
  return out;
};

describe('a gizmo turn under the mirrored root', () => {
  test('decompose hides the mirror in the scale, and reports no rotation at all', () => {
    // The whole reason a quaternion cannot be trusted across this boundary.
    // TransformControls builds its parent-inverse from exactly this call
    // (three/examples/jsm/controls/TransformControls.js: `parent.matrixWorld
    // .decompose( _parentPosition, _parentQuaternion, _parentScale )`).
    const root = new THREE.Object3D();
    root.matrixAutoUpdate = false;
    root.matrix.fromArray([...ROOT_MATRIX]);
    root.updateMatrixWorld(true);

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    root.matrixWorld.decompose(position, quaternion, scale);

    // The flip is in the scale...
    expect(scale.x).toBeCloseTo(-0.01, 12);
    expect(scale.y).toBeCloseTo(0.01, 12);
    // ...and the rotation it should have been part of is the identity, so a
    // parent-inverse built from it is a no-op and the mirror is simply lost.
    expect(quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 12);
  });

  test('the local quaternion a world-space drag produces is the unconjugated turn', () => {
    // TransformControls' world-space branch, reproduced: rotate the axis by the
    // parent-inverse (identity, per the test above) and premultiply. What lands
    // in `object.quaternion` is therefore the world-space rotation verbatim,
    // even though the object's parent mirrors X.
    const parentQuaternionInv = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(parentQuaternionInv);
    const drag = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2);

    const local = rowMajor(new THREE.Matrix4().makeRotationFromQuaternion(drag));
    const asZen = mirrorRotation(local);

    // Read as ZenGin, the raw local turn is the *opposite* quarter turn to the
    // one the ring was dragged through — the defect, in the units it appeared
    // in. Conjugated, it is the one the user asked for.
    const apply = (m: readonly number[], p: readonly number[]) => [
      m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
      m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
      m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
    ];

    // A point one metre along +X in ZenGin, turned, then converted for the
    // screen, must land where the same point converted and then turned by the
    // drag lands. That is what "the VOB follows the ring" means.
    const point: [number, number, number] = [100, 0, 0];
    const drawnAfterZenTurn = zenToThree(apply(asZen, point) as [number, number, number]);
    const draggedOnScreen = new THREE.Vector3(...zenToThree(point)).applyQuaternion(drag);

    expect(drawnAfterZenTurn[0]).toBeCloseTo(draggedOnScreen.x, 9);
    expect(drawnAfterZenTurn[1]).toBeCloseTo(draggedOnScreen.y, 9);
    expect(drawnAfterZenTurn[2]).toBeCloseTo(draggedOnScreen.z, 9);

    // And the unconjugated matrix does not: it is the transpose, which is the
    // inverse rotation.
    const drawnWithoutFix = zenToThree(apply(local, point) as [number, number, number]);
    expect(drawnWithoutFix[2]).toBeCloseTo(-draggedOnScreen.z, 9);
  });
});
