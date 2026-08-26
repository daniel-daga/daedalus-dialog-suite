// Types for the subset of the binding TypeScript consumers use. This is not a
// full description of the addon: `normalizeWorld`, the fixture authors and the
// round-trip harness are JS-only diagnostics and are deliberately absent.
// The payload shapes are `zen-world`'s, which is where they are tested.

export type WorldHandle = { readonly __world: unique symbol };
export type VfsHandle = { readonly __vfs: unique symbol };

export interface MeshChunk {
  name: string;
  texture: string;
  group: number;
  color: [number, number, number, number];
  alphaFunc: number;
  texAniMapMode: number;
  texAniFps: number;
  texAniMapDir: [number, number];
  envMapping: boolean;
  envMappingStrength: number;
  waveMode: number;
  waveSpeed: number;
  waveMaxAmplitude: number;
  waveGridSize: number;
  ignoreSun: boolean;
  disableLightmap: boolean;
  vertexCount: number;
  triangleCount: number;
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  uvs: ArrayBuffer;
  indices: ArrayBuffer;
  /** Present on world-mesh chunks only; a proto mesh has no baked light word. */
  lights?: ArrayBuffer;
  /** Model attachments only: the hierarchy node and its accumulated transform. */
  node?: string;
  transform?: number[];
}

export interface WorldMesh {
  /** Computed from the vertices emitted — a retail zCMesh stores all zeros. */
  bbox: number[];
  vertexCount: number;
  triangleCount: number;
  chunks: MeshChunk[];
}

export interface VobIndex {
  count: number;
  parent: ArrayBuffer;
  childIndex: ArrayBuffer;
  positions: ArrayBuffer;
  rotations: ArrayBuffer;
  flags: ArrayBuffer;
  classes: string[];
  classIndex: ArrayBuffer;
  names: string[];
  nameIndex: ArrayBuffer;
  visuals: string[];
  visualIndex: ArrayBuffer;
  visualTypes: string[];
  visualTypeIndex: ArrayBuffer;
}

export interface WaynetGraph {
  count: number;
  /** Not interned: waypoint names are effectively unique. */
  names: string[];
  positions: ArrayBuffer;   // Float32 x3, ZenGin space
  directions: ArrayBuffer;  // Float32 x3
  waterDepths: ArrayBuffer; // Int32 x1
  /** Uint32 x1 — bit 0 freePoint, bit 1 underWater. */
  flags: ArrayBuffer;
  edgeCount: number;
  /** Uint32 x2 per edge — indices into the arrays above. */
  edges: ArrayBuffer;
  /** Edges dropped because an endpoint was not in the point list. */
  danglingEdges: number;
}

export interface VfsEntry {
  name: string;
  type: 'file' | 'directory';
}

export interface VisualPayload {
  source: string;
  chunks: MeshChunk[];
}

export interface TexturePayload {
  source: string;
  width: number;
  height: number;
  mipmaps: number;
  rgba: ArrayBuffer;
}

export function loadWorld(file: string, gameVersion: 'g1' | 'g2'): WorldHandle;
export function extractWorldMesh(handle: WorldHandle): WorldMesh;
export function vobIndex(handle: WorldHandle): VobIndex;
/** The waynet as a drawable graph: stored order, edges as index pairs. */
export function getWaynet(handle: WorldHandle): WaynetGraph;
export function openVfs(paths: string[], options?: { overwrite?: 'all' | 'newer' | 'older' | 'none' }): VfsHandle;
export function vfsResolve(vfs: VfsHandle, name: string): string | null;
/** The children of one directory, or null when the path is absent or is a file. */
export function vfsList(vfs: VfsHandle, path?: string): VfsEntry[] | null;
export function extractVisual(vfs: VfsHandle, name: string): VisualPayload | null;
export function decodeTexture(vfs: VfsHandle, name: string, level: number): TexturePayload | null;
/**
 * Move one VOB, addressed by its index path down the children lists ("0/2"),
 * to a position in ZenGin space. Translates the bbox by the same delta — the
 * engine culls by bbox, and a moved VOB with a stale one can vanish.
 *
 * `vobIndex` emits the last segment of that path as `childIndex`; rebuilding
 * the whole path is the consumer's job (`zen-world`'s `vobIndexPath`).
 */
export function setVobPosition(
  handle: WorldHandle, indexPath: string, position: [number, number, number],
): void;
/**
 * Rotate one VOB, addressed by the same index path, with a **row-major** 3x3 —
 * the order `vobIndex` emits and `normalizeWorld` dumps.
 *
 * `bbox` is `[minX, minY, minZ, maxX, maxY, maxZ]` and is written verbatim when
 * given. It is not derived here: measured across the three retail worlds, a
 * VOB's stored box is the tight world AABB of its own visual placed by its own
 * transform, so the box is a pure function of (visual, rotation, position) and
 * the caller that owns the asset layer recomputes it. Omit it for a VOB whose
 * visual does not resolve — the stale box at least bounded the visual in some
 * pose, where a guessed one bounds nothing.
 */
export function setVobRotation(
  handle: WorldHandle,
  indexPath: string,
  rotation: readonly number[],
  bbox?: readonly number[] | null,
): void;
export function zenkitVersion(): string;
