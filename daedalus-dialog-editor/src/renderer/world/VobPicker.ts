import * as THREE from 'three';
import { NO_PICK, decodePickId, encodePickId } from './pickIds';

// GPU ID-picking for instanced VOBs (level-editor.md §3, result 1).
//
// Measured: the world mesh's BVH answers a ray in 0.2 ms p50, but a CPU raycast
// across the 724 InstancedMeshes costs 14.2 ms p50 / 21.3 p95 — over the
// one-frame pick budget on its own. So the props are drawn once into a 1x1
// buffer with a shader that outputs each instance's VOB id as a colour, and the
// answer is one `readRenderTargetPixels`.
//
// Drawn at 1x1 via `setViewOffset`, which reframes the camera's projection onto
// the single pixel under the cursor: the cost is one draw pass over the
// instanced meshes, not a full-screen buffer read.
//
// Known limit for Phase 1a: the pick pass ignores alpha-tested cut-outs, so
// clicking the transparent corner of a foliage quad selects the plant. Fixing
// it means sampling the texture in the pick shader, which needs the texture
// decoded — and textures are decoded on demand.

const PICK_VERTEX = /* glsl */`
  attribute vec3 pickColor;
  varying vec3 vPickColor;
  void main() {
    vPickColor = pickColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const PICK_FRAGMENT = /* glsl */`
  varying vec3 vPickColor;
  void main() {
    gl_FragColor = vec4(vPickColor, 1.0);
  }
`;

export class VobPicker {
  private target = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    // Nearest and no colour management: these bytes are an integer, not a
    // colour, and any filtering or transfer function corrupts the id.
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    colorSpace: THREE.NoColorSpace,
  });

  private scene = new THREE.Scene();
  private material = new THREE.ShaderMaterial({
    vertexShader: PICK_VERTEX,
    fragmentShader: PICK_FRAGMENT,
    side: THREE.FrontSide,
  });

  private pixel = new Uint8Array(4);
  private proxies: THREE.InstancedMesh[] = [];

  /** Build the pick scene: the same instanced geometry, with an id per instance. */
  setInstancedMeshes(
    meshes: readonly THREE.InstancedMesh[],
    vobIdOf: (mesh: THREE.InstancedMesh, instance: number) => number | null,
    rootMatrix: THREE.Matrix4,
  ): void {
    this.clear();

    for (const mesh of meshes) {
      const colors = new Float32Array(mesh.count * 3);
      for (let i = 0; i < mesh.count; i++) {
        const vobId = vobIdOf(mesh, i);
        // A vob id is an index into the VobIndex, so it is always encodable;
        // an instance with none is left black and reads back as "nothing".
        if (vobId === null) continue;
        colors.set(encodePickId(vobId), i * 3);
      }

      // The geometry is shared with the visible mesh — only the id attribute is
      // new, so the pick pass costs no extra vertex memory.
      const geometry = mesh.geometry.clone();
      geometry.setAttribute('pickColor', new THREE.InstancedBufferAttribute(colors, 3));

      const proxy = new THREE.InstancedMesh(geometry, this.material, mesh.count);
      proxy.instanceMatrix = mesh.instanceMatrix;
      proxy.matrixAutoUpdate = false;
      // The proxies live in their own scene, so they carry the root conversion
      // themselves rather than hanging under the viewport's root node.
      proxy.matrix.copy(rootMatrix);
      proxy.matrixWorldNeedsUpdate = true;
      proxy.frustumCulled = mesh.frustumCulled;
      proxy.boundingSphere = mesh.boundingSphere;

      this.scene.add(proxy);
      this.proxies.push(proxy);
    }
  }

  /**
   * The VOB under a pixel, or `NO_PICK`.
   *
   * @param x,y  pixel coordinates in the canvas, y measured from the top
   */
  pick(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    x: number,
    y: number,
    width: number,
    height: number,
  ): number {
    const previousTarget = renderer.getRenderTarget();

    // Reframe the projection onto the one pixel under the cursor.
    camera.setViewOffset(width, height, x, y, 1, 1);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);   // black is "nothing was hit"
    renderer.clear();
    renderer.render(this.scene, camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.pixel);

    renderer.setRenderTarget(previousTarget);
    camera.clearViewOffset();

    return this.pixel[3] === 0 ? NO_PICK : decodePickId(this.pixel[0], this.pixel[1], this.pixel[2]);
  }

  private clear(): void {
    for (const proxy of this.proxies) {
      this.scene.remove(proxy);
      proxy.geometry.dispose();
    }
    this.proxies = [];
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.target.dispose();
  }
}
