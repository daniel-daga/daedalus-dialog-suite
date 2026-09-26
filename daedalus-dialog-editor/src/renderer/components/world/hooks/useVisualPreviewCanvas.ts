import { useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import type { DecodedTexture, VisualScene } from '../../../../shared/worldTypes';
import { buildVisualPreview, frameVisual } from '../../../world/VisualPreviewScene';

/** The canvas's fallback edge, for a host that has no layout yet. */
const CANVAS_FALLBACK = 256;

/**
 * One visual in an orbitable Three.js scene on `canvasRef`'s canvas — the
 * Assets panel's mesh preview, and the NPC editor's (npc-editor.md §4).
 */
export function useVisualPreviewCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  visual: VisualScene | null,
  loadTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>,
  textureSize: number,
): void {
  // The mesh scene lives exactly as long as the visual it shows. Textures are
  // fetched after the first frame — an untextured crate at once beats a blank
  // panel until every map has decoded — and each arrival marks a frame dirty.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || visual === null) return;

    let current = true;
    let teardown: (() => void) | null = null;
    // Loaded on demand: `WorldSurface` imports this component statically, and
    // a static `three/examples/jsm` import would drag the ESM controls into
    // every suite that renders the surface — the viewport keeps them out the
    // same way, by never being loaded until a world is.
    void import('three/examples/jsm/controls/OrbitControls.js').then(({ OrbitControls }) => {
    if (!current) return;
    const preview = buildVisualPreview(visual);
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
    controls.target.copy(frameVisual(camera, visual.bounds));
    controls.update();

    let dirty = true;
    let frame = 0;

    const size = () => {
      const edge = canvas.clientWidth || CANVAS_FALLBACK;
      renderer.setSize(edge, edge, false);
      dirty = true;
    };
    size();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(size);
    observer?.observe(canvas);

    const draw = () => {
      if (!current) return;
      // `update` is true only while the orbit is moving or damping out, so an
      // idle preview costs no draw.
      if (controls.update() || dirty) {
        dirty = false;
        renderer.render(preview.scene, camera);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    for (const textureName of preview.pendingTextureNames()) {
      void loadTexture(textureName, textureSize)
        .then((texture) => {
          if (!current || texture === null) return;
          preview.applyTexture(texture);
          dirty = true;
        })
        .catch(() => { /* an undecodable map leaves that material white */ });
    }

    teardown = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      controls.dispose();
      preview.dispose();
      renderer.dispose();
    };
    });

    return () => {
      current = false;
      teardown?.();
    };
  }, [canvasRef, visual, loadTexture, textureSize]);
}
