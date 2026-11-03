/**
 * A VOB's own axes on the translate gizmo (#414, level-editor.md §7).
 *
 * A VOB turned on a table has to still move along the table's edges, and a
 * world-aligned gizmo cannot do that. Two pieces make it work, and both are
 * invisible in this repo's own source: the proxy carries the VOB's stored
 * rotation verbatim, and `TransformControls`' local-space travel has to be put
 * back on the axis it was drawn along.
 *
 * The second piece is not obvious and the test says why. `TransformControls`
 * lays its handles out from the *decomposed world* rotation — under the mirrored
 * root that is `F A F` for the proxy's own rotation `A` — while it turns the
 * pointer travel by `A` itself. `Matrix4.decompose` answers a negative
 * determinant by negating `scale.x`, which is why those two frames differ at
 * all; the same behaviour is pinned from the other side in
 * `gizmoRotation.test.ts`.
 *
 * The gizmo itself is out of reach (`three/examples/jsm` is ESM, this suite is
 * not), so the library's arithmetic is reproduced here from
 * `TransformControls.js`'s translate branch, exactly as the other gizmo specs
 * do.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { ROOT_MATRIX, zenToThree } from 'zen-world';
import type { ZenRotation } from 'zen-world';
import * as mockWorldViewport from './worldViewportMocks';

// Only to make `GizmoController` importable in a CJS suite: the library it
// wraps is ESM. Nothing here constructs one.
jest.mock(
  'three/examples/jsm/controls/TransformControls.js',
  () => mockWorldViewport.mockTransformControls(),
);

import { localDragFix, localGizmoFrame, turnReflection } from '../src/renderer/world/GizmoController';

/** A quarter turn about +Y: the table in the report, and the case where a
 *  world-aligned gizmo is most obviously wrong. */
const QUARTER_TURN_Y: ZenRotation = [0, 0, 1, 0, 1, 0, -1, 0, 0];

/** What `Matrix4.decompose` would hand `TransformControls` — the frame the
 *  handles are drawn in. */
function shownFrame(frame: THREE.Quaternion) {
  const root = new THREE.Object3D();
  root.matrixAutoUpdate = false;
  root.matrix.fromArray([...ROOT_MATRIX]);
  const proxy = new THREE.Object3D();
  proxy.quaternion.copy(frame);
  root.add(proxy);
  root.updateMatrixWorld(true);

  const shown = new THREE.Quaternion();
  proxy.matrixWorld.decompose(new THREE.Vector3(), shown, new THREE.Vector3());
  return shown;
}

/** The proxy's travel for a unit of pointer movement along the handle `axis`,
 *  as `TransformControls`' local branch computes it. */
function libraryTravel(
  shown: THREE.Quaternion, frame: THREE.Quaternion, axis: 0 | 1 | 2,
): THREE.Vector3 {
  const handle = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
  const travel = handle.clone().applyQuaternion(shown.clone().invert());
  travel.set(axis === 0 ? travel.x : 0, axis === 1 ? travel.y : 0, axis === 2 ? travel.z : 0);
  // The parent's decomposed scale, mirror included.
  return travel.applyQuaternion(frame).divide(new THREE.Vector3(-0.01, 0.01, 0.01));
}

/** A ZenGin travel as the direction it is drawn in. */
const drawn = (zen: THREE.Vector3) =>
  new THREE.Vector3(...zenToThree([zen.x, zen.y, zen.z])).normalize();

const axisOf = (rotation: ZenRotation, axis: 0 | 1 | 2) => new THREE.Vector3(
  rotation[axis], rotation[3 + axis], rotation[6 + axis],
);

describe('the translate gizmo on a turned VOB', () => {
  it('draws its handles along the VOB’s own axes', () => {
    const frame = localGizmoFrame(QUARTER_TURN_Y);
    const shown = shownFrame(frame);

    for (const axis of [0, 1, 2] as const) {
      const handled = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
        .applyQuaternion(shown);
      const own = drawn(axisOf(QUARTER_TURN_Y, axis));

      // Parallel, either way round: a gizmo axis is a line, not an arrow.
      expect(Math.abs(handled.dot(own))).toBeCloseTo(1, 9);
    }
  });

  it('moves the VOB the way the handle was dragged, not the way the mirror reflects it', () => {
    const frame = localGizmoFrame(QUARTER_TURN_Y);
    const shown = shownFrame(frame);
    const fix = localDragFix(frame);

    let reflected = 0;
    for (const axis of [0, 1, 2] as const) {
      const handle = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
        .applyQuaternion(shown);
      const travel = libraryTravel(shown, frame, axis);

      const followed = drawn(travel.clone().applyQuaternion(fix));
      expect(followed.dot(handle)).toBeCloseTo(1, 9);

      if (drawn(travel).dot(handle) < 0) reflected++;
    }

    // The defect the fix exists for: on this VOB two of the three handles moved
    // the wrong way, which is what "the pivot does not turn with the model"
    // looked like on screen.
    expect(reflected).toBe(2);
  });

  it('turns a local VOB about the same axis the ring is drawn on', () => {
    // A turn leaves as the proxy's own rotation, conjugated out of the VOB's
    // frame and back across the mirror (`turnReflection`). What has to hold is
    // the visible one: the VOB's turn on screen is the turn the ring asks for,
    // about the ring's own axis.
    const frame = localGizmoFrame(QUARTER_TURN_Y);
    const shown = shownFrame(frame);
    const mirror = turnReflection(frame);
    const changeOfBasis = new THREE.Matrix4().makeScale(-1, 1, 1);
    const theta = 0.6;
    let differing = 0;

    for (const axis of [0, 1, 2] as const) {
      const unit = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
      const dragged = new THREE.Quaternion().setFromAxisAngle(unit, theta);

      // What the library writes locally, and the turn the proxy reports.
      const turn = frame.clone().multiply(dragged).multiply(frame.clone().invert());
      const delta = mirror.clone()
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(turn))
        .multiply(mirror);
      const drawnDelta = changeOfBasis.clone().multiply(delta).multiply(changeOfBasis);
      const drawnTurn = new THREE.Quaternion().setFromRotationMatrix(drawnDelta);

      // The ring's axis, as the gizmo draws it, and the turn the user asked for.
      const ring = unit.clone().applyQuaternion(shown);
      const asked = new THREE.Quaternion().setFromAxisAngle(ring, theta);

      expect(drawnTurn.angleTo(asked)).toBeCloseTo(0, 9);

      // Without the conjugation the VOB turns about a different axis — the
      // defect this is here for. X is the mirror's own axis, so only the other
      // two differ.
      const unconjugated = changeOfBasis.clone().multiply(
        new THREE.Matrix4().makeRotationFromQuaternion(turn),
      ).multiply(changeOfBasis);
      if (new THREE.Quaternion().setFromRotationMatrix(unconjugated).angleTo(asked) > 0.05) {
        differing++;
      }
    }

    expect(differing).toBe(2);
  });

  it('leaves an unturned VOB exactly where it was', () => {
    // Most VOBs in a retail world are axis-aligned, and their drag must not so
    // much as round-trip through a conversion.
    const frame = localGizmoFrame([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const fix = localDragFix(frame);

    expect(frame.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 12);
    expect(fix.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 12);
  });
});
