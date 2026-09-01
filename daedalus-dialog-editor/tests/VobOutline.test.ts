/**
 * The screen-space VOB outline (level-editor.md §16.12).
 *
 * The rim term it replaces drew nothing a human could see — a flat face has no
 * facing gradient, and a billboard's silhouette is its texture's cutout, not
 * its polygon. This draws a line where the *picture* changes instead: the world
 * pass writes a mask beside its colour, and one full-screen draw marks every
 * pixel whose mask differs from a neighbour's. The composite is checkable
 * without a GPU the same way `WorldScene`'s shaders are: by reading the source
 * it would compile and the calls it would make.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import {
  VobOutline, OUTLINE_COLOR, OUTLINE_OPACITY, SELECT_COLOR, SELECT_OPACITY,
} from '../src/renderer/world/VobOutline';
import { WORLD_LAYER } from '../src/renderer/world/WorldScene';

type Call =
  | { op: 'target'; target: THREE.WebGLRenderTarget | null }
  | { op: 'clearColor'; color: number; alpha: number }
  | { op: 'clear' }
  | { op: 'clearMask'; buffer: number; drawBuffer: number; value: number[] }
  | { op: 'render'; root: THREE.Object3D; layers: number; target: THREE.WebGLRenderTarget | null };

/** A renderer that remembers what it was asked to do, in order. */
function fakeRenderer() {
  const calls: Call[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const gl = {
    COLOR: 0x1800,
    clearBufferfv: (buffer: number, drawBuffer: number, value: Float32Array) => {
      calls.push({ op: 'clearMask', buffer, drawBuffer, value: [...value] });
    },
  };
  const renderer = {
    autoClear: true,
    getContext: () => gl,
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
      calls.push({ op: 'target', target: next });
    },
    setClearColor: (color: THREE.ColorRepresentation, alpha: number) => {
      calls.push({ op: 'clearColor', color: new THREE.Color(color).getHex(), alpha });
    },
    clear: () => { calls.push({ op: 'clear' }); },
    render: (root: THREE.Object3D, camera: THREE.Camera) => {
      calls.push({ op: 'render', root, layers: camera.layers.mask, target });
    },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, calls };
}

const layerMask = (layer: number) => { const l = new THREE.Layers(); l.set(layer); return l.mask; };

describe('VobOutline', () => {
  test('a frame is the world into the masked target, the composite, then everything else on top', () => {
    const { renderer, calls } = fakeRenderer();
    const outline = new VobOutline(0x10141c);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    outline.render(renderer, scene, camera);

    const ops = calls.map((c) => c.op);
    expect(ops).toEqual(['target', 'clearColor', 'clear', 'clearMask', 'render', 'target', 'render', 'render']);

    // 1. The world, drawn alone — the camera sees only the world layer — into
    //    the two-attachment target: colour on 0, the VOB mask on 1.
    const [toTarget, clearColor, , clearMask, worldPass, toScreen, composite, overlays] = calls;
    expect(toTarget).toEqual({ op: 'target', target: outline.target });
    expect(outline.target.textures).toHaveLength(2);
    expect(outline.target.depthTexture).toBeInstanceOf(THREE.DepthTexture);
    // The background is the pass's clear colour now, not `scene.background`: a
    // Scene with a background forces a clear inside `render()`, after the mask
    // was emptied, and both attachments would start as the sky colour.
    expect(clearColor).toEqual({ op: 'clearColor', color: 0x10141c, alpha: 1 });
    // ...which is why the mask attachment is cleared to zero *separately*: the
    // renderer's clear paints every attachment with the sky.
    expect(clearMask).toEqual({ op: 'clearMask', buffer: 0x1800, drawBuffer: 1, value: [0, 0, 0, 0] });
    expect(worldPass).toEqual({ op: 'render', root: scene, layers: layerMask(WORLD_LAYER), target: outline.target });

    // 2. One full-screen draw to the canvas: colour, the line, and the world's
    //    depth written back so that what follows is depth-tested against it.
    expect(toScreen).toEqual({ op: 'target', target: null });
    expect(composite.op === 'render' && composite.root).toBe(outline.quad);
    expect(composite.op === 'render' && composite.target).toBeNull();

    // 3. The rest of the scene — gizmo, waynet, markers — on layer 0, over the
    //    composite and without clearing it.
    expect(overlays).toEqual({ op: 'render', root: scene, layers: layerMask(0), target: null });
    expect(renderer.autoClear).toBe(false);

    // And the camera is handed back seeing everything, so a pick between two
    // frames — the picker's proxies live on layer 0 — is unaffected.
    const all = new THREE.Layers();
    all.enableAll();
    expect(camera.layers.mask).toBe(all.mask);
  });

  test('the composite marks a pixel a neighbour outranks, in the colour of that neighbour', () => {
    const outline = new VobOutline(0x000000);
    const material = (outline.quad.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    const fragment = material.fragmentShader;

    // The three textures the world pass produced.
    expect(material.uniforms.tColor.value).toBe(outline.target.textures[0]);
    expect(material.uniforms.tMask.value).toBe(outline.target.textures[1]);
    expect(material.uniforms.tDepth.value).toBe(outline.target.depthTexture);
    // A mask is an id, not a colour: filtered, it would invent edges between
    // two VOBs' keys wherever the sampler blended them.
    expect(outline.target.textures[1].minFilter).toBe(THREE.NearestFilter);
    expect(outline.target.textures[1].magFilter).toBe(THREE.NearestFilter);
    // The colour attachment stores sRGB so an 8-bit target does not band the
    // darks — the world is drawn linear into it and the composite reads linear
    // back, exactly as the canvas path did before there was a target.
    expect(outline.target.textures[0].colorSpace).toBe(THREE.SRGBColorSpace);
    expect(outline.target.textures[1].colorSpace).toBe(THREE.NoColorSpace);

    // Four neighbours, one texel away in each direction, and the line is one
    // pixel wide on the *outside* of the edge: a pixel is the line when a
    // neighbour outranks it. Two pixels — one on each side — was tried first
    // and doubled the fringe on cut-out foliage, where every gap between two
    // branches is an edge.
    expect(fragment).toContain('uniform vec2 uTexel;');
    for (const offset of ['vec2( uTexel.x, 0.0 )', 'vec2( 0.0, uTexel.y )']) {
      expect(fragment).toContain(`vUv + ${offset}`);
      expect(fragment).toContain(`vUv - ${offset}`);
    }
    // The rank orders every channel: nothing, then a VOB by its key, then a
    // selected VOB above all — so the world gets an unselected VOB's border,
    // and a selected VOB's border lands on whatever it touches, in orange.
    expect(fragment).toMatch(/float rank\( vec4 mask \) \{\s+return mask\.r \+ 0\.5 \* mask\.g \+ 2\.0 \* mask\.b;/);
    expect(fragment).toMatch(/if \( top > mine \+ [0-9.]+ \) \{\s+float selected = step\( 2\.5, top \);/);
    // Faint — the line is mixed over the picture rather than replacing it —
    // and unmistakably weaker than the selection line, which is the selection
    // and covers the pixel outright. "Very bright" was the verdict on 1.0.
    expect(fragment).toContain(`mix( ${OUTLINE_OPACITY.toFixed(2)}, ${SELECT_OPACITY.toFixed(2)}, selected )`);
    expect(OUTLINE_OPACITY).toBeGreaterThan(0.3);
    expect(OUTLINE_OPACITY).toBeLessThan(0.7);
    expect(SELECT_OPACITY).toBe(1);
    expect(material.uniforms.uOutlineColor.value.getHex()).toBe(new THREE.Color(...OUTLINE_COLOR).getHex());
    expect(material.uniforms.uSelectColor.value.getHex()).toBe(new THREE.Color(...SELECT_COLOR).getHex());
    // Bright, and never the gizmo's own red, green or blue.
    expect(Math.min(...OUTLINE_COLOR)).toBeGreaterThan(0.8);
    expect(SELECT_COLOR).toEqual([1.0, 0.55, 0.12]);

    // Depth comes back with the colour, so the overlays drawn afterwards are
    // occluded by the world exactly as they were when they shared its pass.
    expect(fragment).toMatch(/gl_FragDepth = texture\( tDepth, vUv \)\.r;/);
    // A depth write only happens with the test *enabled*; disabling it would
    // silently drop every gl_FragDepth. So the test is on and always passes.
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.depthFunc).toBe(THREE.AlwaysDepth);
    // The picture was drawn linear into the target; the canvas wants the
    // renderer's output encoding, which a ShaderMaterial does not get for free.
    expect(fragment).toContain('linearToOutputTexel(');
    expect(material.glslVersion).toBe(THREE.GLSL3);
  });

  test('resizing follows the canvas, texel and target both', () => {
    const outline = new VobOutline(0x000000);
    const material = (outline.quad.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;

    outline.setSize(640, 400);

    expect(outline.target.width).toBe(640);
    expect(outline.target.height).toBe(400);
    expect(material.uniforms.uTexel.value.toArray()).toEqual([1 / 640, 1 / 400]);
  });
});
