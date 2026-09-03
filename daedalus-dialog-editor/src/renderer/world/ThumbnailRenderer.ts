import * as THREE from 'three';
import type { DecodedTexture, VisualScene } from '../../shared/worldTypes';
import { buildVisualPreview, frameVisual } from './VisualPreviewScene';

// The offscreen render behind the Assets panel's thumbnail grid
// (level-editor.md §16.26 row 1).
//
// One small canvas and one WebGLRenderer, reused for every thumbnail: a
// context per tile would exhaust the browser's context budget inside one
// directory. What is drawn is `VisualPreviewScene`'s scene — the same
// geometry, lights and materials the panel's preview shows — framed by the
// same `frameVisual`, so a thumbnail is the preview at 96 px and not a third
// renderer's opinion of the crate. Textures are fetched at the tile's own
// resolution before the single draw; one that fails to decode leaves its
// material white, exactly as the preview does.
//
// No React and no queueing here; `assetThumbnails.ts` owns the order and the
// cache.

export const THUMBNAIL_SIZE = 96;
/** The texture edge fetched for a thumbnail — the tile is 96 px. */
const THUMBNAIL_TEXTURE_SIZE = 64;

export type TextureLoader = (name: string, maxSize: number) => Promise<DecodedTexture | null>;

export class ThumbnailRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  constructor(size = THUMBNAIL_SIZE) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
  }

  /** The preview scene of one visual, drawn once and read back as a PNG. */
  async renderVisual(visual: VisualScene, loadTexture: TextureLoader): Promise<string> {
    const preview = buildVisualPreview(visual);
    try {
      await Promise.all(preview.pendingTextureNames().map(async (name) => {
        try {
          const decoded = await loadTexture(name, THUMBNAIL_TEXTURE_SIZE);
          if (decoded !== null) preview.applyTexture(decoded);
        } catch {
          // An undecodable map leaves that material white, as in the preview.
        }
      }));
      frameVisual(this.camera, visual.bounds);
      const renderer = this.webgl();
      renderer.setSize(this.canvas.width, this.canvas.height, false);
      renderer.render(preview.scene, this.camera);
      return this.canvas.toDataURL('image/png');
    } finally {
      preview.dispose();
    }
  }

  /** A decoded texture scaled into the tile — a 2D draw, no GL. Nearest
   *  sampling, since a Gothic texture is 256-px era and smoothing it shows
   *  something the game never draws. */
  renderTexture(decoded: DecodedTexture): string {
    const source = document.createElement('canvas');
    source.width = decoded.width;
    source.height = decoded.height;
    const sourceContext = source.getContext('2d');
    const context = this.canvas.getContext('2d');
    if (sourceContext === null || context === null) throw new Error('No 2D canvas context');
    sourceContext.putImageData(
      new ImageData(new Uint8ClampedArray(decoded.rgba), decoded.width, decoded.height), 0, 0,
    );
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.renderer?.dispose();
    this.renderer = null;
  }

  private webgl(): THREE.WebGLRenderer {
    if (this.renderer === null) {
      // `preserveDrawingBuffer`, or `toDataURL` reads a cleared buffer.
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0x2b2b2b, 1);
    }
    return this.renderer;
  }
}
