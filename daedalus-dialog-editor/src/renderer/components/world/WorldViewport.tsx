import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast } from 'three-mesh-bvh';
import { threeToZen, zenBoxToThree } from 'zen-world';
import type { DecodedTexture, InstancedPayload, WorldMeshPayload } from '../../../shared/worldTypes';
import { WorldScene } from '../../world/WorldScene';
import { BvhBuilder } from '../../world/BvhBuilder';
import { VobPicker } from '../../world/VobPicker';
import { NO_PICK } from '../../world/pickIds';

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

/** Textures are decoded at this cap by picking a mipmap rather than resampling.
 *  Every NewWorld texture at full size is ~490 MB of RGBA; the spike's measured
 *  scene used 256 and 96 MB. */
const TEXTURE_MAX_SIZE = 256;

export interface WorldViewportProps {
  mesh: WorldMeshPayload;
  visuals: InstancedPayload;
  /** ZenGin-space world bounds, for framing the camera. */
  bbox: number[];
  loadTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>;
  /**
   * A click's result: the VOB that was hit, or the point on the world mesh in
   * **ZenGin space** when the click landed on terrain instead. Both null means
   * the click missed everything.
   */
  onPick: (vob: number | null, point: [number, number, number] | null) => void;
}

const WorldViewport: React.FC<WorldViewportProps> = ({ mesh, visuals, bbox, loadTexture, onPick }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
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
    for (const worldMesh of world.worldMeshes) void bvh.build(worldMesh.geometry);

    const picker = new VobPicker();
    picker.setInstancedMeshes(
      world.instancedMeshes,
      (instanced, instance) => world.resolveInstance(instanced, instance),
      world.root.matrix,
    );

    // Textures on demand. Requested one at a time so a world with 490 of them
    // does not open 490 concurrent IPC calls; each one applied lands on every
    // material that named it.
    void (async () => {
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

    return () => {
      disposed = true;
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

  return <Box ref={hostRef} data-testid="world-viewport" sx={{ width: '100%', height: '100%', minHeight: 0 }} />;
};

export default WorldViewport;
