// A loaded world to a renderable scene description (level-editor.md §3, §7).
//
// This runs in the zenkit worker, not in the renderer: the merge collapses 1400
// chunks into ~352 groups, so doing it here means the buffers cross IPC once
// each instead of four times as many. The binding is injected rather than
// required, which is what lets the decisions below be tested without the native
// addon — and the decisions are the point of the module. Every one of them was
// measured on retail data and every one of them fails silently:
//
//   - a zCVobLevelCompo names the source mesh a slice of the *already-compiled*
//     world came from. Drawing it draws the world twice.
//   - one Mesh per VOB is ~12k draw calls against a <1500 budget. VOBs sharing
//     a visual become instances of one.
//   - an unresolved visual is a normal fact about a world (a decal names a
//     texture, a .pfx is a Daedalus instance), so it is counted, not thrown.
//
// Nothing here converts coordinates or reverses an index buffer: positions and
// instance matrices stay in ZenGin space and winding stays stored, because that
// is `coords`' single decision to make.

import { mergeChunks, type DrawGroup, type MeshChunk } from '../render';
import type { ZenBounds } from '../model';

/** The `vobIndex` payload, columnar with the repeated strings interned. */
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

// Opaque native handles. Deliberately not branded: `zen-world` never looks
// inside one, and a brand here would refuse the binding's own branded handles
// for no gain — the whole point of injecting the binding is that this module
// does not know what a handle is.
export type WorldHandle = object;
export type VfsHandle = object;

/** The slice of `zenkit-node` a scene build needs. */
export interface SceneBinding {
  extractWorldMesh(handle: WorldHandle): {
    bbox: number[];
    vertexCount: number;
    triangleCount: number;
    chunks: MeshChunk[];
  };
  extractVisual(vfs: VfsHandle, name: string): { source: string; chunks: MeshChunk[] } | null;
}

export interface WorldMeshScene {
  groups: DrawGroup[];
  /** ZenGin space, computed by the binding from the vertices it emitted. */
  bbox: number[];
  stats: { materials: number; drawGroups: number; triangles: number };
}

export function buildWorldMesh(binding: SceneBinding, handle: WorldHandle): WorldMeshScene {
  const mesh = binding.extractWorldMesh(handle);
  const groups = mergeChunks(mesh.chunks);
  return {
    groups,
    bbox: mesh.bbox,
    stats: {
      materials: mesh.chunks.length,
      drawGroups: groups.length,
      triangles: mesh.triangleCount,
    },
  };
}

export interface InstancedVisual {
  name: string;
  source: string;
  /** Instances of this visual. */
  count: number;
  /** Row-major 3x4 per instance, ZenGin space: the rotation rows with the
   *  position as the fourth column. Converted once, at the scene root. */
  matrices: ArrayBuffer;
  /** The VOB index behind each instance — a pick returns
   *  (InstancedMesh, instanceId) and nothing else identifies the object. */
  vobIds: ArrayBuffer;
  groups: DrawGroup[];
  /**
   * The visual's own bounds in the visual's own space,
   * `[minX, minY, minZ, maxX, maxY, maxZ]`.
   *
   * Six numbers, computed here because the merged buffers are already in hand
   * and because a rotation needs them: a VOB's stored bbox is the tight world
   * AABB of its visual placed by its transform (measured — `zenkit-node`'s
   * `check-vob-bbox.js`), so refitting it on a rotation needs exactly this and
   * nothing else. Sending it beats re-deriving it from the geometry in the
   * renderer, which would have to walk 2.7 M vertices to answer it.
   */
  bounds: ZenBounds;
}

export interface InstancedScene {
  visuals: InstancedVisual[];
  stats: {
    visualsSeen: number;
    visualsResolved: number;
    vobsPlaced: number;
    instancedDrawGroups: number;
    levelCompos: number;
    /**
     * Counted per **VOB**, not per visual name — 1,405 decal VOBs on retail
     * NewWorld, not 23 decal visuals. The per-name figure is
     * `visualsSeen - visualsResolved` (49 there: 23 DECAL + 26 PARTICLE_EFFECT,
     * which is the table in level-editor.md §3).
     */
    unresolvedByType: Record<string, number>;
  };
}

/**
 * The bounds of a visual's merged draw groups, in the visual's own space.
 *
 * Over the merged buffers rather than the raw chunks, because that is where an
 * attachment's node transform has already been applied — bounds taken before
 * the merge would place a chest's lid at the chest's origin, which is the defect
 * `mergeChunks` exists to have fixed.
 */
function groupBounds(groups: readonly DrawGroup[]): ZenBounds {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const group of groups) {
    const positions = new Float32Array(group.positions);
    for (let at = 0; at < positions.length; at += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[at + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }

  // A group with no vertices leaves the sweep at its sentinels, and Infinity in
  // a bbox is a box the engine cannot cull by.
  if (!Number.isFinite(min[0])) return [0, 0, 0, 0, 0, 0];
  return [min[0], min[1], min[2], max[0], max[1], max[2]];
}

/**
 * The bounds of one visual by name — for a visual a VOB is being **given**.
 *
 * Every other op refits a box from bounds the renderer already has: they cross
 * with the geometry, six numbers beside buffers that were going anyway. A visual
 * the world does not currently use has no instance and no payload, so this is
 * the one bounds that has to be asked for.
 *
 * It goes through `mergeChunks` and `groupBounds` rather than summing the raw
 * chunks, because that is the path `buildInstancedVisuals` takes — so a swapped
 * visual's box is the box the scene would have given it, by construction rather
 * than by two implementations agreeing. Taking the bounds before the merge would
 * also place an attachment at its model's origin, which is the defect
 * `mergeChunks` exists to have fixed.
 *
 * Null for a name that does not resolve (a decal's texture, a `.pfx`) and for
 * one that resolves to no geometry — the op then leaves the stale box alone,
 * which is the same answer a rotation gives for the same reason.
 */
export function visualBounds(
  binding: SceneBinding, vfs: VfsHandle, name: string,
): ZenBounds | null {
  const visual = binding.extractVisual(vfs, name);
  if (visual === null) return null;
  const groups = mergeChunks(visual.chunks);
  return groups.length === 0 ? null : groupBounds(groups);
}

export function buildInstancedVisuals(
  binding: SceneBinding,
  vfs: VfsHandle,
  index: VobIndex,
): InstancedScene {
  const positions = new Float32Array(index.positions);
  const rotations = new Float32Array(index.rotations);
  const classIndex = new Uint32Array(index.classIndex);
  const visualIndex = new Uint32Array(index.visualIndex);
  const visualTypeIndex = new Uint32Array(index.visualTypeIndex);

  // Resolved once per unique name, not once per VOB.
  const resolved = new Map<string, { source: string; chunks: MeshChunk[] } | null>();
  const placements = new Map<string, { matrices: number[]; vobIds: number[] }>();
  const unresolvedByType: Record<string, number> = {};
  const levelCompos = new Set<string>();

  for (let vob = 0; vob < index.count; vob++) {
    const name = index.visuals[visualIndex[vob]];
    if (name === '') continue;

    if (index.classes[classIndex[vob]] === 'zCVobLevelCompo') {
      levelCompos.add(name);
      continue;
    }

    if (!resolved.has(name)) {
      resolved.set(name, binding.extractVisual(vfs, name));
    }
    const visual = resolved.get(name)!;
    if (visual === null) {
      const type = index.visualTypes[visualTypeIndex[vob]];
      unresolvedByType[type] = (unresolvedByType[type] ?? 0) + 1;
      continue;
    }

    let placement = placements.get(name);
    if (placement === undefined) {
      placement = { matrices: [], vobIds: [] };
      placements.set(name, placement);
    }

    const r = vob * 9;
    const p = vob * 3;
    placement.matrices.push(
      rotations[r], rotations[r + 1], rotations[r + 2], positions[p],
      rotations[r + 3], rotations[r + 4], rotations[r + 5], positions[p + 1],
      rotations[r + 6], rotations[r + 7], rotations[r + 8], positions[p + 2],
    );
    placement.vobIds.push(vob);
  }

  const visuals: InstancedVisual[] = [];
  let vobsPlaced = 0;
  let instancedDrawGroups = 0;

  for (const [name, placement] of placements) {
    const visual = resolved.get(name)!;
    const groups = mergeChunks(visual.chunks);
    // A name that resolves to no geometry places nothing: an InstancedMesh with
    // no groups is a draw call that draws nothing.
    if (groups.length === 0) continue;

    visuals.push({
      name,
      source: visual.source,
      count: placement.vobIds.length,
      matrices: new Float32Array(placement.matrices).buffer,
      vobIds: new Uint32Array(placement.vobIds).buffer,
      groups,
      bounds: groupBounds(groups),
    });
    vobsPlaced += placement.vobIds.length;
    instancedDrawGroups += groups.length;
  }

  return {
    visuals,
    stats: {
      visualsSeen: resolved.size,
      visualsResolved: visuals.length,
      vobsPlaced,
      instancedDrawGroups,
      levelCompos: levelCompos.size,
      unresolvedByType,
    },
  };
}
