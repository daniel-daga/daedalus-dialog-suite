import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { DecodedTexture, VisualScene } from '../../../../shared/worldTypes';
import { buildVisualPreview, frameVisual, type VisualPreview } from '../../../world/VisualPreviewScene';

/** The canvas's fallback edge, for a host that has no layout yet. */
const CANVAS_FALLBACK = 256;

/** What the render loop draws, and whether it owes a frame. */
interface Stage {
  preview: VisualPreview | null;
  /** The bounds the camera framed the first visual with. */
  bounds: VisualScene['bounds'] | null;
  dirty: boolean;
}

/**
 * One visual in an orbitable Three.js scene on `canvasRef`'s canvas — the
 * Assets panel's mesh preview, and the NPC editor's (npc-editor.md §4).
 *
 * `autoRotate` turns it slowly on its own, as Spacer's preview does (#375),
 * until the first hand orbit takes it over.
 *
 * The camera, the orbit and the renderer belong to the canvas, not to the
 * visual (#441): a head, a body or an armour swap rebuilds the meshes and
 * leaves the view exactly where the user put it.
 */
export function useVisualPreviewCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  visual: VisualScene | null,
  loadTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>,
  textureSize: number,
  autoRotate = false,
): void {
  const stage = useRef<Stage>({ preview: null, bounds: null, dirty: true });
  // Rebuilt only when the canvas itself comes and goes, which is what the
  // renderer's GL context is tied to.
  const hasVisual = visual !== null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !hasVisual) return;

    let current = true;
    let teardown: (() => void) | null = null;
    // Loaded on demand: `WorldSurface` imports this component statically, and
    // a static `three/examples/jsm` import would drag the ESM controls into
    // every suite that renders the surface — the viewport keeps them out the
    // same way, by never being loaded until a world is.
    void import('three/examples/jsm/controls/OrbitControls.js').then(({ OrbitControls }) => {
    if (!current) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x2b2b2b, 1);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const controls = new OrbitControls(camera, canvas);
    // Kept on, decided 2026-09-11 (#234) — the viewport turned its own damping
    // off (#228) and this did not follow. That one is a level, where a coasting
    // camera reads as lag and neither Spacer nor Blender coasts; this is one
    // small object in a thumbnail, where the coast is the feel of spinning it.
    // The draw loop below is gated on `controls.update()` having work to do,
    // and its comment names the damping as half of what that work is — so the
    // flag is not the only line an answer the other way would touch.
    controls.enableDamping = true;
    controls.autoRotate = autoRotate;
    controls.addEventListener('start', () => { controls.autoRotate = false; });
    controls.update();

    let framed = false;
    stage.current.dirty = true;

    const size = () => {
      const width = canvas.clientWidth || CANVAS_FALLBACK;
      const height = canvas.clientHeight || CANVAS_FALLBACK;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      stage.current.dirty = true;
    };
    size();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(size);
    observer?.observe(canvas);

    let frame = 0;
    const draw = () => {
      if (!current) return;
      const { preview, bounds } = stage.current;
      // Framed once, on the first visual this canvas shows. A later one is not
      // framed even when its bounds are wildly different: the user's view is
      // the user's view.
      if (!framed && preview !== null && bounds !== null) {
        controls.target.copy(frameVisual(camera, bounds));
        framed = true;
        stage.current.dirty = true;
      }
      // `update` is true only while the orbit is moving, damping out or
      // spinning on its own, so a still preview costs no draw.
      if (controls.update() || stage.current.dirty) {
        stage.current.dirty = false;
        if (preview !== null) renderer.render(preview.scene, camera);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    teardown = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      controls.dispose();
      renderer.dispose();
      // `dispose` keeps the GL context until the canvas is collected, and each
      // previewed file gets a fresh canvas: clicking through the browser piled
      // up contexts past Chromium's ~16, which kills the oldest — the World
      // viewport's — and blanked the app (#369).
      renderer.forceContextLoss();
    };
    });

    return () => {
      current = false;
      teardown?.();
    };
  }, [canvasRef, hasVisual, autoRotate]);

  // The meshes live exactly as long as the visual they show. Textures are
  // fetched after the first frame — an untextured crate at once beats a blank
  // panel until every map has decoded — and each arrival marks a frame dirty.
  useEffect(() => {
    if (visual === null) return;
    const live = stage.current;
    const preview = buildVisualPreview(visual);
    live.preview = preview;
    live.bounds = visual.bounds;
    live.dirty = true;

    for (const textureName of preview.pendingTextureNames()) {
      void loadTexture(textureName, textureSize)
        .then((texture) => {
          if (live.preview !== preview || texture === null) return;
          preview.applyTexture(texture);
          live.dirty = true;
        })
        .catch(() => { /* an undecodable map leaves that material white */ });
    }

    return () => {
      if (live.preview === preview) live.preview = null;
      preview.dispose();
    };
  }, [visual, loadTexture, textureSize]);
}
