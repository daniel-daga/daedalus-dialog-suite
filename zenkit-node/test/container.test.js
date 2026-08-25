'use strict';

// Container-level fidelity instrument (phase-0 §5 "clean diff / broken engine"
// cell). `normalizeWorld` reads ZenKit's parsed structs and is blind to archive
// CONTAINER facts; the `container` section is computed from the archive BYTES.
// Every test here builds a mutated copy of the fixture by Buffer surgery, runs
// it through the public classify path and expects `semantic-drift` naming the
// container sub-key — or `identical` for the unchanged file.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');
const { classifyDumps } = require('../lib/classify.js');
const { walk, readHeader, containerFromBuffer } = require('../lib/container.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-node-container-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function events(buf) {
  return [...walk(buf)];
}

function baselineDump() {
  return zenkit.normalizeWorld(zenkit.loadWorld(FIXTURE, 'g2'));
}

// Loads the mutant through the binding when ZenKit accepts it; when the loader
// refuses the bytes, only the container section is recomputed from the Buffer.
// Either way the comparison goes through the public `classifyDumps`.
function classifyMutant(mutate) {
  const baseline = baselineDump();
  const mutant = mutate(Buffer.from(fs.readFileSync(FIXTURE)));
  return withTmpDir((dir) => {
    const file = path.join(dir, 'mutant.zen');
    fs.writeFileSync(file, mutant);
    let dump;
    try {
      dump = zenkit.normalizeWorld(zenkit.loadWorld(file, 'g2'));
    } catch {
      dump = { ...baseline, container: containerFromBuffer(mutant) };
    }
    return classifyDumps(baseline, dump);
  });
}

function assertDriftAt(result, pattern) {
  assert.strictEqual(result.classification, 'semantic-drift');
  const hit = result.findings.find((f) => pattern.test(f.path));
  assert.ok(hit, `expected a finding matching ${pattern}, got: ${result.findings.map((f) => f.path).join(', ')}`);
  assert.strictEqual(hit.class, 'semantic-drift');
  assert.ok(
    result.findings.filter((f) => f.path.startsWith('container.')).every((f) => f.class === 'semantic-drift'),
    'every container finding must be semantic-drift'
  );
}

test('(g) the unchanged fixture classifies identical with a container section on both sides', () => {
  const result = classifyMutant((buf) => buf);
  assert.strictEqual(result.classification, 'identical');
  assert.deepStrictEqual(result.findings, []);
});

test('(a) physically reordered hash-table records (same index/hash) are semantic-drift naming the physical order', () => {
  const result = classifyMutant((buf) => {
    const h = readHeader(buf);
    const count = buf.readUInt32LE(h.hashTableOffset);
    let p = h.hashTableOffset + 4;
    const records = [];
    for (let i = 0; i < count; i++) {
      const keyLength = buf.readUInt16LE(p);
      records.push(buf.subarray(p, p + 8 + keyLength));
      p += 8 + keyLength;
    }
    assert.strictEqual(p, buf.length, 'hash table must end the file');
    [records[0], records[1]] = [records[1], records[0]];
    return Buffer.concat([buf.subarray(0, h.hashTableOffset + 4), ...records]);
  });
  assertDriftAt(result, /^container\.hashTable\.physicalOrder$/);
  // Key set, insertion indices and hashes are untouched: no finding may claim otherwise.
  assert.ok(result.findings.every((f) => !f.path.startsWith('container.hashTable.keys')));
});

test('(b) a changed object frame version is semantic-drift naming the frames', () => {
  const result = classifyMutant((buf) => {
    const frame = events(buf).find((ev) => ev.kind === 'objectBegin' && ev.frame.cls === 'zCVob');
    assert.strictEqual(frame.frame.version, '52224');
    const at = buf.indexOf('52224', frame.fileOffset, 'latin1');
    buf.write('52223', at, 'latin1');
    return buf;
  });
  assertDriftAt(result, /^container\.frames\./);
});

test('(c) one flipped byte in a RAW payload is semantic-drift naming the (class, entry) payload hash', () => {
  const result = classifyMutant((buf) => {
    const entry = events(buf).find((ev) => ev.kind === 'entry' && ev.entryName === 'dataRaw');
    assert.strictEqual(entry.entryType, 'RAW');
    const last = entry.payloadOffset + entry.payloadLength - 1;
    buf[last] ^= 0x01;
    return buf;
  });
  assertDriftAt(result, /^container\.payloads\.raw\.zCVob\/dataRaw$/);
});

test('(d) a BOOL raw value 1 → 0xFFFFFFFF is semantic-drift naming the BOOL payload hash', () => {
  const result = classifyMutant((buf) => {
    const entry = events(buf).find((ev) => ev.kind === 'entry' && ev.entryName === 'locked');
    assert.strictEqual(entry.entryType, 'BOOL');
    assert.strictEqual(buf.readUInt32LE(entry.payloadOffset), 1);
    buf.writeUInt32LE(0xffffffff, entry.payloadOffset);
    return buf;
  });
  assertDriftAt(result, /^container\.payloads\.bool\..*\/locked$/);
  // ZenKit reads both as `true`; the parsed-struct sections must NOT see this.
  assert.ok(result.findings.every((f) => f.path.startsWith('container.')));
});

test('(e) an entry renamed via another hash-table index of the same type is semantic-drift naming the schema', () => {
  const result = classifyMutant((buf) => {
    const hdr = events(buf)[0];
    const takeableIndex = hdr.hashTable.entries.findIndex((e) => e && e.key === 'takeable');
    assert.ok(takeableIndex >= 0);
    const entry = events(buf).find((ev) => ev.kind === 'entry' && ev.entryName === 'moveable');
    assert.strictEqual(entry.entryType, 'BOOL');
    buf.writeUInt32LE(takeableIndex, entry.fileOffset + 1);
    return buf;
  });
  assertDriftAt(result, /^container\.schemas\./);
  assert.ok(result.findings.every((f) => f.path.startsWith('container.')));
});

test('(f) a changed byte inside the MeshAndBsp blob is semantic-drift naming the chunk', () => {
  const result = classifyMutant((buf) => {
    const at = buf.indexOf('MINIMAL_FIXTURE', 0, 'latin1');
    assert.ok(at > 0);
    buf.write('MINIMAL_FIXTURF', at, 'latin1');
    return buf;
  });
  assertDriftAt(result, /^container\.meshAndBsp\.chunks\[0\]\./);
});

test('containerFromBuffer describes the fixture archive', () => {
  const container = containerFromBuffer(fs.readFileSync(FIXTURE));
  // Verbatim, with only the stamp VALUES removed: a missing/added stamp line is drift.
  assert.deepStrictEqual(container.header.lines, [
    'ZenGin Archive', 'ver 1', 'zCArchiverBinSafe', 'BIN_SAFE', 'saveGame 0', 'date', 'user', 'END',
  ]);
  assert.strictEqual(container.header.date, '');
  assert.strictEqual(container.header.user, 'Daniel');
  assert.strictEqual(container.hashTable.count, 37);
  assert.deepStrictEqual(container.hashTable.keys[0], { key: 'childs0', index: 0, hash: 86 });
  assert.match(container.hashTable.physicalOrder, /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(container.frames.total, 17);
  assert.deepStrictEqual(container.frames.classes['zCVob'], { count: 1, versions: { 52224: 1 } });
  assert.match(container.frames.sequenceHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepStrictEqual(container.schemas['oCItem:zCVob'], {
    entries: [['pack', 'INTEGER'], ['dataRaw', 'RAW'], ['vobName', 'STRING'], ['itemInstance', 'STRING']],
    objects: 1,
    deviating: 0,
  });
  assert.deepStrictEqual(container.stream, {
    binSafeVersion: 2, declaredObjectCount: 10, events: 97, objects: 17, maxDepth: 4, endsAtHashTable: true,
  });
  assert.match(container.payloads.raw['zCVob/dataRaw'], /^sha256:/);
  assert.match(container.payloads.bool['zCWaypoint/underWater'], /^sha256:/);
  assert.strictEqual(container.meshAndBsp.bspVersion, 0x04090000);
  assert.strictEqual(container.meshAndBsp.size, 900);
  assert.deepStrictEqual(
    container.meshAndBsp.chunks.map((c) => c.id),
    ['0xb000', '0xb010', '0xb020', '0xb026', '0xb030', '0xb040', '0xb050', '0xb060',
      '0xc000', '0xc010', '0xc040', '0xc045', '0xc050', '0xc0ff']
  );
  assert.strictEqual(container.meshAndBsp.chunks[2].length, 357);
  assert.match(container.meshAndBsp.chunks[2].sha256, /^sha256:/);
  assert.strictEqual(container.meshAndBsp.trailing, '');
});
