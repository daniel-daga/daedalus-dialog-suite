import * as THREE from 'three';
import type { VisualScene } from '../../shared/worldTypes';
import { buildVisualPreview, frameVisual, type VisualPreview } from './VisualPreviewScene';
import { THUMBNAIL_SIZE, THUMBNAIL_TEXTURE_SIZE, type TextureLoader } from './ThumbnailRenderer';

// The live render behind the tile under the cursor (level-editor.md §16.26
// row 1) — Spacer's *VOB Bilder* answered the way the inventory answers it:
// the model turns.
//
// A tile at rest is `ThumbnailRenderer`'s cached PNG, because a directory
// holds hundreds of them and each live one would cost an extraction, a GPU
// upload and a share of the frame. Only the hovered tile is a scene, and
// there is only ever one: a single `WebGLRenderer` whose canvas is moved
// into the tile the pointer is over and taken back when it leaves. That is
// the same geometry, lights and framing the still was drawn from
// (`VisualPreviewScene`), so the tile does not change appearance as it comes
// alive — it starts turning.
//
// The camera orbits; the model does not. `frameVisual` settles where the
// camera stands and the ROOT_MATRIX node under it is the viewport's, so
// turning the scene instead would re-decide the mirror and the scale that
// `coords` already settled.
//
// No React: `Thumbnail` drives this from its pointer handlers.

/** Radians per second the hovered tile turns — a full turn in eight seconds,
 *  the inventory's unhurried pace and not a spinner's. */
export const SPIN_RADIANS_PER_SECOND = 0.8;

/** Radians of turn per pixel dragged. A drag across one 96 px tile is most
 *  of a half-turn, so a face on the far side is reachable without leaving
 *  the tile. */
const DRAG_RADIANS_PER_PIXEL = 0.015;

/** How far from the poles the tilt stops, so the framing never degenerates
 *  into a look straight down its own up-axis. */
const PITCH_LIMIT = 0.2;

export interface LiveTileDeps {
  loadVisual: (name: string) => Promise<VisualScene | null>;
  loadTexture: TextureLoader;
}

export class LiveTilePreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private readonly target = new THREE.Vector3();
  /** Where `frameVisual` put the camera, in orbit terms — what yaw and pitch
   *  are measured from. */
  private readonly framed = new THREE.Spherical();
  private readonly orbit = new THREE.Spherical();
  private preview: VisualPreview | null = null;
  private host: HTMLElement | null = null;
  /** Bumped by every show and every hide: an extraction that lands after its
   *  hover ended belongs to nobody. */
  private token = 0;
  private frame = 0;
  /** NaN until the first frame — a rAF timestamp is 0 on the first one in a
   *  fresh document, so zero cannot be the sentinel. */
  private lastFrameAt = Number.NaN;
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  /** The one visual kept between hovers — a pointer crossing a tile twice is
   *  the access pattern, and `world:visual` re-extracts on every call. */
  private memo: { name: string; visual: VisualScene } | null = null;
  private disposed = false;

  constructor(private readonly deps: LiveTileDeps) {
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      display: 'block', touchAction: 'none',
    });
  }

  /** Bring `name` alive inside `host`, a `size`-pixel square. A name the
   *  binding extracts nothing for leaves the host as it found it. */
  async show(name: string, host: HTMLElement, size = THUMBNAIL_SIZE): Promise<void> {
    const token = ++this.token;
    this.detach();
    const visual = await this.visualOf(name);
    if (visual === null || this.disposed || token !== this.token) return;

    this.preview = buildVisualPreview(visual);
    this.target.copy(frameVisual(this.camera, visual.bounds));
    this.framed.setFromVector3(this.camera.position.clone().sub(this.target));
    this.yaw = 0;
    this.pitch = 0;
    this.dragging = false;
    this.lastFrameAt = Number.NaN;

    const renderer = this.webgl();
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(size, size, false);
    this.canvas.width = size;
    this.canvas.height = size;
    host.appendChild(this.canvas);
    this.host = host;
    this.frame = requestAnimationFrame(this.tick);

    void this.textures(this.preview, token);
  }

  /** Give `host` its still back. Called on the way out of a tile, so a host
   *  that is not the one showing is a hover that already moved on. */
  hide(host?: HTMLElement): void {
    if (host !== undefined && this.host !== null && this.host !== host) return;
    this.token += 1;
    this.detach();
  }

  /** The pointer has the turn now: the clock stops advancing it. */
  beginDrag(): void {
    this.dragging = true;
  }

  /** Turn by a pointer movement in pixels. */
  drag(dx: number, dy: number): void {
    this.yaw -= dx * DRAG_RADIANS_PER_PIXEL;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + dy * DRAG_RADIANS_PER_PIXEL,
      PITCH_LIMIT - this.framed.phi,
      Math.PI - PITCH_LIMIT - this.framed.phi,
    );
  }

  endDrag(): void {
    this.dragging = false;
  }

  dispose(): void {
    this.disposed = true;
    this.detach();
    this.memo = null;
    this.renderer?.dispose();
    this.renderer = null;
  }

  private tick = (now: number): void => {
    if (this.preview === null) return;
    // The first frame carries no elapsed time, and a tab that was in the
    // background carries far too much: a tile does not catch up on a turn
    // nobody watched.
    const elapsed = Number.isNaN(this.lastFrameAt) ? 0 : Math.min((now - this.lastFrameAt) / 1000, 0.1);
    this.lastFrameAt = now;
    if (!this.dragging) this.yaw += elapsed * SPIN_RADIANS_PER_SECOND;

    this.orbit.set(this.framed.radius, this.framed.phi + this.pitch, this.framed.theta + this.yaw);
    this.camera.position.copy(this.target).add(new THREE.Vector3().setFromSpherical(this.orbit));
    this.camera.lookAt(this.target);
    this.webgl().render(this.preview.scene, this.camera);
    this.frame = requestAnimationFrame(this.tick);
  };

  private async visualOf(name: string): Promise<VisualScene | null> {
    if (this.memo !== null && this.memo.name === name) return this.memo.visual;
    const visual = await this.deps.loadVisual(name).catch(() => null);
    if (visual !== null) this.memo = { name, visual };
    return visual;
  }

  /** The maps, at the tile's own resolution — the same fetch the still made,
   *  so a hover costs no texture the cache has not already served. */
  private async textures(preview: VisualPreview, token: number): Promise<void> {
    await Promise.all(preview.pendingTextureNames().map(async (name) => {
      try {
        const decoded = await this.deps.loadTexture(name, THUMBNAIL_TEXTURE_SIZE);
        if (decoded !== null && token === this.token) preview.applyTexture(decoded);
      } catch {
        // An undecodable map leaves that material white, as in the preview.
      }
    }));
  }

  private detach(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas.remove();
    this.host = null;
    this.preview?.dispose();
    this.preview = null;
    this.dragging = false;
  }

  private webgl(): THREE.WebGLRenderer {
    if (this.renderer === null) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.setClearColor(0x2b2b2b, 1);
    }
    return this.renderer;
  }
}
