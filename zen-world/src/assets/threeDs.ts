// A raw `.3DS` read straight into the chunks a compiled mesh gives (#297).
//
// ZenKit reads compiled meshes only, so a mod's `.3DS` previewed, thumbnailed
// and drew as nothing until a GMBT build had turned it into an `.MRM` (#294,
// #296). This reads the source itself, into the same `{ source, chunks }` the
// binding's `extractVisual` answers, so every consumer downstream — the merge,
// the preview, the thumbnail queue, the viewport — takes it unchanged. The
// worker falls back to it only when the binding resolves nothing.
//
// **The conversion is Y and Z swapped, and nothing else.** 3ds Max is
// right-handed and Z-up; ZenGin is left-handed and Y-up, so the swap is exactly
// the change of both, and because it is a mirror it also turns Max's
// counter-clockwise front faces into ZenGin's clockwise ones — the face order
// is kept. V is flipped: 3DS puts the texture origin bottom-left, Direct3D
// top-left. Units are the file's, which Gothic's are: centimetres. That is the
// modding community's account of ZenGin's own importer, not a comparison with a
// compiled `.MRM` of the same source — there is no such pair here — so it is on
// the engine-witness list (level-editor.md §16.41).
//
// What it reads: every object's vertices (0x4110), faces (0x4120) with their
// material groups (0x4130), mapping coordinates (0x4140), and each material's
// name (0xA000), diffuse colour (0xA020) and texture map (0xA200 → 0xA300).
// The mesh matrix (0x4160) is not applied — a 3DS stores its vertices already
// placed — and smoothing groups are not read: normals are averaged per vertex,
// which is what a preview needs. Anything malformed is null, never a throw.

import type { MeshChunk } from '../render';

const MAIN = 0x4d4d;
const EDIT = 0x3d3d;
const OBJECT = 0x4000;
const TRIMESH = 0x4100;
const VERTICES = 0x4110;
const FACES = 0x4120;
const FACE_MATERIAL = 0x4130;
const MAPPING = 0x4140;
const MATERIAL = 0xafff;
const MATERIAL_NAME = 0xa000;
const MATERIAL_DIFFUSE = 0xa020;
const MATERIAL_TEXTURE = 0xa200;
const MAP_FILE = 0xa300;
const COLOR_FLOAT = 0x0010;
const COLOR_BYTE = 0x0011;

/** What a face with no material is drawn as: a neutral grey, untextured. */
const NO_MATERIAL = { texture: '', color: [128, 128, 128, 255] as [number, number, number, number] };

class Malformed extends Error {}

interface Chunk { id: number; start: number; end: number }

/** The chunks laid end to end in `[start, end)`. */
function chunksIn(view: DataView, start: number, end: number): Chunk[] {
  const out: Chunk[] = [];
  for (let at = start; at < end;) {
    if (at + 6 > end) throw new Malformed();
    const id = view.getUint16(at, true);
    const length = view.getUint32(at + 2, true);
    if (length < 6 || at + length > end) throw new Malformed();
    out.push({ id, start: at + 6, end: at + length });
    at += length;
  }
  return out;
}

/** A null-terminated string, and where the bytes after it begin. */
function cstring(view: DataView, start: number, end: number): { text: string; next: number } {
  let text = '';
  for (let at = start; at < end; at++) {
    const byte = view.getUint8(at);
    if (byte === 0) return { text, next: at + 1 };
    text += String.fromCharCode(byte);
  }
  throw new Malformed();
}

function need(chunk: Chunk, at: number, bytes: number): void {
  if (at + bytes > chunk.end) throw new Malformed();
}

interface Material { texture: string; color: [number, number, number, number] }

function readMaterial(view: DataView, chunk: Chunk): [string, Material] {
  let name = '';
  let texture = '';
  let color: [number, number, number, number] = [255, 255, 255, 255];
  for (const part of chunksIn(view, chunk.start, chunk.end)) {
    if (part.id === MATERIAL_NAME) name = cstring(view, part.start, part.end).text;
    if (part.id === MATERIAL_DIFFUSE) {
      for (const value of chunksIn(view, part.start, part.end)) {
        if (value.id === COLOR_BYTE) {
          need(value, value.start, 3);
          color = [view.getUint8(value.start), view.getUint8(value.start + 1), view.getUint8(value.start + 2), 255];
        } else if (value.id === COLOR_FLOAT) {
          need(value, value.start, 12);
          const channel = (at: number) => Math.round(Math.min(1, Math.max(0, view.getFloat32(value.start + at, true))) * 255);
          color = [channel(0), channel(4), channel(8), 255];
        }
      }
    }
    if (part.id === MATERIAL_TEXTURE) {
      for (const map of chunksIn(view, part.start, part.end)) {
        if (map.id === MAP_FILE) texture = cstring(view, map.start, map.end).text;
      }
    }
  }
  return [name, { texture, color }];
}

interface Mesh {
  positions: number[];
  uvs: number[] | null;
  faces: number[];
  /** Material name → the faces it covers, in the file's group order. */
  groups: Array<{ material: string; faces: number[] }>;
}

function readMesh(view: DataView, chunk: Chunk): Mesh {
  const mesh: Mesh = { positions: [], uvs: null, faces: [], groups: [] };
  for (const part of chunksIn(view, chunk.start, chunk.end)) {
    if (part.id === VERTICES) {
      need(part, part.start, 2);
      const count = view.getUint16(part.start, true);
      need(part, part.start + 2, count * 12);
      for (let vertex = 0; vertex < count; vertex++) {
        const at = part.start + 2 + vertex * 12;
        const x = view.getFloat32(at, true);
        const y = view.getFloat32(at + 4, true);
        const z = view.getFloat32(at + 8, true);
        // Max's (x, y, z), Z up, is ZenGin's (x, z, y), Y up.
        mesh.positions.push(x, z, y);
      }
    } else if (part.id === MAPPING) {
      need(part, part.start, 2);
      const count = view.getUint16(part.start, true);
      need(part, part.start + 2, count * 8);
      mesh.uvs = [];
      for (let vertex = 0; vertex < count; vertex++) {
        const at = part.start + 2 + vertex * 8;
        mesh.uvs.push(view.getFloat32(at, true), 1 - view.getFloat32(at + 4, true));
      }
    } else if (part.id === FACES) {
      need(part, part.start, 2);
      const count = view.getUint16(part.start, true);
      const after = part.start + 2 + count * 8;
      need(part, part.start + 2, count * 8);
      for (let face = 0; face < count; face++) {
        const at = part.start + 2 + face * 8;
        mesh.faces.push(view.getUint16(at, true), view.getUint16(at + 2, true), view.getUint16(at + 4, true));
      }
      for (const sub of chunksIn(view, after, part.end)) {
        if (sub.id !== FACE_MATERIAL) continue;
        const { text, next } = cstring(view, sub.start, sub.end);
        need(sub, next, 2);
        const n = view.getUint16(next, true);
        need(sub, next + 2, n * 2);
        const faces: number[] = [];
        for (let at = 0; at < n; at++) faces.push(view.getUint16(next + 2 + at * 2, true));
        mesh.groups.push({ material: text, faces });
      }
    }
  }
  const vertexCount = mesh.positions.length / 3;
  if (mesh.faces.some((corner) => corner >= vertexCount)) throw new Malformed();
  if (mesh.groups.some((group) => group.faces.some((face) => face * 3 >= mesh.faces.length))) throw new Malformed();
  return mesh;
}

/** One chunk of `mesh`: the listed faces, their vertices compacted, normals
 *  averaged over the faces kept. */
function chunkOf(mesh: Mesh, faces: readonly number[], name: string, material: Material): MeshChunk {
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const face of faces) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = mesh.faces[face * 3 + corner];
      let local = remap.get(vertex);
      if (local === undefined) {
        local = remap.size;
        remap.set(vertex, local);
        positions.push(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
        uvs.push(mesh.uvs?.[vertex * 2] ?? 0, mesh.uvs?.[vertex * 2 + 1] ?? 0);
      }
      indices.push(local);
    }
  }
  const normals = new Array<number>(positions.length).fill(0);
  for (let at = 0; at < indices.length; at += 3) {
    const [a, b, c] = [indices[at] * 3, indices[at + 1] * 3, indices[at + 2] * 3];
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    // The reverse of the right-hand cross: ZenGin's faces run clockwise about
    // their outward normal, which is what the mirror above made of Max's
    // counter-clockwise ones. Area-weighted, since the cross is unnormalised.
    const n = [e1[2] * e2[1] - e1[1] * e2[2], e1[0] * e2[2] - e1[2] * e2[0], e1[1] * e2[0] - e1[0] * e2[1]];
    for (const vertex of [a, b, c]) for (let axis = 0; axis < 3; axis++) normals[vertex + axis] += n[axis];
  }
  for (let at = 0; at < normals.length; at += 3) {
    const length = Math.hypot(normals[at], normals[at + 1], normals[at + 2]);
    if (length > 0) for (let axis = 0; axis < 3; axis++) normals[at + axis] /= length;
    else normals[at + 1] = 1;
  }
  return {
    name,
    texture: material.texture,
    group: 0,
    color: material.color,
    alphaFunc: 0,
    texAniMapMode: 0,
    texAniFps: 0,
    texAniMapDir: [0, 0],
    envMapping: false,
    envMappingStrength: 0,
    waveMode: 0,
    waveSpeed: 0,
    waveMaxAmplitude: 0,
    waveGridSize: 0,
    ignoreSun: false,
    disableLightmap: false,
    vertexCount: remap.size,
    triangleCount: faces.length,
    positions: new Float32Array(positions).buffer,
    normals: new Float32Array(normals).buffer,
    uvs: new Float32Array(uvs).buffer,
    indices: new Uint32Array(indices).buffer,
    lights: null,
  };
}

/** The meshes of a `.3DS`, as `extractVisual` would answer for its compiled
 *  half, or null for bytes that are not one or hold no faces. */
export function parse3ds(bytes: ArrayBuffer, source: string): { source: string; chunks: MeshChunk[] } | null {
  try {
    const view = new DataView(bytes);
    const [main] = chunksIn(view, 0, bytes.byteLength);
    if (main === undefined || main.id !== MAIN) return null;

    const materials = new Map<string, Material>();
    const meshes: Mesh[] = [];
    for (const top of chunksIn(view, main.start, main.end)) {
      if (top.id !== EDIT) continue;
      for (const part of chunksIn(view, top.start, top.end)) {
        if (part.id === MATERIAL) {
          const [name, material] = readMaterial(view, part);
          materials.set(name, material);
        } else if (part.id === OBJECT) {
          const { next } = cstring(view, part.start, part.end);
          for (const sub of chunksIn(view, next, part.end)) {
            if (sub.id === TRIMESH) meshes.push(readMesh(view, sub));
          }
        }
      }
    }

    const chunks: MeshChunk[] = [];
    for (const mesh of meshes) {
      const grouped = new Set<number>();
      for (const { material, faces } of mesh.groups) {
        if (faces.length === 0) continue;
        for (const face of faces) grouped.add(face);
        chunks.push(chunkOf(mesh, faces, material, materials.get(material) ?? NO_MATERIAL));
      }
      const loose: number[] = [];
      for (let face = 0; face < mesh.faces.length / 3; face++) if (!grouped.has(face)) loose.push(face);
      if (loose.length > 0) chunks.push(chunkOf(mesh, loose, '', NO_MATERIAL));
    }
    return chunks.length === 0 ? null : { source, chunks };
  } catch (failure) {
    if (failure instanceof Malformed || failure instanceof RangeError) return null;
    throw failure;
  }
}

/**
 * The binding's extraction, and the raw `.3DS` behind it where that finds
 * nothing (#297) — the one place the worker decides between them. A compiled
 * half, where there is one, wins: it is what the game draws. `read` answers the
 * mounted file's bytes, or null for a name nothing is mounted under.
 */
export function extractVisualOrRaw3ds(
  extract: (name: string) => { source: string; chunks: MeshChunk[] } | null,
  read: (name: string) => ArrayBuffer | null,
  name: string,
): { source: string; chunks: MeshChunk[] } | null {
  const compiled = extract(name);
  if (compiled !== null) return compiled;
  const bare = name.slice(name.lastIndexOf('/') + 1).toUpperCase();
  if (!bare.endsWith('.3DS')) return null;
  const bytes = read(name);
  return bytes === null ? null : parse3ds(bytes, bare);
}
