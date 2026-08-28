'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const zenkit = require('..');
const { walk, readHeader, readHashTable } = require('../lib/container.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');

// `loadWorld` on a malformed mesh section used to never return (see the test at
// the bottom of this file), so it is driven through a child process under a
// wall-clock kill: a regression has to come back as a timeout we report, not as
// a test run that never ends.
function loadInChild(file, timeoutMs) {
  const source = `
    const zenkit = require(${JSON.stringify(path.join(__dirname, '..'))});
    try {
      zenkit.loadWorld(process.argv[1], 'g2');
      console.log('LOADED');
    } catch (err) {
      console.log('THREW ' + err.message.replace(/\\r?\\n/g, ' '));
    }
  `;
  const started = Date.now();
  const proc = spawnSync(process.execPath, ['-e', source, file], {
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  return {
    timedOut: !!(proc.error && proc.error.code === 'ETIMEDOUT'),
    elapsed: Date.now() - started,
    status: proc.status,
    stdout: (proc.stdout || '').trim(),
    stderr: (proc.stderr || '').trim(),
  };
}

test('loadWorld loads the golden fixture and reports exact stats', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  const stats = zenkit.worldStats(handle);
  assert.deepStrictEqual(stats, {
    vobCount: 5,
    waypointCount: 4,
    meshVertexCount: 4,
  });
});

test('loadWorld with the wrong game version fails loudly, naming both versions', () => {
  assert.throws(
    () => zenkit.loadWorld(FIXTURE, 'g1'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /version/i);
      assert.match(err.message, /g1/i);
      assert.match(err.message, /g2/i);
      return true;
    }
  );
});

test('loadWorld with a nonexistent path throws', () => {
  assert.throws(() => zenkit.loadWorld(path.join(__dirname, 'fixtures', 'does-not-exist.zen'), 'g2'));
});

test('loadWorld rejects an invalid gameVersion argument', () => {
  assert.throws(() => zenkit.loadWorld(FIXTURE, 'g3'));
});

test('loadWorld turns a ZenKit parse failure into a JS error rather than killing the process', () => {
  // The distinction every other throwing test here misses. All of them trip a
  // check the *binding* makes and get a `Napi::Error`; this one gets past the
  // binding and makes **ZenKit** throw, which is a different exception crossing
  // the same catch.
  //
  // It used to abort the process with 0xC0000409 — `std::terminate` by way of
  // `__fastfail`, because node-gyp compiles every addon TU with
  // `_HAS_EXCEPTIONS=0`, under which MSVC aliases `std::exception` to
  // `stdext::exception` and never declares the real one. `catch (std::exception
  // const&)` in binding.cc then names a type no ZenKit exception derives from,
  // no handler matches, and the whole process dies — taking the editor's
  // zenkit.worker with it for any malformed or truncated world.
  const garbage = path.join(os.tmpdir(), `zenkit-not-a-world-${process.pid}.zen`);
  fs.writeFileSync(garbage, 'not a zen at all');
  try {
    assert.throws(
      () => zenkit.loadWorld(garbage, 'g2'),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /failed to load world/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(garbage, { force: true });
  }
});

// The mesh chunk length of the `MeshAndBsp` blob, located by structure rather
// than by a magic offset: the blob is a flat `uint16 id, uint32 length,
// payload` table, and this rewrites one chunk's length word to a value larger
// than the whole file.
function seedOversizedMeshChunk(dir, name) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const blob = [...walk(buf)].find((ev) => ev.kind === 'rawBlob' && ev.entryName === 'MeshAndBsp');
  assert.ok(blob, 'the fixture must have a MeshAndBsp blob to corrupt');

  // Walk to the VERTICES (0xB030) chunk header — the first one whose length the
  // scan trusts after the material list, so the corruption is reached.
  const end = blob.fileOffset + blob.size;
  let p = blob.fileOffset;
  while (p + 6 <= end && buf.readUInt16LE(p) !== 0xb030) p += 6 + buf.readUInt32LE(p + 2);
  assert.strictEqual(buf.readUInt16LE(p), 0xb030, 'expected a VERTICES chunk in the fixture mesh');
  assert.strictEqual(buf.readUInt32LE(p + 2), 52, 'expected the fixture VERTICES chunk to be 4 vertices');

  buf.writeUInt32LE(0x000f0000, p + 2); // ~1 MB, against a 4 KB file
  const at = path.join(dir, name);
  fs.writeFileSync(at, buf);
  return at;
}

test('a mesh chunk length larger than the file throws instead of scanning forever', () => {
  // `World::load` scans the mesh chunk table for the 0xB060 end chunk, seeking
  // by each chunk's own declared length. `ReadMemory::seek` silently refuses to
  // move past the end of the buffer, so an oversized length does not fail — it
  // leaves the cursor where it was, the scan walks garbage to the end of the
  // archive and then spins there forever: reads return nothing, `chunk_type`
  // stays 0, and the only exit condition never comes. Measured at 202 s of CPU
  // on a real world before the process was killed, with nothing thrown and
  // nothing logged. Patch 0027 adds the end-of-file check.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-mesh-scan-'));
  try {
    const corrupt = seedOversizedMeshChunk(dir, 'oversized-chunk.zen');

    // The same harness on the untouched fixture: if the child could not load a
    // world at all — a missing addon, an unreadable path — this test could pass
    // on the corrupt file for a reason that has nothing to do with the scan.
    const clean = loadInChild(FIXTURE, 30_000);
    assert.strictEqual(clean.stdout, 'LOADED', `${clean.stdout}\n${clean.stderr}`);

    const result = loadInChild(corrupt, 30_000);
    assert.strictEqual(result.timedOut, false,
      `loadWorld did not return within 30 s — the mesh chunk scan is unbounded again`);
    assert.match(result.stdout, /^THREW failed to load world: .*MeshAndBsp/);
    assert.match(result.stdout, /0xB060/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The BinSafe hash table's `insertion_index` — the second of two independent
// counts read off the file, and the one that actually indexes the entry vector
// sized by the first. Located by structure: `readHashTable` already knows the
// entry layout, so the field is the `uint16` two bytes into an entry header.
function seedOutOfRangeInsertionIndex(dir, name) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const header = readHeader(buf);
  const table = readHashTable(buf, header.hashTableOffset);
  assert.ok(table.count > 0, 'the fixture must have hash table entries to corrupt');

  // First entry in file order: `count` u32, then `keyLength` u16,
  // `insertionIndex` u16, ...
  const at = header.hashTableOffset + 4 + 2;
  assert.strictEqual(buf.readUInt16LE(at), table.physical[0], 'expected the first insertion index here');
  buf.writeUInt16LE(0xffff, at); // far outside a table of `count` entries

  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

test('a hash table insertion index outside the table throws instead of writing past the vector', () => {
  // `ReadArchiveBinsafe::read_header` sizes `_m_hash_table_entries` to the
  // file's `hash_table_size` and then indexes it with the file's
  // `insertion_index`, a second unrelated count. `std::vector::operator[]` is
  // unchecked, so an index past the table is an out-of-bounds *write* into the
  // heap — which is why fuzzing this file produced 0xC0000374 (heap
  // corruption) alongside the 0xC0000005s (§16.11). Patch 0029 bounds it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-binsafe-index-'));
  try {
    const corrupt = seedOutOfRangeInsertionIndex(dir, 'bad-insertion-index.zen');

    const result = loadInChild(corrupt, 30_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 30 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}) instead of throwing: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^THREW failed to load world: /);
    assert.match(result.stdout, /insertion index/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A leaf BSP node's `polygonIndex` — a file-supplied offset into the BSP's
// polygon index list, located by structure: the `MeshAndBsp` blob's chunk table
// carries the BSP TREE chunk (0xC040), whose payload is `nodeCount` u32,
// `leafCount` u32, then per node a bbox (6 floats), `polygonIndex` u32 and
// `polygonCount` u32.
function seedOutOfRangeBspPolygonIndex(dir, name) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const blob = [...walk(buf)].find((ev) => ev.kind === 'rawBlob' && ev.entryName === 'MeshAndBsp');
  assert.ok(blob, 'the fixture must have a MeshAndBsp blob to corrupt');

  const end = blob.fileOffset + blob.size;
  const chunk = (id) => {
    let p = blob.fileOffset;
    while (p + 6 <= end && buf.readUInt16LE(p) !== id) p += 6 + buf.readUInt32LE(p + 2);
    assert.strictEqual(buf.readUInt16LE(p), id, `expected a 0x${id.toString(16)} chunk in the fixture BSP`);
    return p + 6;
  };

  const polygons = chunk(0xc010);
  const tree = chunk(0xc040);
  assert.strictEqual(buf.readUInt32LE(tree), 1, 'expected the fixture BSP to be a single node');
  const node = tree + 8 + 6 * 4; // past nodeCount, leafCount and the bbox
  assert.strictEqual(buf.readUInt32LE(node), 0, 'expected the node to start at polygon index 0');
  assert.strictEqual(buf.readUInt32LE(node + 4), buf.readUInt32LE(polygons),
    'expected the node to cover every polygon index in the list');

  buf.writeUInt32LE(0x40000000, node); // far past a list of two indices
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

test('a BSP leaf node addressing polygons outside the index list throws instead of reading wild memory', () => {
  // `BspTree::load` walks each leaf node's `[polygonIndex, polygonIndex +
  // polygonCount)` straight into `polygon_indices` with `operator[]`, and both
  // ends come off the file. The list is sized by a *different* chunk (0xC010),
  // so nothing ties the two together — an out-of-range node reads past the
  // vector, which is one of the unvalidated counts §16.11 leaves unbounded.
  // Found by fuzzing the fixture's entry stream: seed 2 of a 40-seed run
  // bisected to one byte, the high byte of the 0xC010 chunk's id, which drops
  // the polygon list entirely and leaves the same node addressing an empty
  // vector.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-bsp-polys-'));
  try {
    const corrupt = seedOutOfRangeBspPolygonIndex(dir, 'bad-bsp-polygon-index.zen');

    const result = loadInChild(corrupt, 30_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 30 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}) instead of throwing: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^THREW failed to load world: /);
    assert.match(result.stdout, /polygon index/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A shared lightmap's `textureIndex` — a file-supplied index into the texture
// list the same chunk declares, located by structure: the `MeshAndBsp` blob's
// chunk table carries LIGHTMAPS_SHARED (0xB026), whose payload is
// `textureCount` u32, that many `ZTEX` textures, `lightmapCount` u32, then per
// lightmap three vec3s and a `textureIndex` u32 — so the chunk's last four
// bytes are the last lightmap's index.
function seedOutOfRangeLightmapTextureIndex(dir, name) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const blob = [...walk(buf)].find((ev) => ev.kind === 'rawBlob' && ev.entryName === 'MeshAndBsp');
  assert.ok(blob, 'the fixture must have a MeshAndBsp blob to corrupt');

  const end = blob.fileOffset + blob.size;
  let p = blob.fileOffset;
  while (p + 6 <= end && buf.readUInt16LE(p) !== 0xb026) p += 6 + buf.readUInt32LE(p + 2);
  assert.strictEqual(buf.readUInt16LE(p), 0xb026, 'expected a LIGHTMAPS_SHARED chunk in the fixture mesh');

  const payload = p + 6;
  const textureCount = buf.readUInt32LE(payload);
  assert.ok(textureCount > 0, 'expected the fixture to share at least one lightmap texture');

  const at = payload + buf.readUInt32LE(p + 2) - 4; // the last lightmap's textureIndex
  assert.ok(buf.readUInt32LE(at) < textureCount,
    'expected the chunk to end with a texture index inside the fixture texture list');
  buf.writeUInt32LE(0x003c0000, at); // far past a list of `textureCount` textures

  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

test('a shared lightmap naming a texture outside the list throws instead of reading wild memory', () => {
  // `Mesh::load`'s LIGHTMAPS_SHARED branch reads a `texture_index` per lightmap
  // and hands it straight to `lightmap_textures[texture_index]`, an unchecked
  // `operator[]` on a vector of `shared_ptr` sized by the chunk's own texture
  // count. An out-of-range index therefore constructs a `shared_ptr` copy from
  // wild memory — an out-of-bounds read *and* a bogus refcount increment.
  // Found by fuzzing the fixture's entry stream: seed 39 of a 40-seed run
  // delta-debugged to one byte, file offset 899, which is byte 2 of the third
  // lightmap's texture index. This test seeds the same defect by structure.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-lightmap-texture-'));
  try {
    const corrupt = seedOutOfRangeLightmapTextureIndex(dir, 'bad-lightmap-texture-index.zen');

    const result = loadInChild(corrupt, 30_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 30 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}) instead of throwing: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^THREW failed to load world: /);
    assert.match(result.stdout, /texture index/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A shared lightmap texture's `mipmapCount`, located by structure: the
// LIGHTMAPS_SHARED chunk's payload is `textureCount` u32 followed by that many
// `ZTEX` textures, and a `ZTEX` header is the 4-byte signature, `version`,
// `format`, `width`, `height` and then `mipmapCount` — so the count sits 20
// bytes into the first texture.
function seedAbsurdLightmapMipmapCount(dir, name) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const blob = [...walk(buf)].find((ev) => ev.kind === 'rawBlob' && ev.entryName === 'MeshAndBsp');
  assert.ok(blob, 'the fixture must have a MeshAndBsp blob to corrupt');

  const end = blob.fileOffset + blob.size;
  let p = blob.fileOffset;
  while (p + 6 <= end && buf.readUInt16LE(p) !== 0xb026) p += 6 + buf.readUInt32LE(p + 2);
  assert.strictEqual(buf.readUInt16LE(p), 0xb026, 'expected a LIGHTMAPS_SHARED chunk in the fixture mesh');

  const texture = p + 6 + 4; // past the chunk header and `textureCount`
  assert.strictEqual(buf.toString('latin1', texture, texture + 4), 'ZTEX',
    'expected the chunk to declare at least one texture');

  const at = texture + 20;
  assert.strictEqual(buf.readUInt32LE(at), 1, 'expected the fixture texture to carry a single mipmap level');
  buf.writeUInt32LE(0x00920001, at); // the fuzzer's byte, 9.5 million levels

  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

test('a lightmap texture declaring more mipmap levels than a texture can have throws instead of hanging', () => {
  // `Texture::load` trusts the file's `mipmapCount` and walks one iteration per
  // level, and `_ztex_mipmap_size` halves the dimensions once per level *inside*
  // that walk — so the cost is quadratic in a count nothing bounds, and 9.5
  // million levels is ~9e13 iterations that neither throw nor return. Found by
  // fuzzing the fixture's entry stream: seed 17 of a 40-seed run delta-debugged
  // to one byte, file offset 679, which is byte 2 of the first shared lightmap
  // texture's mipmap count. This test seeds the same defect by structure.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-mipmap-count-'));
  try {
    const corrupt = seedAbsurdLightmapMipmapCount(dir, 'bad-mipmap-count.zen');

    const result = loadInChild(corrupt, 30_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 30 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}) instead of throwing: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^THREW failed to load world: /);
    assert.match(result.stdout, /mipmap/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A waypoint's class name in its BinSafe object header, rewritten to a class
// ZenKit does not know. Located by structure: the header is the entry stream's
// `[<name> <class> <version> <index>]` string, so this replaces the class token
// in place with one of the same length — no offset in the file moves.
function seedUnknownWaypointClass(dir, name, frameName) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const begin = [...walk(buf)].find((ev) => ev.kind === 'objectBegin' && ev.entryName === frameName);
  assert.ok(begin, `the fixture must contain a ${frameName} object to corrupt`);
  assert.strictEqual(begin.frame.cls, 'zCWaypoint', `expected ${frameName} to be a zCWaypoint`);

  // `uint8` entry type, `uint16` string length, then the header string itself.
  const at = buf.indexOf('zCWaypoint', begin.fileOffset + 3, 'latin1');
  assert.ok(at > 0 && at < begin.fileOffset + 3 + buf.readUInt16LE(begin.fileOffset + 1),
    'expected the class token inside the object header string');
  buf.write('zCWayXoint', at, 'latin1'); // same length, unknown to ZenKit

  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

test('a free waypoint whose class does not resolve throws instead of dereferencing null', () => {
  // `WayNet::load` does `points.push_back(r.read_object<WayPoint>(version));`
  // and then `points.back()->free_point = true` — but `read_object` returns
  // null for an unknown class, for a `%` empty object and for an unresolved
  // back-reference, so the very next line dereferences a null `shared_ptr`.
  // Found by fuzzing the fixture's entry stream: seeds 68 and 81 of a 200-seed
  // run each delta-debug to one byte inside the first waypoint's object header
  // (offsets 2716 and 2723). This test seeds the same defect by structure.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-waypoint-class-'));
  try {
    const corrupt = seedUnknownWaypointClass(dir, 'bad-waypoint-class.zen', 'waypoint0');

    const result = loadInChild(corrupt, 30_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 30 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}) instead of throwing: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^THREW failed to load world: /);
    assert.match(result.stdout, /waypoint/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a waynet edge endpoint that does not resolve still loads, and is dropped', () => {
  // The bound above is deliberately narrow. An edge's `wayl`/`wayr` can be null
  // for the same three reasons, but nothing in `WayNet::load` dereferences one,
  // and the binding's `CollectWaypoints`/`WayNetGraph` filter nulls out on
  // purpose — a reference into a waynet ZenGin itself wrote can go unresolved.
  // Refusing such a world would be a new refusal rather than a crash fix, so
  // this test holds the reader to loading it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-waynet-edge-'));
  try {
    const corrupt = seedUnknownWaypointClass(dir, 'bad-edge-class.zen', 'wayl0');

    const result = loadInChild(corrupt, 30_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 30 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}) instead of loading: ${result.stdout}
${result.stderr}`);
    assert.strictEqual(result.stdout, 'LOADED');

    assert.strictEqual(zenkit.getWaynet(zenkit.loadWorld(corrupt, 'g2')).count,
      zenkit.getWaynet(zenkit.loadWorld(FIXTURE, 'g2')).count - 1,
      'the unresolvable endpoint should be dropped from the waynet, not counted in it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The BSP OUTDOORS chunk's `sectorCount`, located by structure: the
// `MeshAndBsp` blob's chunk table carries OUTDOORS (0xC050), whose payload is
// `sectorCount` u32 followed by that many sectors and then `portalCount` u32 —
// so on a world with no sectors the count is the chunk's first four bytes. The
// value written is the fuzzer's own, not a rounder large one: an absurd count
// is caught by `reserve` throwing `bad_alloc` and never reaches the loop, so a
// test seeded with two billion sectors would pass against the unpatched
// reader.
function seedAbsurdBspSectorCount(dir, name) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const blob = [...walk(buf)].find((ev) => ev.kind === 'rawBlob' && ev.entryName === 'MeshAndBsp');
  assert.ok(blob, 'the fixture must have a MeshAndBsp blob to corrupt');

  const end = blob.fileOffset + blob.size;
  let p = blob.fileOffset;
  while (p + 6 <= end && buf.readUInt16LE(p) !== 0xc050) p += 6 + buf.readUInt32LE(p + 2);
  assert.strictEqual(buf.readUInt16LE(p), 0xc050, 'expected an OUTDOORS chunk in the fixture BSP');

  const at = p + 6;
  assert.strictEqual(buf.readUInt32LE(at), 0, 'expected the fixture BSP to declare no sectors');
  buf.writeUInt32LE(0x79, at); // the fuzzer's byte: 121 sectors in a chunk that holds none

  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

test('a BSP declaring more sectors than the chunk holds bytes throws instead of hanging', () => {
  // `BspTree::load`'s OUTDOORS branch trusts the file's `sector_count` and runs
  // one `read_line` plus two `resize`s per sector — and `read_chunked` hands the
  // callback the whole reader, not one bounded to the chunk, so the first sector
  // reads its own `node_count` across the *next* chunk's header. Here that is
  // 0xFF000000 and the `resize` commits 17 GB: one sector is already enough to
  // hang, and 121 of them is what the fuzzer found. Seed 124 of the 200-seed run
  // delta-debugged to one byte, file offset 1317, the low byte of this count.
  // This test seeds the same defect by structure.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-bsp-sectors-'));
  try {
    const corrupt = seedAbsurdBspSectorCount(dir, 'bad-bsp-sector-count.zen');

    const result = loadInChild(corrupt, 30_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 30 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}) instead of throwing: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^THREW failed to load world: /);
    assert.match(result.stdout, /sector/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A BSP tree whose nodes descend in one unbroken chain, located by structure:
// the `MeshAndBsp` blob's chunk table carries TREE (0xC040), whose payload is
// `nodeCount` u32, `leafCount` u32 and then the nodes themselves — a bbox (6
// floats), `polygonIndex` u32, `polygonCount` u32 and, for a non-leaf, a flags
// byte plus the split plane (4 floats), 49 bytes in all. Bit 0 of the flags
// says "a front child follows", so a run of nodes that all set it and nothing
// else is a chain of `depth` nodes with no branching. The chunk grows, so the
// blob's own declared size and the header's hash table offset move with it;
// nothing else in the container carries an absolute offset.
function seedDeepBspChain(dir, name, depth) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const header = readHeader(buf);
  const blob = [...walk(buf)].find((ev) => ev.kind === 'rawBlob' && ev.entryName === 'MeshAndBsp');
  assert.ok(blob, 'the fixture must have a MeshAndBsp blob to corrupt');

  const end = blob.fileOffset + blob.size;
  let p = blob.fileOffset;
  while (p + 6 <= end && buf.readUInt16LE(p) !== 0xc040) p += 6 + buf.readUInt32LE(p + 2);
  assert.strictEqual(buf.readUInt16LE(p), 0xc040, 'expected a TREE chunk in the fixture BSP');
  const oldLength = buf.readUInt32LE(p + 2);
  assert.strictEqual(buf.readUInt32LE(p + 6), 1, 'expected the fixture BSP to be a single node');

  const NODE_SIZE = 49;
  const inner = Buffer.alloc(NODE_SIZE);
  inner.writeUInt8 (0x01, 32); // flags: a front child follows, and this node is not a leaf
  const last = Buffer.alloc(NODE_SIZE); // flags 0: no children, so the chain ends here

  const payload = Buffer.concat([
    Buffer.alloc(8),
    ...Array.from({ length: depth - 1 }, () => inner),
    last,
  ]);
  // A `nodeCount` of 1 would make the root a leaf and stop before the flags are
  // ever read; the value is otherwise only a `reserve` hint.
  payload.writeUInt32LE(depth, 0);
  payload.writeUInt32LE(0, 4);

  const chunk = Buffer.alloc(6);
  chunk.writeUInt16LE(0xc040, 0);
  chunk.writeUInt32LE(payload.length, 2);

  const grown = Buffer.concat([buf.subarray(0, p), chunk, payload, buf.subarray(p + 6 + oldLength)]);
  const delta = payload.length - oldLength;
  grown.writeUInt32LE(blob.size + delta, blob.fileOffset - 4);        // the blob's declared size
  grown.writeUInt32LE(header.hashTableOffset + delta, header.entryStart - 4);

  const file = path.join(dir, name);
  fs.writeFileSync(file, grown);
  return file;
}

test('a BSP tree that descends in one long chain loads instead of overflowing the stack', () => {
  // `_parse_bsp_nodes` recursed once per file-supplied flag bit with no depth
  // bound — the last unbounded site §16.11 names by name, and the one the
  // fuzzer could never reach, because a chain deep enough to exhaust the stack
  // needs more bytes than the fixture has. Measured before patch 0035: 100,000
  // nodes killed the child with 0xC00000FD (stack overflow) on node's 8 MB main
  // thread, and the editor loads worlds on a `worker_threads` worker whose
  // default stack is 4 MB — half of that. The depth below is a chain, not a
  // tree: no world ZenGin wrote looks like this, but nothing in the format
  // stops a corrupted one from claiming it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-bsp-depth-'));
  try {
    const corrupt = seedDeepBspChain(dir, 'deep-bsp-chain.zen', 200_000);

    const result = loadInChild(corrupt, 60_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 60 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}) instead of parsing the chain: ${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stdout, 'LOADED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The mesh chunks each open with a `uint32` element count that sizes a `resize`
// before a single element is read. Located by structure: the `MeshAndBsp` blob's
// chunk table carries VERTICES (0xB030), FEATURES (0xB040) and POLYGONS
// (0xB050), and the count is the first field of each payload. The count is
// rewritten in place, so nothing in the container moves.
function seedAbsurdMeshCount(dir, name, chunkId, count) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const blob = [...walk(buf)].find((ev) => ev.kind === 'rawBlob' && ev.entryName === 'MeshAndBsp');
  assert.ok(blob, 'the fixture must have a MeshAndBsp blob to corrupt');

  const end = blob.fileOffset + blob.size;
  let p = blob.fileOffset;
  while (p + 6 <= end && buf.readUInt16LE(p) !== chunkId) p += 6 + buf.readUInt32LE(p + 2);
  assert.strictEqual(buf.readUInt16LE(p), chunkId,
    `expected chunk 0x${chunkId.toString(16)} in the fixture mesh`);

  buf.writeUInt32LE(count, p + 6);

  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

// 268 million elements: large enough that the `resize` commits gigabytes
// (measured on the unpatched reader: 3.2 GB of vertices in 1.6 s, 8.6 GB of
// features in 5.1 s, and 13.9 s for the polygons) and small enough that it
// does not simply fail. An *absurd* count is the harmless case — 0xFFFFFFFF
// vertices throw `bad allocation` before anything is committed — so the value
// below is the one that has to be refused by a guard, and the assertion names
// the count so a `bad allocation` on a smaller machine cannot pass for one.
const MESH_COUNT_CASES = [
  { chunk: 0xb030, id: 'VERTICES', pattern: /vertex count/i },
  { chunk: 0xb040, id: 'FEATURES', pattern: /feature count/i },
  { chunk: 0xb050, id: 'POLYGONS', pattern: /polygon count/i },
];

for (const testCase of MESH_COUNT_CASES) {
  test(`a mesh ${testCase.id} chunk declaring more elements than the file holds bytes throws instead of committing gigabytes`,
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-mesh-count-'));
      try {
        const corrupt = seedAbsurdMeshCount(dir, `bad-mesh-${testCase.id}.zen`, testCase.chunk, 0x0fffffff);

        const result = loadInChild(corrupt, 60_000);
        assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 60 s');
        assert.strictEqual(result.status, 0,
          `the child died (status ${result.status}): ${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /^THREW failed to load world: /);
        assert.match(result.stdout, testCase.pattern);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
}

// The waynet's own counts, rewritten in place. `WayNet::load` reads
// `waynetVersion`, `numWaypoints` and `numWays` in that order as the first three
// INTEGER entries of the `zCWayNet` object, so the edge count is the third --
// located by structure, and rewritten in place, so nothing in the container
// moves.
function seedAbsurdWaynetCount(dir, name, which, count) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const ints = [];
  let netDepth = -1;
  for (const ev of walk(buf)) {
    if (ev.kind === 'objectBegin' && ev.frame && ev.frame.cls === 'zCWayNet') netDepth = ev.objectDepth;
    else if (ev.kind === 'entry' && ev.entryType === 'INTEGER' && ev.objectDepth === netDepth + 1) {
      // The waynet's own fields, not the `waterDepth` of a waypoint nested inside it.
      ints.push(ev);
    }
  }
  assert.ok(ints.length >= 3, 'the fixture waynet must carry its three int fields');
  buf.writeUInt32LE(count, ints[which].payloadOffset);

  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

test('a waynet declaring more edges than the archive holds bytes throws instead of loading 268 million of them', () => {
  // `edges.reserve` alone commits 8.6 GB, and the loop after it does not stop
  // when the archive runs out -- `read_object` at the end of
  // the entry stream logs and returns null rather than throwing, so both
  // endpoints are pushed onto `points` and an edge onto `edges`, once per unit
  // of the file's own count. Found by construction with
  // `tools/fuzz-world.js --counts`, which sweeps every INTEGER entry in turn:
  // 600 random seeds over this fixture and 160 over retail NewWorld never hit
  // the four bytes of a count. An *absurd* count is the harmless one, as
  // everywhere else in this file, so the value below is one a guard has to
  // refuse and the assertion names the guard's own wording. Measured unpatched:
  // the world reports LOADED after 41 s, so this is not even a hang.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-waynet-count-'));
  try {
    const corrupt = seedAbsurdWaynetCount(dir, 'bad-waynet-edges.zen', 2, 0x0fffffff);

    const result = loadInChild(corrupt, 60_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 60 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}): ${result.stdout}
${result.stderr}`);
    assert.match(result.stdout, /^THREW failed to load world: /);
    assert.match(result.stdout, /edge count/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a waynet declaring more waypoints than the archive holds bytes throws instead of committing gigabytes', () => {
  // The same unbounded `reserve` one field earlier. This one already fails
  // loudly -- patch 0033's null guard throws on the first waypoint that is not
  // there -- but only after `points.reserve` has committed 4.3 GB, so it is
  // bounded by the same argument and asserted on the guard's wording.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-waynet-count-'));
  try {
    const corrupt = seedAbsurdWaynetCount(dir, 'bad-waynet-points.zen', 1, 0x0fffffff);

    const result = loadInChild(corrupt, 60_000);
    assert.strictEqual(result.timedOut, false, 'loadWorld did not return within 60 s');
    assert.strictEqual(result.status, 0,
      `the child died (status ${result.status}): ${result.stdout}
${result.stderr}`);
    assert.match(result.stdout, /^THREW failed to load world: /);
    assert.match(result.stdout, /waypoint count/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
