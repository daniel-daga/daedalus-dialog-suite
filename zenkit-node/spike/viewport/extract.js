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

function main() {
  const t0 = Date.now();
  const handle = zenkit.loadWorld(WORLD, 'g2');
  const mesh = zenkit.extractWorldMesh(handle);
  const dump = zenkit.normalizeWorld(handle);
  const tLoad = Date.now() - t0;

  const worldGroups = mergeChunks(mesh.chunks);

  const vfs = zenkit.openVfs(
    [path.join(DATA, 'Meshes', '_compiled'), path.join(DATA, 'Textures', '_compiled')],
    { overwrite: 'all' },
  );

  // One extraction per unique visual name; the VOBs that share it become
  // instances of it. This is rule 1 of §3 — never one Mesh per VOB — and it is
  // what turns ~15k objects into a few hundred draw calls.
  const visuals = new Map();
  const unresolved = new Map();
  let placed = 0;

  for (const vob of dump.vobs) {
    if (!vob.visual) continue;

    let visual = visuals.get(vob.visual.toUpperCase());
    if (visual === undefined) {
      const payload = zenkit.extractVisual(vfs, vob.visual);
      visual = payload === null ? null : { payload, matrices: [] };
      visuals.set(vob.visual.toUpperCase(), visual);
      if (visual === null) {
        unresolved.set(vob.visualType, (unresolved.get(vob.visualType) || 0) + 1);
      }
    }
    if (visual === null) continue;

    // Row-major 3x3 plus translation, in ZenGin space — the browser half feeds
    // it to Matrix4.set(), which takes row-major arguments, and applies the one
    // ZenGin->Three.js conversion around the whole scene.
    const r = vob.rotation;
    const p = vob.position;
    visual.matrices.push(
      r[0], r[1], r[2], p[0],
      r[3], r[4], r[5], p[1],
      r[6], r[7], r[8], p[2],
    );
    placed += 1;
  }

  const instanced = [];
  for (const [name, visual] of visuals) {
    if (visual === null || visual.matrices.length === 0) continue;
    instanced.push({
      name,
      source: visual.payload.source,
      count: visual.matrices.length / 12,
      matrices: append(new Float32Array(visual.matrices).buffer),
      groups: mergeChunks(visual.payload.chunks),
    });
  }

  const names = new Set(worldGroups.map((g) => g.texture));
  for (const visual of instanced) for (const g of visual.groups) names.add(g.texture);
  const { textures, skipped } = collectTextures(vfs, names);

  const drawCalls = worldGroups.length + instanced.reduce((n, v) => n + v.groups.length, 0);
  const manifest = {
    world: path.basename(WORLD),
    bbox: mesh.bbox,
    extractMs: tLoad,
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
  console.log('pack.bin', (packBytes / 1048576).toFixed(1), 'MB, total', Date.now() - t0, 'ms');
}

main();
