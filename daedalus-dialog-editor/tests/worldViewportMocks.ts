/**
 * Shared jsdom stand-ins for what a real `WorldViewport` render needs and
 * jsdom cannot provide: the WebGL renderer, the two example controls, the BVH
 * worker and the GPU picker. Three specs duplicated this block —
 * `WorldViewport.multiSelect`, `.snapping` and `.waynetRebuild` — and a third
 * copy is the point `docs/refactoring-targets.md` §10 says to promote it.
 *
 * `jest.mock` is hoisted per file, so the `jest.mock(path, () => ...)` call
 * itself has to stay in each test file — but the factory body can just
 * delegate here:
 *
 *   jest.mock('three', () => require('./worldViewportMocks').mockThree());
 */

export function mockThreeMeshBvh() {
  return { acceleratedRaycast: () => {} };
}

/** A canvas-backed stand-in for the WebGL renderer: jsdom has no GL context.
 *  Everything else in `three` is the real thing. */
export function mockThree() {
  const actual = jest.requireActual('three');
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      info = { render: { calls: 0, triangles: 0 } };
      setPixelRatio() {}
      setSize() {}
      render() {}
      dispose() {}
      getContext() { return { finish: () => {}, readPixels: () => {} }; }
    },
  };
}

export function mockOrbitControls() {
  const three = jest.requireActual('three');
  return {
    OrbitControls: class {
      target = new three.Vector3();
      enabled = true;
      enableDamping = false;
      rotateSpeed = 1;
      mouseButtons: Record<string, unknown> = {};
      update() { return false; }
      dispose() {}
    },
  };
}

/** The gizmo's own pointer maths is what `dragGizmo`/`turnGizmo` stand in for
 *  in the tests that drive it — see `WorldViewport`'s `__worldViewport` doc —
 *  so the stand-in here is an event dispatcher and a mode, which is all the
 *  viewport asks of it. */
export function mockTransformControls() {
  const three = jest.requireActual('three');
  return {
    TransformControls: class extends three.EventDispatcher {
      enabled = false;
      private helper = new three.Object3D();
      private mode = 'translate';
      setSpace() {}
      getHelper() { return this.helper; }
      setMode(mode: string) { this.mode = mode; }
      getMode() { return this.mode; }
      attach() { return this; }
      detach() { return this; }
      dispose() {}
    },
  };
}

export function mockBvhBuilder() {
  return {
    BvhBuilder: class {
      build() { return Promise.resolve(); }
      dispose() {}
    },
  };
}

/** `pickAsync` resolves to `hitVobId` (default -1, "nothing under the
 *  cursor") — pass the VOB a test's click is meant to hit. */
export function mockVobPicker(hitVobId = -1) {
  return {
    VobPicker: class {
      setInstancedMeshes() {}
      // The world mesh as a depth-only occluder (§16.24 3). Present so that a
      // viewport built against a stand-in still runs the call.
      setWorldMeshes() {}
      warm() {}
      pickAsync() { return Promise.resolve(hitVobId); }
      dispose() {}
    },
  };
}
