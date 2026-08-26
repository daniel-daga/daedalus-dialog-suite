import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { acceleratedRaycast } from 'three-mesh-bvh';
import { multiplyRotation, threeToZen, zenBoxToThree, type ZenRotation } from 'zen-world';
import type {
  DecodedTexture, InstancedPayload, WaynetPayload, WorldMeshPayload, WorldOp,
} from '../../../shared/worldTypes';
import { WaynetOverlay } from '../../world/WaynetOverlay';
import { WorldScene } from '../../world/WorldScene';
import { BvhBuilder } from '../../world/BvhBuilder';
import { VobPicker } from '../../world/VobPicker';
import { NO_PICK } from '../../world/pickIds';
import {
  runViewportBenchmark,
  type BenchmarkOptions,
  type BenchmarkResult,
  type ViewportProbe,
} from '../../world/viewportBenchmark';

// The Phase 1a viewport (level-editor.md §3, §7). Everything measured in the
// spike is carried over here, none of it re-derived:
//
//   - one mirrored root node is the whole coordinate conversion (WorldScene)
//   - VOBs sharing a visual are one InstancedMesh
//   - the world mesh gets a BVH, built off the main thread, and nothing else
//     does — a CPU raycast across the props costs 14.2 ms whether or not they
//     have trees
//   - instanced VOBs are GPU ID-picked (VobPicker)
//   - textures are decoded on demand, not eagerly: 549 ms of the cold open
//
// This component owns the imperative Three.js lifetime and deliberately keeps
// it out of React's render path — no payload buffer ever becomes state.

THREE.Mesh.prototype.raycast = acceleratedRaycast;

declare global {
  interface Window {
    /** Present only while a world viewport is mounted. The Phase 1a budget rows
     *  for framerate, draw calls and pick latency are measured through here —
     *  see `viewportBenchmark.ts`. */
    __worldViewport?: {
      benchmark: (options?: Partial<BenchmarkOptions>) => Promise<BenchmarkResult>;
      /**
       * Drag the gizmo to a position in ZenGin space and let go, by firing the
       * events `TransformControls` fires — for `scripts/verify-world-edit.js`,
       * which drives the real app against a real world.
       *
       * What it stands in for is precisely three's pointer-to-position maths;
       * everything below that — the live preview, the commit, the op, the IPC,
       * the native move and the panels — is the real thing.
       */
      dragGizmo: (to: [number, number, number]) => void;
      /** The same, for the rotate gizmo: turn about an axis in ZenGin space by
       *  `radians` and let go. */
      turnGizmo: (axis: [number, number, number], radians: number) => void;
      /** Where the gizmo currently sits, in ZenGin space, or null if detached. */
      gizmoPosition: () => [number, number, number] | null;
      /** The anchor VOB's 3x3 as drawn, row-major, or null if detached. */
      gizmoRotation: () => number[] | null;
    };
  }
}

/** Textures are decoded at this cap by picking a mipmap rather than resampling.
 *  Every NewWorld texture at full size is ~490 MB of RGBA; the spike's measured
 *  scene used 256 and 96 MB. */
const TEXTURE_MAX_SIZE = 256;

export interface WorldViewportProps {
  mesh: WorldMeshPayload;
  visuals: InstancedPayload;
  /** ZenGin-space world bounds, for framing the camera. */
  bbox: number[];
  /** The waynet, once someone has asked to see it. Null until then: it is a
   *  separate IPC call and an overlay nobody turned on costs nothing. */
  waynet: WaynetPayload | null;
  showWaynet: boolean;
  loadTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>;
  /**
   * A click's result: the VOB that was hit, or the point on the world mesh in
   * **ZenGin space** when the click landed on terrain instead. Both null means
   * the click missed everything.
   */
  onPick: (
    vob: number | null,
    point: [number, number, number] | null,
    /** Ctrl/Cmd was held: add to the selection rather than replacing it. */
    additive: boolean,
  ) => void;
  /** What the gizmo drives. Empty hides it; the gizmo sits on the last entry. */
  selection: readonly number[];
  /**
   * A finished drag as a **delta in ZenGin space** — the shell turns it into one
   * op per selected VOB. A delta rather than a destination because one gizmo
   * moves a whole selection and the VOBs keep the spacing they had. The viewport
   * has already drawn the move; this asks for it to be made real.
   */
  onTranslateSelection: (delta: [number, number, number]) => void;
  /** What the gizmo does. A VOB has no scale — `zCVob` has no such field and
   *  nothing in the retail corpus is scaled — so there are two modes, not three. */
  gizmoMode: GizmoMode;
  /**
   * A finished turn as a **delta 3x3 in ZenGin space, row-major** — the shell
   * composes it onto each selected VOB's own matrix, so every one of them turns
   * the same way on screen and each about its own origin.
   */
  onRotateSelection: (delta: ZenRotation) => void;
  /** Ops the main process has applied — a committed edit, an undo, a redo, or
   *  the reversal of a refused one. The scene follows them. */
  appliedOps: WorldOp[] | null;
}

export type GizmoMode = 'translate' | 'rotate';

/** What the selection and edit effects need of the imperative viewport, so
 *  neither of them can tear the scene down and rebuild 31 MB of buffers. */
interface Gizmo {
  attach: (selection: readonly number[]) => void;
  setMode: (mode: GizmoMode) => void;
}

/** A rotation as ZenGin reads it — row-major — out of three's column-major
 *  `Matrix4`. `elements[col * 4 + row]` is element [row][col]. */
function rowMajor(matrix: THREE.Matrix4): ZenRotation {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out.push(matrix.elements[col * 4 + row]);
  }
  return out as ZenRotation;
}

const WorldViewport: React.FC<WorldViewportProps> = ({
  mesh, visuals, bbox, waynet, showWaynet, loadTexture, onPick,
  selection, onTranslateSelection, gizmoMode, onRotateSelection, appliedOps,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The overlay is built and torn down independently of the scene, so asking
  // for the waynet does not rebuild 31 MB of geometry.
  const sceneRef = useRef<WorldScene | null>(null);
  const overlayRef = useRef<WaynetOverlay | null>(null);
  const gizmoRef = useRef<Gizmo | null>(null);
  const onTranslateRef = useRef(onTranslateSelection);
  onTranslateRef.current = onTranslateSelection;
  const onRotateRef = useRef(onRotateSelection);
  onRotateRef.current = onRotateSelection;
  // Read through refs so a parent re-render cannot tear the scene down and
  // rebuild 31 MB of buffers just because a callback identity changed.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const loadTextureRef = useRef(loadTexture);
  loadTextureRef.current = loadTexture;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10141c);

    const world = new WorldScene();
    sceneRef.current = world;
    world.setWorldMesh(mesh);
    world.setInstancedVisuals(visuals);
    scene.add(world.root);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(host.clientWidth || 1, host.clientHeight || 1);
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      70, (host.clientWidth || 1) / (host.clientHeight || 1), 0.5, 4000,
    );
    // Framed from the payload's own bbox — which `extractWorldMesh` computes
    // from the vertices it emitted, because every retail zCMesh stores that box
    // as all zeros and a copied one hands the viewport a world with no size.
    const box = zenBoxToThree(bbox);
    const span = Math.max(box.size[0], box.size[2]) || 10;
    camera.position.set(
      box.center[0] + span * 0.6, box.center[1] + span * 0.35, box.center[2] + span * 0.6,
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(box.center[0], box.center[1], box.center[2]);
    controls.enableDamping = true;
    controls.update();

    // Only what is pickable gets a tree, and off the main thread.
    const bvh = new BvhBuilder();
    const bvhReady = Promise.all(world.worldMeshes.map((worldMesh) => bvh.build(worldMesh.geometry)));

    const picker = new VobPicker();
    picker.setInstancedMeshes(
      world.instancedMeshes,
      (instanced, instance) => world.resolveInstance(instanced, instance),
      world.root.matrix,
    );
    // Measured: the first GPU pick of a session costs 53 ms — once, 276 ms —
    // compiling the pick shader. Paying it here makes the first click cost what
    // every later one does.
    picker.warm(renderer, camera);

    // Textures on demand. Requested one at a time so a world with 490 of them
    // does not open 490 concurrent IPC calls; each one applied lands on every
    // material that named it.
    const texturesReady = (async () => {
      for (const name of world.pendingTextureNames()) {
        if (disposed) return;
        const decoded = await loadTextureRef.current(name, TEXTURE_MAX_SIZE);
        if (disposed) return;
        if (decoded) world.applyTexture(decoded);
      }
    })();

    // ── the gizmo (level-editor.md §7, Phase 1b) ────────────────────────────
    //
    // A VOB is an *instance*, not an Object3D, so there is nothing for
    // TransformControls to attach to. The proxy is that something: it hangs
    // under the same mirrored root as everything else, which means its local
    // position is ZenGin centimetres and reading it back needs no conversion —
    // the root stays the only one in the app.
    //
    // The gizmo's own helper goes in the top-level scene instead, or it would
    // be drawn through that same 0.01 scale and mirror.
    const proxy = new THREE.Object3D();
    world.root.add(proxy);

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSpace('world');
    scene.add(transform.getHelper());
    transform.enabled = false;
    transform.getHelper().visible = false;

    // What the gizmo drives, and where each of them started the drag. A
    // selection can hold VOBs that are not drawn at all — a decal, a sound VOB,
    // anything unresolved — and those have no instance to preview. They are
    // still in the batch: the op is built from the index, which knows where
    // they are, and only the preview needs an instance.
    let gizmoVobs: readonly number[] = [];
    const dragFrom = new Map<number, [number, number, number]>();
    const turnFrom = new Map<number, ZenRotation>();
    const proxyFrom = new THREE.Vector3();
    const proxyTurnFrom = new THREE.Quaternion();
    // Scratch, so a drag frame allocates nothing.
    const turn = new THREE.Quaternion();
    const turnMatrix = new THREE.Matrix4();
    // A drag ends with a pointerup that the browser also delivers as a click on
    // the canvas, *after* the gizmo has already reported the drag finished — so
    // a flag that is true only during the drag would already be false by then.
    // This one is consumed by the click it belongs to.
    let endedDrag = false;

    const attach = (vobs: readonly number[]) => {
      // The gizmo sits on the last selected VOB that is actually drawn.
      const position = world.anchorOf(vobs);
      gizmoVobs = position === null ? [] : vobs;

      if (position === null) {
        transform.detach();
        transform.enabled = false;
        transform.getHelper().visible = false;
        return;
      }
      proxy.position.set(position[0], position[1], position[2]);
      // The proxy's own orientation is reset on every attach: the gizmo reports
      // a *delta* from where it was picked up, so what it starts from only has
      // to be the same at the press and at the release.
      proxy.quaternion.identity();
      transform.attach(proxy);
      transform.enabled = true;
      transform.getHelper().visible = true;
    };
    gizmoRef.current = {
      attach,
      setMode: (mode) => transform.setMode(mode),
    };

    // A drag must not also orbit the camera.
    transform.addEventListener('dragging-changed', (event) => {
      const dragging = event.value as boolean;
      controls.enabled = !dragging;

      if (dragging) {
        // Where everything was when the drag began. Read once: the preview
        // writes the instance matrices this would otherwise be read back out
        // of, so a per-frame read would compound the delta.
        proxyFrom.copy(proxy.position);
        proxyTurnFrom.copy(proxy.quaternion);
        dragFrom.clear();
        turnFrom.clear();
        for (const vob of gizmoVobs) {
          const position = world.positionOf(vob);
          if (position !== null) dragFrom.set(vob, position);
          const rotation = world.rotationOf(vob);
          if (rotation !== null) turnFrom.set(vob, rotation as ZenRotation);
        }
        return;
      }

      endedDrag = true;
      if (gizmoVobs.length === 0) return;

      if (transform.getMode() === 'rotate') {
        const delta = turnDelta();
        // Identity is a click that turned nothing, and committing it would put
        // one op per selected VOB on the undo stack for a batch that undoes
        // nothing.
        if (delta === null) return;
        onRotateRef.current(delta);
        return;
      }

      const delta: [number, number, number] = [
        proxy.position.x - proxyFrom.x, proxy.position.y - proxyFrom.y, proxy.position.z - proxyFrom.z,
      ];
      if (delta.every((component) => component === 0)) return;
      onTranslateRef.current(delta);
    });

    /** The turn since the drag began, row-major in ZenGin space — or null if
     *  the gizmo has not actually turned. The proxy hangs under the mirrored
     *  root, so its *local* orientation is already in ZenGin's basis and needs
     *  no conversion of its own; the root stays the only one. */
    const turnDelta = (): ZenRotation | null => {
      // q_now = delta * q_start, so delta = q_now * q_start⁻¹.
      turn.copy(proxyTurnFrom).invert().premultiply(proxy.quaternion);
      if (Math.abs(turn.w) >= 1) return null;
      return rowMajor(turnMatrix.makeRotationFromQuaternion(turn));
    };

    // The live preview. The world in the main process still has the VOBs where
    // they were; this is the drag being drawn, and it is made real on release.
    transform.addEventListener('objectChange', () => {
      if (transform.getMode() === 'rotate') {
        const delta = turnDelta();
        if (delta === null) return;
        for (const [vob, from] of turnFrom) world.rotateVob(vob, multiplyRotation(delta, from));
        return;
      }

      for (const [vob, from] of dragFrom) {
        world.moveVob(vob, [
          from[0] + proxy.position.x - proxyFrom.x,
          from[1] + proxy.position.y - proxyFrom.y,
          from[2] + proxy.position.z - proxyFrom.z,
        ]);
      }
    });

    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    const pointer = new THREE.Vector2();

    const handleClick = async (event: MouseEvent) => {
      // Picking here would select whatever is behind the gizmo — usually
      // nothing, so a finished drag would deselect the VOB it just moved.
      if (endedDrag) { endedDrag = false; return; }
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // The props first: GPU ID-picking is one draw pass into a 1x1 buffer,
      // where the equivalent CPU raycast is 14.2 ms. The readback is awaited
      // rather than stalled on, so the draw loop keeps running underneath it —
      // and the world can be closed while a pick is still in flight.
      // Read before the await: a modifier released while the readback is in
      // flight would otherwise turn a Ctrl+click into a plain one.
      const additive = event.ctrlKey || event.metaKey;

      const vob = await picker.pickAsync(renderer, camera, x, y, rect.width, rect.height);
      if (disposed) return;
      if (vob !== NO_PICK) {
        onPickRef.current(vob, null, additive);
        return;
      }

      // Then the world mesh, through its BVH — 0.2 ms p50 against 476k
      // triangles. Terrain is not a VOB, so a hit reports the point rather
      // than inventing a selection, and it comes back in ZenGin space: the
      // conversion is one-way at the root and `threeToZen` is the way back.
      pointer.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(world.worldMeshes, false)[0];
      onPickRef.current(null, hit ? threeToZen(hit.point.toArray()) : null, additive);
    };
    renderer.domElement.addEventListener('click', handleClick);

    const resize = new ResizeObserver(() => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(host);

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      controls.update();
      renderer.render(scene, camera);
    };
    draw();

    // ── the measurement handle (level-editor.md §3) ─────────────────────────
    // Framerate, draw calls per frame and pick latency are the budget rows that
    // still rest on the spike's numbers, and they can only be answered by the
    // scene above: the spike measured a scene the app does not own. So the live
    // renderer, camera, picker and BVH are handed to `runViewportBenchmark` as
    // a probe, exactly as `window.__spike` exposed the spike's.
    const gl = renderer.getContext();
    const pickPointer = new THREE.Vector2();
    const target = new THREE.Vector3();
    const allMeshes: THREE.Object3D[] = [...world.worldMeshes, ...world.instancedMeshes];

    const probe: ViewportProbe = {
      moveCamera: (pose) => {
        camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
        camera.lookAt(target.set(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]));
      },
      render: () => renderer.render(scene, camera),
      finishGpu: () => gl.finish(),
      drawCalls: () => renderer.info.render.calls,
      triangles: () => renderer.info.render.triangles,
      raycastWorldMesh: (x, y) => {
        raycaster.setFromCamera(pickPointer.set(x, y), camera);
        return raycaster.intersectObjects(world.worldMeshes, false).length > 0;
      },
      raycastWholeScene: (x, y) => {
        raycaster.setFromCamera(pickPointer.set(x, y), camera);
        return raycaster.intersectObjects(allMeshes, false).length > 0;
      },
      pickVobs: async (x, y) => {
        const width = renderer.domElement.width;
        const height = renderer.domElement.height;
        const vob = await picker.pickAsync(
          renderer, camera, ((x + 1) / 2) * width, ((1 - y) / 2) * height, width, height,
        );
        return vob !== NO_PICK;
      },
      viewportSize: () => ({ width: renderer.domElement.width, height: renderer.domElement.height }),
    };

    const benchmark = async (options?: Partial<BenchmarkOptions>): Promise<BenchmarkResult> => {
      // A half-loaded scene is a different scene: the BVH decides the terrain
      // pick and the textures decide what the GPU actually samples.
      await Promise.all([bvhReady, texturesReady]);

      // The draw loop and OrbitControls both write the camera every frame, and
      // the sweep's whole point is that the camera follows a fixed path.
      cancelAnimationFrame(frame);
      controls.enabled = false;
      try {
        return await runViewportBenchmark(probe, {
          now: () => performance.now(),
          requestFrame: (callback) => { requestAnimationFrame(() => callback()); },
          setTimer: (callback, ms) => { setTimeout(callback, ms); },
          visible: () => document.visibilityState === 'visible',
          focused: () => document.hasFocus(),
          yieldToBrowser: () => new Promise<void>((resolve) => { setTimeout(resolve, 0); }),
        }, {
          centre: box.center as [number, number, number],
          span,
          ...options,
        });
      } finally {
        controls.enabled = true;
        controls.update();
        draw();
      }
    };

    window.__worldViewport = {
      benchmark,
      dragGizmo: (to) => {
        if (gizmoVobs.length === 0) throw new Error('no VOB is selected');
        // The whole sequence a real drag fires, in order: the press is what
        // records where everything started, and a delta measured from a stale
        // origin is the defect this stands to catch.
        transform.dispatchEvent({ type: 'dragging-changed', value: true });
        proxy.position.set(to[0], to[1], to[2]);
        transform.dispatchEvent({ type: 'objectChange' });
        transform.dispatchEvent({ type: 'dragging-changed', value: false });
      },
      turnGizmo: (axis, radians) => {
        if (gizmoVobs.length === 0) throw new Error('no VOB is selected');
        transform.dispatchEvent({ type: 'dragging-changed', value: true });
        // The axis is in the proxy's own frame, which is ZenGin's — the same
        // basis an op's matrix is in, so the driver can predict the answer.
        proxy.quaternion.setFromAxisAngle(
          new THREE.Vector3(axis[0], axis[1], axis[2]).normalize(), radians,
        );
        transform.dispatchEvent({ type: 'objectChange' });
        transform.dispatchEvent({ type: 'dragging-changed', value: false });
      },
      gizmoRotation: () => (gizmoVobs.length === 0 ? null : world.rotationOf(gizmoVobs[gizmoVobs.length - 1])),
      gizmoPosition: () => (gizmoVobs.length === 0
        ? null
        : [proxy.position.x, proxy.position.y, proxy.position.z]),
    };

    return () => {
      disposed = true;
      sceneRef.current = null;
      gizmoRef.current = null;
      delete window.__worldViewport;
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener('click', handleClick);
      controls.dispose();
      transform.detach();
      scene.remove(transform.getHelper());
      transform.dispose();
      picker.dispose();
      bvh.dispose();
      world.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
    // Rebuilt only when a different world's payloads arrive — the callbacks are
    // read through refs precisely so they are not dependencies.
  }, [mesh, visuals, bbox]);

  // The overlay lives and dies on its own, under the scene's converted root so
  // it needs no conversion of its own. `mesh` is a dependency because a new
  // world means a new root to hang it under, not because the waynet changed.
  useEffect(() => {
    const world = sceneRef.current;
    if (world === null || waynet === null) return;

    const overlay = new WaynetOverlay(waynet);
    overlayRef.current = overlay;
    world.root.add(overlay.root);

    return () => {
      world.root.remove(overlay.root);
      overlay.dispose();
      overlayRef.current = null;
    };
  }, [waynet, mesh]);

  useEffect(() => {
    overlayRef.current?.setVisible(showWaynet);
  }, [showWaynet, waynet, mesh]);

  // The gizmo follows the selection. `mesh` is a dependency because a new
  // world's scene is a new gizmo, not because the selection changed.
  useEffect(() => {
    gizmoRef.current?.attach(selection);
  }, [selection, mesh, visuals]);

  useEffect(() => {
    gizmoRef.current?.setMode(gizmoMode);
  }, [gizmoMode, mesh, visuals]);

  // An edit the main process has taken — a commit, an undo, a redo, or the
  // reversal of a refused one. The scene is a projection and has to follow it;
  // the gizmo has to follow the VOB it is attached to, or it is left floating
  // where the VOB used to be.
  useEffect(() => {
    const world = sceneRef.current;
    if (world === null || appliedOps === null) return;

    for (const op of appliedOps) {
      if (op.op === 'RotateVob') world.rotateVob(op.vob, op.to);
      else world.moveVob(op.vob, op.to);
    }
    // The gizmo has to follow the VOBs it is attached to, or it is left
    // floating where they used to be — an undo of a multi-select drag moves
    // every one of them.
    if (appliedOps.some((op) => selection.includes(op.vob))) gizmoRef.current?.attach(selection);
    // `selection` is deliberately not a dependency: this effect is about ops
    // arriving, and re-running it on a selection change would re-apply them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedOps]);

  return <Box ref={hostRef} data-testid="world-viewport" sx={{ width: '100%', height: '100%', minHeight: 0 }} />;
};

export default WorldViewport;
