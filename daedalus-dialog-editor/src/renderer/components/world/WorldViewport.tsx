import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast } from 'three-mesh-bvh';
import { threeToZen, zenBoxToThree } from 'zen-world';
import type {
  DecodedTexture, InstancedPayload, WaynetPayload, WorldMeshPayload,
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
  onPick: (vob: number | null, point: [number, number, number] | null) => void;
}

const WorldViewport: React.FC<WorldViewportProps> = ({
  mesh, visuals, bbox, waynet, showWaynet, loadTexture, onPick,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The overlay is built and torn down independently of the scene, so asking
  // for the waynet does not rebuild 31 MB of geometry.
  const sceneRef = useRef<WorldScene | null>(null);
  const overlayRef = useRef<WaynetOverlay | null>(null);
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

    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    const pointer = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // The props first: GPU ID-picking is one draw pass into a 1x1 buffer,
      // where the equivalent CPU raycast is 14.2 ms.
      const vob = picker.pick(renderer, camera, x, y, rect.width, rect.height);
      if (vob !== NO_PICK) {
        onPickRef.current(vob, null);
        return;
      }

      // Then the world mesh, through its BVH — 0.2 ms p50 against 476k
      // triangles. Terrain is not a VOB, so a hit reports the point rather
      // than inventing a selection, and it comes back in ZenGin space: the
      // conversion is one-way at the root and `threeToZen` is the way back.
      pointer.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(world.worldMeshes, false)[0];
      onPickRef.current(null, hit ? threeToZen(hit.point.toArray()) : null);
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
      pickVobs: (x, y) => {
        const width = renderer.domElement.width;
        const height = renderer.domElement.height;
        const vob = picker.pick(
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

    window.__worldViewport = { benchmark };

    return () => {
      disposed = true;
      sceneRef.current = null;
      delete window.__worldViewport;
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener('click', handleClick);
      controls.dispose();
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

  return <Box ref={hostRef} data-testid="world-viewport" sx={{ width: '100%', height: '100%', minHeight: 0 }} />;
};

export default WorldViewport;
