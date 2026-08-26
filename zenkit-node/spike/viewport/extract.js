'use strict';

// Viewport spike, half 1 of 2 (level-editor.md §3): turn a retail world into a
// payload a browser can render, and print what the scene will cost before any
// Three.js exists. Half 2 is index.html, which loads the payload and measures
// framerate and pick latency.
//
// THROWAWAY. This is an instrument for one measurement, not a component: the
// real pipeline is zen-world/coords + WorldService, and this directory is
// deleted when the Phase 1a viewport lands. It stays in the repo only so the
// numbers it produced can be re-run and disputed.

const fs = require('node:fs');
const path = require('node:path');

const zenkit = require('../..');

const GOTHIC = process.env.GOTHIC2 || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Gothic II';
const DATA = path.join(GOTHIC, '_work', 'Data');
const WORLD = process.argv[2] || path.join(DATA, 'Worlds', 'NewWorld', 'NewWorld.zen');
const OUT = path.join(__dirname, 'payload');

// The merge key. Chunks arrive one per material and the retail worlds put 1400
// materials on 330 textures, so the renderer merges — but only chunks that
// render identically may merge, or an additive-blend flame ends up inside an
// opaque wall with nothing reporting a problem. Measured on NewWorld: texture
// alone gives 330 groups, this key gives 352, and the 22 it refuses to merge
// are real differences in blend mode, scroll speed, env-map strength and
// vertex colour.
function mergeKey(chunk) {
  return JSON.stringify([
    chunk.texture.toUpperCase(),
    chunk.alphaFunc, chunk.texAniMapMode, chunk.texAniFps, chunk.texAniMapDir,
    chunk.envMapping, chunk.envMappingStrength,
    chunk.waveMode, chunk.waveSpeed, chunk.waveMaxAmplitude, chunk.waveGridSize,
    chunk.ignoreSun, chunk.disableLightmap,
    chunk.color,
  ]);
}

// One growing binary blob; the manifest addresses into it. A single fetch beats
// a few thousand.
const pack = [];
let packBytes = 0;
function append(buffer) {
  const at = packBytes;
  pack.push(Buffer.from(buffer));
  packBytes += buffer.byteLength;
  return { at, bytes: buffer.byteLength };
}

function mergeChunks(chunks) {
  const groups = new Map();

  for (const chunk of chunks) {
    const key = mergeKey(chunk);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        texture: chunk.texture.toUpperCase(),
        alphaFunc: chunk.alphaFunc,
        texAniMapMode: chunk.texAniMapMode,
        texAniFps: chunk.texAniFps,
        texAniMapDir: chunk.texAniMapDir,
        envMapping: chunk.envMapping,
        envMappingStrength: chunk.envMappingStrength,
        waveMode: chunk.waveMode,
        color: chunk.color,
        materials: 0,
        vertexCount: 0,
        triangleCount: 0,
        parts: [],
      };
      groups.set(key, group);
    }

    group.parts.push(chunk);
    group.materials += 1;
    group.vertexCount += chunk.vertexCount;
    group.triangleCount += chunk.triangleCount;
  }

  // Concatenate each group's parts into one buffer set, re-basing indices.
  return [...groups.values()].map((group) => {
    const positions = new Float32Array(group.vertexCount * 3);
    const normals = new Float32Array(group.vertexCount * 3);
    const uvs = new Float32Array(group.vertexCount * 2);
    const lights = new Uint32Array(group.vertexCount);
    const indices = new Uint32Array(group.triangleCount * 3);
    let vertex = 0;
    let index = 0;

    for (const part of group.parts) {
      positions.set(new Float32Array(part.positions), vertex * 3);
      normals.set(new Float32Array(part.normals), vertex * 3);
      uvs.set(new Float32Array(part.uvs), vertex * 2);
      if (part.lights) lights.set(new Uint32Array(part.lights), vertex);
      for (const corner of new Uint32Array(part.indices)) indices[index++] = corner + vertex;
      vertex += part.vertexCount;
    }

    delete group.parts;
    return {
      ...group,
      positions: append(positions.buffer),
      normals: append(normals.buffer),
      uvs: append(uvs.buffer),
      lights: append(lights.buffer),
      indices: append(indices.buffer),
    };
  });
}

function collectTextures(vfs, names) {
  const textures = [];
  let skipped = 0;

  for (const name of names) {
    if (!name) continue;
    let decoded = zenkit.decodeTexture(vfs, name, 0);
    if (decoded === null) {
      skipped += 1;
      continue;
    }

    // Cap at 256px by picking a mipmap rather than resampling: the spike is
    // measuring draw calls and pick latency, and a 340 MB texture payload would
    // only measure the loopback interface.
    let level = 0;
    while (Math.max(decoded.width, decoded.height) > 256 && level + 1 < decoded.mipmaps) {
      decoded = zenkit.decodeTexture(vfs, name, ++level);
    }

    textures.push({
      name: name.toUpperCase(),
      width: decoded.width,
      height: decoded.height,
      level,
      rgba: append(decoded.rgba),
    });
  }

  return { textures, skipped };
}

const timings = {};
function phase(name, fn) {
  const t0 = Date.now();
  const value = fn();
  timings[name] = Date.now() - t0;
  return value;
}

function main() {
  const t0 = Date.now();
  const handle = phase('load', () => zenkit.loadWorld(WORLD, 'g2'));
  const mesh = phase('worldMesh', () => zenkit.extractWorldMesh(handle));
  // vobIndex, not normalizeWorld: the dump costs 877 ms on this world and
  // nothing here wants per-class properties or the container section.
  const index = phase('vobIndex', () => zenkit.vobIndex(handle));

  const worldGroups = phase('mergeWorld', () => mergeChunks(mesh.chunks));

  // Archives when they are there, loose directories otherwise. Measured on this
  // install the two resolve every name identically and decode byte-identical
  // pixels, but mounting the four VDFs takes 15 ms against 2170 ms for the two
  // loose trees — mount_host memory-maps every one of their 4153 files, and a
  // file open costs ~0.5 ms on this machine whoever does it.
  const archives = ['Textures.vdf', 'Textures_Addon.vdf', 'Meshes.vdf', 'Meshes_Addon.vdf']
    .flatMap((name) => [path.join(GOTHIC, 'Data', name), path.join(GOTHIC, 'Data', `${name}.disabled`)])
    .filter((file) => fs.existsSync(file));
  const sources = archives.length > 0
    ? archives
    : [path.join(DATA, 'Meshes', '_compiled'), path.join(DATA, 'Textures', '_compiled')];
  const vfs = phase('openVfs', () => zenkit.openVfs(sources, { overwrite: 'all' }));

  // One extraction per unique visual name; the VOBs that share it become
  // instances of it. This is rule 1 of §3 — never one Mesh per VOB — and it is
  // what turns ~15k objects into a few hundred draw calls.
  const visuals = new Map();
  const unresolved = new Map();
  let placed = 0;

  phase('visuals', () => {
    const positions = new Float32Array(index.positions);
    const rotations = new Float32Array(index.rotations);
    const visualIndex = new Uint32Array(index.visualIndex);
    const visualTypeIndex = new Uint32Array(index.visualTypeIndex);

    for (let i = 0; i < index.count; i++) {
      const name = index.visuals[visualIndex[i]];
      if (!name) continue;

      let visual = visuals.get(name);
      if (visual === undefined) {
        const payload = zenkit.extractVisual(vfs, name);
        visual = payload === null ? null : { payload, matrices: [] };
        visuals.set(name, visual);
        if (visual === null) {
          const type = index.visualTypes[visualTypeIndex[i]];
          unresolved.set(type, (unresolved.get(type) || 0) + 1);
        }
      }
      if (visual === null) continue;

      // Row-major 3x3 plus translation, in ZenGin space — the browser half
      // feeds it to Matrix4.set(), which takes row-major arguments, and applies
      // the one ZenGin->Three.js conversion around the whole scene.
      const r = i * 9;
      const p = i * 3;
      visual.matrices.push(
        rotations[r], rotations[r + 1], rotations[r + 2], positions[p],
        rotations[r + 3], rotations[r + 4], rotations[r + 5], positions[p + 1],
        rotations[r + 6], rotations[r + 7], rotations[r + 8], positions[p + 2],
      );
      placed += 1;
    }
  });

  const instanced = phase('mergeVisuals', () => {
    const out = [];
    for (const [name, visual] of visuals) {
      if (visual === null || visual.matrices.length === 0) continue;
      out.push({
        name,
        source: visual.payload.source,
        count: visual.matrices.length / 12,
        matrices: append(new Float32Array(visual.matrices).buffer),
        groups: mergeChunks(visual.payload.chunks),
      });
    }
    return out;
  });

  const names = new Set(worldGroups.map((g) => g.texture));
  for (const visual of instanced) for (const g of visual.groups) names.add(g.texture);
  const { textures, skipped } = phase('textures', () => collectTextures(vfs, names));

  const drawCalls = worldGroups.length + instanced.reduce((n, v) => n + v.groups.length, 0);
  const manifest = {
    world: path.basename(WORLD),
    bbox: mesh.bbox,
    timings,
    extractMs: Date.now() - t0,
    mountedArchives: archives.length > 0,
    worldGroups,
    instanced,
    textures,
    stats: {
      materials: mesh.chunks.length,
      uniqueTextures: names.size,
      texturesDecoded: textures.length,
      texturesUnresolved: skipped,
      worldTriangles: mesh.triangleCount,
      worldDrawCalls: worldGroups.length,
      visualsSeen: visuals.size,
      visualsResolved: instanced.length,
      vobsPlaced: placed,
      vobTriangles: instanced.reduce(
        (n, v) => n + v.groups.reduce((m, g) => m + g.triangleCount, 0) * v.count, 0,
      ),
      instancedDrawCalls: drawCalls - worldGroups.length,
      drawCalls,
      unresolvedByType: Object.fromEntries(unresolved),
      packBytes,
    },
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pack.bin'), Buffer.concat(pack));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));

  console.log(manifest.stats);
  console.log(timings);
  console.log('pack.bin', (packBytes / 1048576).toFixed(1), 'MB, total', Date.now() - t0, 'ms');
}

main();
