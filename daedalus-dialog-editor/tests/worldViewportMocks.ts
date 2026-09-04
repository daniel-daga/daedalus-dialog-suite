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

/**
 * `WorldViewport` installs `acceleratedRaycast` as `THREE.Mesh.prototype.raycast`
 * for the whole process, so a stand-in that does nothing silently turns *every*
 * raycast in every spec into a miss — which is how the scatter brush shipped
 * with a raycaster that could not meet the world mesh and no test to say so.
 *
 * The real `acceleratedRaycast` falls back to three's own `raycast` for a
 * geometry with no `boundsTree`, and the mocked BVH builder never builds one,
 * so delegating is what the real thing would do here anyway.
 */
export function mockThreeMeshBvh() {
  const three = jest.requireActual('three');
  const stock = three.Mesh.prototype.raycast;
  return {
    acceleratedRaycast: function raycast(this: unknown, ...args: unknown[]) {
      return stock.apply(this, args);
    },
  };
}

/** A canvas-backed stand-in for the WebGL renderer: jsdom has no GL context.
 *  Everything else in `three` is the real thing. */
export function mockThree() {
  const actual = jest.requireActual('three');
  return {
    ...actual,
    WebGLRenderer: class {
      // jsdom has no Pointer Lock API; the walk (`walkNav`) asks the canvas
      // for it, and the spec that drives a walk reads this back.
      domElement = Object.assign(document.createElement('canvas'), { requestPointerLock: jest.fn() });
      info = { render: { calls: 0, triangles: 0 } };
      autoClear = true;
      setPixelRatio() {}
      setSize() {}
      render() {}
      setRenderTarget() {}
      getRenderTarget() { return null; }
      setClearColor() {}
      clear() {}
      dispose() {}
      getContext() { return { COLOR: 0x1800, clearBufferfv: () => {}, finish: () => {}, readPixels: () => {} }; }
    },
  };
}

/**
 * `aims` points the camera at `target` whenever the target moves, which is the
 * one thing the real controls do that a spec casting a ray through the middle
 * of the canvas depends on: without it the camera keeps three's default
 * orientation and looks at nothing in particular, however the framing code
 * moves it. The real controls do it on their next `update()`; a spec that fires
 * its events synchronously never reaches a frame, so this does it as the target
 * is written — the same thing by the time anything observes it.
 *
 * Off by default: every spec that picks through the harness instead was written
 * against a camera that never turns, and turning one is not free.
 */
export function mockOrbitControls({ aims = false }: { aims?: boolean } = {}) {
  const three = jest.requireActual('three');
  return {
    OrbitControls: class {
      target: InstanceType<typeof three.Vector3>;
      enabled = true;
      enableDamping = false;
      rotateSpeed = 1;
      mouseButtons: Record<string, unknown> = {};

      constructor(camera: { lookAt: (target: unknown) => void }) {
        const target = new three.Vector3();
        if (aims) {
          const aim = <T,>(write: T): T => { camera.lookAt(target); return write; };
          const { copy, set } = target;
          target.copy = (v: unknown) => aim(copy.call(target, v));
          target.set = (x: number, y: number, z: number) => aim(set.call(target, x, y, z));
        }
        this.target = target;
      }

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
