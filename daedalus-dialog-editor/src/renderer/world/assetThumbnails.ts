import type { DecodedTexture, VisualScene } from '../../shared/worldTypes';
import { THUMBNAIL_SIZE, type TextureLoader } from './ThumbnailRenderer';

// The thumbnail queue behind the Assets panel's grid (level-editor.md §16.26
// row 1). A tile asks for its name when it comes on screen; the answer is the
// machine-local cache's PNG when there is one, and otherwise the visual is
// extracted over `world:visual`, drawn by `ThumbnailRenderer` and put back
// under the key the cache answered.
//
// One at a time, in request order, and cancellable: a directory can hold
// hundreds of files, and `world:visual` transfers a fresh payload per call
// with no cache in the worker. The PNG cache *is* the memo — at the layer
// where it survives a restart — so nothing here holds geometry, and the
// worker holds no cache either: each name is extracted once and never again
// while its PNG exists, which is the one access pattern the grid has.
//
// No React. `useThumbnail` in the grid subscribes to this.

export type ThumbnailState =
  | { status: 'pending' }
  | { status: 'ready'; dataUrl: string }
  | { status: 'failed' };

export interface ThumbnailDeps {
  getThumbnail: (name: string) => Promise<{ key: string; dataUrl: string | null }>;
  putThumbnail: (key: string, dataUrl: string) => Promise<void>;
  loadVisual: (name: string) => Promise<VisualScene | null>;
  loadTexture: TextureLoader;
  renderer: {
    renderVisual: (visual: VisualScene, loadTexture: TextureLoader) => Promise<string>;
    renderTexture: (decoded: DecodedTexture) => string;
    dispose: () => void;
  };
}

/** Every extension the binding extracts a mesh for (`WorldAssetPreview`'s
 *  list) — a thumbnail exists for these and for textures, and for nothing
 *  else. */
const MESH_EXTENSIONS = ['.MRM', '.MSH', '.MMB', '.MDM', '.MDL', '.3DS', '.ASC', '.MDS', '.MMS'];

export function thumbnailKindOf(name: string): 'mesh' | 'texture' | null {
  const upper = name.toUpperCase();
  if (upper.endsWith('.TEX') || upper.endsWith('.TGA')) return 'texture';
  if (MESH_EXTENSIONS.some((extension) => upper.endsWith(extension))) return 'mesh';
  return null;
}

export class AssetThumbnails {
  private readonly states = new Map<string, ThumbnailState>();
  private readonly queue: Array<{ name: string; force: boolean }> = [];
  private readonly listeners = new Set<() => void>();
  private draining = false;
  private disposed = false;

  constructor(private readonly deps: ThumbnailDeps) {}

  get(name: string): ThumbnailState | undefined {
    return this.states.get(name.toUpperCase());
  }

  /** Ask for a thumbnail; a name already known or queued is not asked twice. */
  request(name: string): void {
    if (this.states.has(name.toUpperCase())) return;
    this.enqueue(name, false);
  }

  /** Draw again, whatever the cache holds — for a loose directory whose
   *  files changed under a mount whose mtime did not. */
  redraw(name: string): void {
    this.enqueue(name, true);
  }

  /** Forget everything not yet started. The one in flight finishes. */
  cancelPending(): void {
    for (const { name } of this.queue.splice(0)) {
      const state = this.states.get(name.toUpperCase());
      if (state?.status === 'pending') this.states.delete(name.toUpperCase());
    }
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.listeners.clear();
    this.deps.renderer.dispose();
  }

  private enqueue(name: string, force: boolean): void {
    const key = name.toUpperCase();
    if (thumbnailKindOf(name) === null) {
      this.states.set(key, { status: 'failed' });
      this.notify();
      return;
    }
    this.states.set(key, { status: 'pending' });
    this.queue.push({ name, force });
    this.notify();
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const { name, force } = this.queue.shift()!;
        const state = await this.produce(name, force);
        if (this.disposed) return;
        this.states.set(name.toUpperCase(), state);
        this.notify();
      }
    } finally {
      this.draining = false;
    }
  }

  private async produce(name: string, force: boolean): Promise<ThumbnailState> {
    try {
      const { key, dataUrl } = await this.deps.getThumbnail(name);
      if (dataUrl !== null && !force) return { status: 'ready', dataUrl };
      const drawn = await this.draw(name);
      if (drawn === null) return { status: 'failed' };
      // Stored best-effort: a cache write that fails still leaves a drawn
      // tile, and the next session redraws it.
      await this.deps.putThumbnail(key, drawn).catch(() => undefined);
      return { status: 'ready', dataUrl: drawn };
    } catch {
      return { status: 'failed' };
    }
  }

  private async draw(name: string): Promise<string | null> {
    if (thumbnailKindOf(name) === 'texture') {
      const decoded = await this.deps.loadTexture(name, THUMBNAIL_SIZE);
      return decoded === null ? null : this.deps.renderer.renderTexture(decoded);
    }
    const visual = await this.deps.loadVisual(name);
    return visual === null ? null : this.deps.renderer.renderVisual(visual, this.deps.loadTexture);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
