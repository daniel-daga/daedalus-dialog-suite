/**
 * The translate gizmo's plane handles, on the camera's side of the VOB.
 *
 * `TransformControls` bakes each plane square into its geometry at +0.15 on
 * both of the axes it names and never moves it again, so from the far octant
 * the XY square is behind the VOB, over the axis lines, and is a fight to hit.
 * The arrows do not have the problem — each is drawn twice, at +0.5 and -0.5 —
 * which makes the planes the only handles a camera can be on the wrong side of.
 *
 * The gizmo itself is out of reach here: `three/examples/jsm` is ESM and this
 * suite is not, which is why every gizmo spec in this repo mocks it. What the
 * mock below reproduces is only what the mirroring depends on, from three
 * 0.180's `TransformControls.js`: the handle names, the offset baked into
 * `setupGizmo`'s geometry, the per-frame reset of `position`/`rotation`/`scale`
 * at the top of `TransformControlsGizmo.updateMatrixWorld`, and the
 * `FrontSide` material every handle is given.
 *
 * That last one is the trap the raycast test is for. Mirroring is a negative
 * scale, a negative scale flips triangle winding, and a `FrontSide` mesh whose
 * winding has flipped can stop being pickable — which would trade a handle you
 * cannot reach for one you cannot click.
 *
 * @jest-environment jsdom
 */

import { jest, describe, it, expect } from '@jest/globals';
import * as THREE from 'three';

/** The scale the fake gizmo gives its handles, standing in for the library's
 *  `factor * size / 4` — so a baked 0.15 offset lands 15 units out. */
const HANDLE_SCALE = 100;

jest.mock('three/examples/jsm/controls/TransformControls.js', () => {
  // A mock factory is hoisted above the imports, so it cannot close over one.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const three: typeof THREE = require('three');

  /** One handle, offset the way `setupGizmo` does it: into the geometry, not
   *  into the object's transform, which is why the square cannot simply be
   *  moved and has to be mirrored. */
  const handle = (name: string, offset: [number, number, number]) => {
    const geometry = new three.BoxGeometry(0.15, 0.15, 0.01);
    geometry.translate(...offset);
    const mesh = new three.Mesh(geometry, new three.MeshBasicMaterial({ side: three.FrontSide }));
    mesh.name = name;
    return mesh;
  };

  const planes = () => {
    const group = new three.Object3D();
    group.add(
      handle('XY', [0.15, 0.15, 0]),
      handle('YZ', [0, 0.15, 0.15]),
      handle('XZ', [0.15, 0, 0.15]),
      handle('X', [0.5, 0, 0]),
    );
    return group;
  };

  class FakeGizmo extends three.Object3D {
    isTransformControlsGizmo = true;

    mode = 'translate';

    space: 'local' | 'world' = 'world';

    eye = new three.Vector3(0, 0, 1);

    worldQuaternion = new three.Quaternion();

    gizmo = { translate: planes(), rotate: new three.Object3D(), scale: new three.Object3D() };

    picker = { translate: planes(), rotate: new three.Object3D(), scale: new three.Object3D() };

    constructor() {
      super();
      this.add(this.gizmo.translate, this.picker.translate);
    }

    updateMatrixWorld(force?: boolean) {
      for (const group of [this.gizmo.translate, this.picker.translate]) {
        for (const child of group.children) {
          child.position.set(0, 0, 0);
          child.rotation.set(0, 0, 0);
          child.scale.set(1, 1, 1).multiplyScalar(HANDLE_SCALE);
          child.quaternion.copy(this.space === 'local' ? this.worldQuaternion : new three.Quaternion());
        }
      }
      super.updateMatrixWorld(force);
    }
  }

  class FakeTransformControls {
    _gizmo = new FakeGizmo();

    _root = new three.Object3D();

    constructor() {
      this._root.add(this._gizmo);
    }

    getHelper() { return this._root; }

    getMode() { return this._gizmo.mode; }

    pointerDown() {}

    pointerMove() {}
  }

  return { TransformControls: FakeTransformControls };
});

import { DampedTransformControls } from '../src/renderer/world/DampedTransformControls';

type Gizmo = THREE.Object3D & {
  mode: string;
  space: 'local' | 'world';
  eye: THREE.Vector3;
  worldQuaternion: THREE.Quaternion;
};

const PLANES = ['XY', 'YZ', 'XZ'] as const;
const AXES = ['x', 'y', 'z'] as const;

/** A gizmo watched from `from`, its handles updated once. */
function gizmoSeenFrom(
  from: [number, number, number],
  { turn = 0, space = 'world' as 'local' | 'world', mode = 'translate' } = {},
) {
  const controls = new DampedTransformControls(
    undefined as never, undefined as never,
  );
  const root = controls.getHelper();
  const gizmo = root.children[0] as Gizmo;

  gizmo.mode = mode;
  gizmo.space = space;
  gizmo.worldQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);
  // What `TransformControls` keeps in `eye`: the object at the origin, looking
  // out at the camera.
  gizmo.eye.set(...from).normalize();

  root.updateMatrixWorld(true);
  return { gizmo, root };
}

/** Where a handle actually is — not `handle.position`, which is the gizmo's
 *  own origin: the quadrant offset is inside the geometry. */
function centreOf(handle: THREE.Object3D): THREE.Vector3 {
  const mesh = handle as THREE.Mesh;
  mesh.geometry.computeBoundingSphere();
  return mesh.geometry.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld);
}

function handlesNamed(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse((node) => { if (node.name === name) found.push(node); });
  return found;
}

describe('the translate gizmo\'s plane handles', () => {
  it('sit in the octant the camera is in, not always the positive one', () => {
    for (const from of [[-1, -1, -1], [1, -1, 1], [2, 3, -0.5]] as const) {
      const { root } = gizmoSeenFrom([...from]);

      for (const plane of PLANES) {
        // The drawn square and the invisible box that is picked. They have to
        // agree, or the gizmo lies about where to click.
        const found = handlesNamed(root, plane);
        expect(found).toHaveLength(2);

        for (const handle of found) {
          const centre = centreOf(handle);
          for (const axis of AXES) {
            if (plane.includes(axis.toUpperCase())) {
              expect(Math.sign(centre[axis])).toBe(Math.sign(from[AXES.indexOf(axis)]));
              expect(Math.abs(centre[axis])).toBeCloseTo(0.15 * HANDLE_SCALE, 4);
            } else {
              // Mirrored within the plane, never lifted out of it.
              expect(centre[axis]).toBeCloseTo(0, 6);
            }
          }
        }
      }
    }
  });

  it('is still hit by a ray through it once mirrored', () => {
    const from: [number, number, number] = [-100, -100, -100];
    const { root } = gizmoSeenFrom(from);

    const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100000);
    camera.position.set(...from);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    for (const plane of PLANES) {
      for (const handle of handlesNamed(root, plane)) {
        const screen = centreOf(handle).project(camera);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);

        expect(ray.intersectObject(handle, false)).not.toHaveLength(0);
      }
    }
  });

  it('mirrors in the gizmo\'s own axes when the space is local', () => {
    // A quarter turn about Y puts the gizmo's local X along world -Z and its
    // local Z along world +X. Seen from (-,-,-) the local eye is (+,-,-), so
    // the XY square goes to local (+0.15, -0.15, 0) — which is world (0,-,-).
    const { root } = gizmoSeenFrom([-1, -1, -1], { turn: Math.PI / 2, space: 'local' });

    for (const handle of handlesNamed(root, 'XY')) {
      const centre = centreOf(handle);
      expect(centre.x).toBeCloseTo(0, 6);
      expect(centre.y).toBeCloseTo(-0.15 * HANDLE_SCALE, 4);
      expect(centre.z).toBeCloseTo(-0.15 * HANDLE_SCALE, 4);
    }
  });

  it('leaves the axis handles where the library puts them', () => {
    // Each arrow is already drawn at both ends of its axis, so it is reachable
    // from either side and mirroring it would only move the arrowheads around.
    const { root } = gizmoSeenFrom([-1, -1, -1]);

    for (const handle of handlesNamed(root, 'X')) {
      expect(centreOf(handle).x).toBeCloseTo(0.5 * HANDLE_SCALE, 4);
    }
  });

  it('leaves every handle alone while rotating', () => {
    // The rotate gizmo has no plane handles; its rings are placed by the
    // library from the eye already, and a mirror there would fight it.
    const { root } = gizmoSeenFrom([-1, -1, -1], { mode: 'rotate' });

    for (const handle of handlesNamed(root, 'XY')) {
      expect(centreOf(handle).x).toBeCloseTo(0.15 * HANDLE_SCALE, 4);
    }
  });
});
