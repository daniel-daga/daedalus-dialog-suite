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
export function openVfs(paths: string[], options?: { overwrite?: 'all' | 'newer' | 'older' | 'none' }): VfsHandle;
export function vfsResolve(vfs: VfsHandle, name: string): string | null;
/** The children of one directory, or null when the path is absent or is a file. */
export function vfsList(vfs: VfsHandle, path?: string): VfsEntry[] | null;
export function extractVisual(vfs: VfsHandle, name: string): VisualPayload | null;
export function decodeTexture(vfs: VfsHandle, name: string, level: number): TexturePayload | null;
export function zenkitVersion(): string;
