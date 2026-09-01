import * as THREE from 'three';
import { NO_PICK, decodePickId, encodePickId } from './pickIds';
import { HIDDEN_ATTRIBUTE } from './WorldScene';

// GPU ID-picking for instanced VOBs (level-editor.md §3, result 1).
//
// Measured: the world mesh's BVH answers a ray in 0.2 ms p50, but a CPU raycast
// across the 724 InstancedMeshes costs 14.2 ms p50 / 21.3 p95 — over the
// one-frame pick budget on its own. So the props are drawn once into a 1x1
// buffer with a shader that outputs each instance's VOB id as a colour, and the
// answer is that one pixel, read back.
//
// Drawn at 1x1 via `setViewOffset`, which reframes the camera's projection onto
// the single pixel under the cursor: the cost is one draw pass over the
// instanced meshes, not a full-screen buffer read.
//
// **The readback is asynchronous, and that is the whole of the pick's cost.**
// Measured in the app's own viewport: 2.1 ms on an idle GPU, **7.2 ms p50 /
// 12.1 p95 with the GPU shared with another workload** — where it lost to the
// 3.8 ms CPU raycast it was chosen over. None of that was prop count;
// `readRenderTargetPixels` is a synchronous readback that stalls the pipeline
// until the GPU has drained, so its cost tracks GPU state. Reading through a
// fence (`readRenderTargetPixelsAsync`) keeps the main thread free and leaves
// the decision standing on what it was actually chosen for: O(1) in prop count,
// against a raycast that is linear in `InstancedMesh`es (§3 decision 1).
//
// Both passes honour the drawn alpha test: a cut-out is sampled at the same
// threshold the visible mesh uses, so the empty corner of a foliage quad is not
// the plant, and the gap between two branches is whatever stands behind it. A
// discarded fragment writes no depth either, so the pixel falls through exactly
// as it does on screen.
//
// The world mesh is drawn too, depth only (`setWorldMeshes`, §16.24 3). Without
// it nothing in this scene ever wrote depth but the props themselves, so a VOB
// behind a wall won the pixel and clicking a Khorinis tower selected whatever
// stood inside it. It is one more draw into the same one-pixel view offset.
//
// That draw has to include the alpha-tested surfaces, which is what the first
// version of it left out: ZenGin's *default* alpha function is NONE — "alpha on
// or off" — so `WorldScene` gives nearly the whole world an `alphaTest`, and in
// retail NewWorld that is **every** opaque surface, 463,530 of the world mesh's
// 476,445 triangles. Skipping them meant the occluder pass occluded nothing at
// all and every VOB stayed clickable through the floor above it. So they are
// drawn through a second occluder material that samples the same texture at the
// same threshold as the visible mesh — a wall occludes, the hole in a fence
// does not. Only blended surfaces stay out: they write no depth when drawn
// either, and what is behind glass or water is on screen and must be clickable.

const PICK_VERTEX = /* glsl */`
  attribute vec3 pickColor;
  attribute float ${HIDDEN_ATTRIBUTE};
  varying vec3 vPickColor;
  varying vec2 vUv;
  void main() {
    vPickColor = pickColor;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    // The pick pass is a second draw of the same instances, so it has to honour
    // the same hiding: a VOB switched off by class that stayed clickable would
    // select something nobody can see. A proxy whose mesh carries no such
    // attribute reads 0 here, which is "drawn".
    if (${HIDDEN_ATTRIBUTE} > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const PICK_FRAGMENT = /* glsl */`
  varying vec3 vPickColor;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(vPickColor, 1.0);
  }
`;

// The cut-out prop's fragment pair — the same id, written only where the drawn
// material would have kept the pixel.
const PICK_CUTOUT_FRAGMENT = /* glsl */`
  uniform sampler2D map;
  uniform float alphaThreshold;
  varying vec3 vPickColor;
  varying vec2 vUv;
  void main() {
    if (texture2D(map, vUv).a < alphaThreshold) discard;
    gl_FragColor = vec4(vPickColor, 1.0);
  }
`;

// The occluder's own pair. It cannot share the material above: that one reads
// `instanceMatrix` and two instanced attributes, and the world mesh carries
// none of the three.
const OCCLUDER_VERTEX = /* glsl */`
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const OCCLUDER_FRAGMENT = /* glsl */`
  void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
`;

// And the cut-out pair, for the alpha-tested surfaces — which is most of the
// world. One material per drawn material, because the sampler and the threshold
// are per material; the shader source is the same for all of them, so the GPU
// compiles one program however many there are.
const CUTOUT_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CUTOUT_FRAGMENT = /* glsl */`
  uniform sampler2D map;
  uniform float alphaThreshold;
  varying vec2 vUv;
  void main() {
    if (texture2D(map, vUv).a < alphaThreshold) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
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

  // Depth only. `colorWrite: false` leaves the cleared black standing wherever
  // the world wins the depth test, and black is already what the readback reads
  // as "nothing was hit" — so a click on a wall falls through to the BVH
  // raycast exactly as a click on empty sky does.
  private occluderMaterial = new THREE.ShaderMaterial({
    vertexShader: OCCLUDER_VERTEX,
    fragmentShader: OCCLUDER_FRAGMENT,
    side: THREE.FrontSide,
    colorWrite: false,
  });

  // What a cut-out occluder samples until its own texture is decoded: opaque,
  // which is how the drawn mesh looks in the same moment — untextured and
  // white. Sampling a null map is not an option; the uniform must be a texture.
  private readonly opaquePixel = ((): THREE.DataTexture => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;   // a DataTexture is not uploaded without it
    return texture;
  })();

  private proxies: THREE.InstancedMesh[] = [];
  private occluders: THREE.Mesh[] = [];
  /** The cut-out materials and the drawn materials they follow — the world's
   *  occluders and the props' proxies kept apart because each is cleared with
   *  what it belongs to. Textures are decoded on demand, so the sampler is
   *  re-read at every pick rather than bound once when the scene was built. */
  private cutouts: Array<{ material: THREE.ShaderMaterial; drawn: THREE.MeshBasicMaterial }> = [];
  private propCutouts: Array<{ material: THREE.ShaderMaterial; drawn: THREE.MeshBasicMaterial }> = [];

  /** The proxies the pick pass draws, in the order their meshes were given.
   *  The pick scene is otherwise unreachable, and what they were built out of
   *  is the only thing about a pick that is checkable without a GPU. */
  get pickProxies(): readonly THREE.InstancedMesh[] {
    return this.proxies;
  }

  /** The world meshes drawn as depth-only occluders, for the same reason. */
  get pickOccluders(): readonly THREE.Mesh[] {
    return this.occluders;
  }

  /**
   * Draw the world mesh into the pick scene as a depth-only occluder
   * (level-editor.md §16.24 3).
   *
   * Separate from `setInstancedMeshes` because neither owns the other: the
   * proxies are rebuilt from cloned geometry with an id attribute, and these
   * are the caller's own meshes drawn through a different material.
   *
   * The geometry is **shared, not cloned** — it needs no attribute of its own,
   * and the `WorldScene` that built it is the one that disposes it. A
   * `mesh.visible` of false is honoured on the way in, because a world mesh
   * nobody can see must not take a click either; nothing switches one off
   * today, so this is the rule written down rather than a feature.
   */
  setWorldMeshes(meshes: readonly THREE.Mesh[], rootMatrix: THREE.Matrix4): void {
    this.clearOccluders();

    for (const mesh of meshes) {
      // A cut-out or a blended surface is not solid, and the pass cannot tell
      // where its holes are — see the note at the top. Drawn as an occluder it
      // would block a click through its own transparent half.
      const material = mesh.material as THREE.MeshBasicMaterial;
      if (!mesh.visible || material.transparent) continue;

      const occluder = new THREE.Mesh(
        mesh.geometry,
        material.alphaTest > 0 ? this.cutoutMaterial(material) : this.occluderMaterial,
      );
      occluder.matrixAutoUpdate = false;
      occluder.matrix.copy(rootMatrix);
      occluder.matrixWorldNeedsUpdate = true;
      occluder.frustumCulled = mesh.frustumCulled;

      this.scene.add(occluder);
      this.occluders.push(occluder);
    }
  }

  /** The occluder material for one alpha-tested drawn material. */
  private cutoutMaterial(drawn: THREE.MeshBasicMaterial): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader: CUTOUT_VERTEX,
      fragmentShader: CUTOUT_FRAGMENT,
      side: THREE.FrontSide,
      colorWrite: false,
      uniforms: {
        map: { value: drawn.map ?? this.opaquePixel },
        alphaThreshold: { value: drawn.alphaTest },
      },
    });
    this.cutouts.push({ material, drawn });
    return material;
  }

  /** The pick material for one alpha-tested prop material. */
  private propCutoutMaterial(drawn: THREE.MeshBasicMaterial): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader: PICK_VERTEX,
      fragmentShader: PICK_CUTOUT_FRAGMENT,
      side: THREE.FrontSide,
      uniforms: {
        map: { value: drawn.map ?? this.opaquePixel },
        alphaThreshold: { value: drawn.alphaTest },
      },
    });
    this.propCutouts.push({ material, drawn });
    return material;
  }

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
      // Shared, not the clone's copy: `setHiddenVobs` writes into the drawn
      // mesh's attribute, and a copy would answer with whatever was hidden when
      // the scene was built.
      const hidden = mesh.geometry.getAttribute(HIDDEN_ATTRIBUTE);
      if (hidden) geometry.setAttribute(HIDDEN_ATTRIBUTE, hidden);

      const drawn = mesh.material as THREE.MeshBasicMaterial;
      const proxy = new THREE.InstancedMesh(
        geometry,
        drawn.alphaTest > 0 ? this.propCutoutMaterial(drawn) : this.material,
        mesh.count,
      );
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
   * The draw pass is submitted synchronously and the readback is awaited, so
   * the caller's main thread is free while the GPU catches up — a click is
   * answered a frame or so later instead of stalling the one it arrived in.
   *
   * @param x,y  pixel coordinates in the canvas, y measured from the top
   */
  async pickAsync(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<number> {
    // Its own buffer per call: the draw loop keeps running during the readback,
    // so a second click can be in flight before the first has settled, and a
    // shared buffer would make each answer depend on the order the two fences
    // happened to settle in.
    const pixel = new Uint8Array(4);

    let readback: Promise<unknown> | undefined;
    this.draw(renderer, camera, x, y, width, height, () => {
      readback = renderer.readRenderTargetPixelsAsync(this.target, 0, 0, 1, 1, pixel);
    });

    // Everything above — including the readback's own `readPixels` into a pixel
    // pack buffer — is submitted before the first await, so the render target
    // and the view offset are already restored by the time we suspend here.
    await readback;

    return pixel[3] === 0 ? NO_PICK : decodePickId(pixel[0], pixel[1], pixel[2]);
  }

  /**
   * Draw the pick pass once and throw the pixel away.
   *
   * The first GPU pick of a session costs 53 ms — and once, 276 ms — compiling
   * the pick shader on first use, the same class of first-use cost as texture
   * upload (§3). Doing it when the world opens keeps it out of the first click.
   */
  warm(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    this.draw(renderer, camera, 0, 0, 1, 1, () => {});
  }

  /** The pick pass, framed onto one pixel, with the renderer left as it was. */
  private draw(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    x: number,
    y: number,
    width: number,
    height: number,
    read: () => void,
  ): void {
    const previousTarget = renderer.getRenderTarget();

    // The texture a cut-out samples may have been decoded since the last pick.
    for (const { material, drawn } of [...this.cutouts, ...this.propCutouts]) {
      material.uniforms.map.value = drawn.map ?? this.opaquePixel;
    }

    // Reframe the projection onto the one pixel under the cursor.
    camera.setViewOffset(width, height, x, y, 1, 1);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);   // black is "nothing was hit"
    renderer.clear();
    renderer.render(this.scene, camera);
    read();

    renderer.setRenderTarget(previousTarget);
    camera.clearViewOffset();
  }

  private clear(): void {
    for (const proxy of this.proxies) {
      this.scene.remove(proxy);
      proxy.geometry.dispose();
    }
    // The cut-out materials are the picker's own, unlike the shared geometry.
    for (const { material } of this.propCutouts) material.dispose();
    this.proxies = [];
    this.propCutouts = [];
  }

  /** No `dispose` on the geometry, unlike `clear`: an occluder draws the
   *  `WorldScene`'s own buffers, and releasing them here would take the world
   *  out from under the very next frame. */
  private clearOccluders(): void {
    for (const occluder of this.occluders) this.scene.remove(occluder);
    // The cut-out materials are the picker's own, unlike the geometry.
    for (const { material } of this.cutouts) material.dispose();
    this.occluders = [];
    this.cutouts = [];
  }

  dispose(): void {
    this.clear();
    this.clearOccluders();
    this.material.dispose();
    this.occluderMaterial.dispose();
    this.opaquePixel.dispose();
    this.target.dispose();
  }
}
