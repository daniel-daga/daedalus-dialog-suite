// Chunks to draw groups (level-editor.md §3).
//
// `zenkit-node` emits one chunk per material because that is what the file
// says; a renderer cannot afford one draw call per material — NewWorld declares
// 1400 of them against a <1500 full-scene budget. The merge is therefore a
// projection-layer step, and it lives here rather than in the binding or in the
// viewport: it is pure data, it has to run in the worker so the buffers cross
// IPC once instead of 1400 times, and it is the kind of code that is only
// trustworthy with tests on it.
//
// Two materials may share a draw call only if they *render* identically.
// Measured on NewWorld, texture alone gives 330 groups and this key gives 352;
// the 22 it refuses to merge are real differences in blend mode, UV scroll,
// env-map strength and vertex colour, and 266 materials carry no texture at all
// and are separated only by their colour. The 22 extra draw calls are what
// correctness costs.

/** One material's geometry, exactly as `extractWorldMesh` / `extractVisual` emit it. */
export interface MeshChunk {
  name: string;
  texture: string;
  group: number;
  color: readonly [number, number, number, number];
  alphaFunc: number;
  texAniMapMode: number;
  texAniFps: number;
  texAniMapDir: readonly [number, number];
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
  /** The raw zCOLOR word per vertex; null on a proto mesh, which has no baked light. */
  lights: ArrayBuffer | null;
  /**
   * A model attachment's hierarchy-node matrix, row-major 3x4 — absent on every
   * other kind of chunk. Twelve plain numbers, which is how the binding emits
   * it: it is one matrix per attachment, not a per-vertex buffer.
   *
   * `zenkit-node` emits it rather than baking it, because baking is a
   * coordinate decision and the binding makes none. It is applied here, at the
   * merge, and not as a per-draw-call matrix: two attachments of one model can
   * share a texture, and then they are one buffer with two transforms.
   */
  transform?: readonly number[] | null;
}

/** The render state that decides whether two materials may share a draw call. */
export const MERGE_KEY_FIELDS = [
  'texture', 'color',
  'alphaFunc', 'texAniMapMode', 'texAniFps', 'texAniMapDir',
  'envMapping', 'envMappingStrength',
  'waveMode', 'waveSpeed', 'waveMaxAmplitude', 'waveGridSize',
  'ignoreSun', 'disableLightmap',
] as const;

export type MergeKeyField = typeof MERGE_KEY_FIELDS[number];

/** One draw call: the render state, plus every merged material's geometry. */
export type DrawGroup = Pick<MeshChunk, MergeKeyField> & {
  /** How many materials this group collapsed — the number the budget is about. */
  materials: number;
  vertexCount: number;
  triangleCount: number;
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  uvs: ArrayBuffer;
  indices: ArrayBuffer;
  lights: ArrayBuffer | null;
};

function mergeKey(chunk: MeshChunk): string {
  // The texture name is upper-cased because a VOB names its asset in whatever
  // case the designer typed and the VFS resolves case-insensitively.
  return JSON.stringify(MERGE_KEY_FIELDS.map((field) => (
    field === 'texture' ? chunk.texture.toUpperCase() : chunk[field]
  )));
}

/**
 * Copy one part's positions and normals into the merged buffers, placed by its
 * node transform when it has one.
 *
 * A position takes the whole affine matrix; a **normal takes only the rotation**
 * — it is a direction, and translating it points every face at the node. The
 * matrices are the hierarchy's own rigid transforms, so no inverse-transpose is
 * needed: a rotation is its own normal matrix.
 */
function place(
  positions: Float32Array, normals: Float32Array, part: MeshChunk, vertex: number,
): void {
  const from = new Float32Array(part.positions);
  const fromNormals = new Float32Array(part.normals);

  if (!part.transform) {
    positions.set(from, vertex * 3);
    normals.set(fromNormals, vertex * 3);
    return;
  }

  const t = part.transform;
  for (let at = 0; at < from.length; at += 3) {
    const [x, y, z] = [from[at], from[at + 1], from[at + 2]];
    const [nx, ny, nz] = [fromNormals[at], fromNormals[at + 1], fromNormals[at + 2]];
    for (let row = 0; row < 3; row++) {
      const r = row * 4;
      positions[vertex * 3 + at + row] = t[r] * x + t[r + 1] * y + t[r + 2] * z + t[r + 3];
      normals[vertex * 3 + at + row] = t[r] * nx + t[r + 1] * ny + t[r + 2] * nz;
    }
  }
}

/**
 * Group chunks that render identically and concatenate their buffers.
 * Groups come back in first-seen order so draw order is reproducible between
 * loads — a transparency artefact nobody can reproduce is one nobody can fix.
 */
export function mergeChunks(chunks: readonly MeshChunk[]): DrawGroup[] {
  const parts = new Map<string, MeshChunk[]>();

  for (const chunk of chunks) {
    const key = mergeKey(chunk);
    const existing = parts.get(key);
    if (existing) existing.push(chunk);
    else parts.set(key, [chunk]);
  }

  return [...parts.values()].map((group) => {
    const first = group[0];
    let vertexCount = 0;
    let triangleCount = 0;
    for (const part of group) {
      vertexCount += part.vertexCount;
      triangleCount += part.triangleCount;
    }

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(triangleCount * 3);
    // A proto mesh has no baked light word. Emitting zeros instead would render
    // every prop black under a vertex-colour material, which reads as a
    // lighting bug rather than as a missing buffer.
    const lights = first.lights === null ? null : new Uint32Array(vertexCount);

    let vertex = 0;
    let index = 0;
    for (const part of group) {
      place(positions, normals, part, vertex);
      uvs.set(new Float32Array(part.uvs), vertex * 2);
      if (lights !== null) lights.set(new Uint32Array(part.lights!), vertex);
      // Re-based, not copied: each part's indices address its own vertices.
      for (const corner of new Uint32Array(part.indices)) indices[index++] = corner + vertex;
      vertex += part.vertexCount;
    }

    return {
      texture: first.texture.toUpperCase(),
      color: first.color,
      alphaFunc: first.alphaFunc,
      texAniMapMode: first.texAniMapMode,
      texAniFps: first.texAniFps,
      texAniMapDir: first.texAniMapDir,
      envMapping: first.envMapping,
      envMappingStrength: first.envMappingStrength,
      waveMode: first.waveMode,
      waveSpeed: first.waveSpeed,
      waveMaxAmplitude: first.waveMaxAmplitude,
      waveGridSize: first.waveGridSize,
      ignoreSun: first.ignoreSun,
      disableLightmap: first.disableLightmap,
      materials: group.length,
      vertexCount,
      triangleCount,
      positions: positions.buffer,
      normals: normals.buffer,
      uvs: uvs.buffer,
      indices: indices.buffer,
      lights: lights === null ? null : lights.buffer,
    };
  });
}

/** Every buffer in a group, for a `postMessage` transfer list. */
export function groupTransferables(groups: readonly DrawGroup[]): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const g of groups) {
    out.push(g.positions, g.normals, g.uvs, g.indices);
    if (g.lights !== null) out.push(g.lights);
  }
  return out;
}
