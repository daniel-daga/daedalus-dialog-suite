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
const { walkAscii } = require('../lib/container-ascii.js');

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

test('(d) a BOOL raw value 0xFFFFFFFF → 1 is semantic-drift naming the BOOL payload hash', () => {
  const result = classifyMutant((buf) => {
    const entry = events(buf).find((ev) => ev.kind === 'entry' && ev.entryName === 'locked');
    assert.strictEqual(entry.entryType, 'BOOL');
    // The fixture holds ZenGin's signed-bit-field `true` (patch 0017); the
    // mutant swaps in the naive `1`. Both read back as `true`.
    assert.strictEqual(buf.readUInt32LE(entry.payloadOffset), 0xffffffff);
    buf.writeUInt32LE(1, entry.payloadOffset);
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
  // The stamp is written at authoring time, so only its ZenGin shape is fixed.
  assert.match(container.header.date, /^\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}:\d{2}$/);
  assert.strictEqual(container.header.user, 'Daniel');
  assert.strictEqual(container.hashTable.count, 55);
  assert.deepStrictEqual(container.hashTable.keys[0], { key: 'childs0', index: 0, hash: 86 });
  assert.match(container.hashTable.physicalOrder, /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(container.frames.total, 18);
  assert.deepStrictEqual(container.frames.classes['zCVob'], { count: 1, versions: { 52224: 1 } });
  assert.match(container.frames.sequenceHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepStrictEqual(container.schemas['oCItem:zCVob'], {
    entries: [['pack', 'INTEGER'], ['dataRaw', 'RAW'], ['vobName', 'STRING'], ['itemInstance', 'STRING']],
    objects: 1,
    deviating: 0,
  });
  assert.deepStrictEqual(container.stream, {
    binSafeVersion: 2, declaredObjectCount: 11, events: 119, objects: 18, maxDepth: 4, endsAtHashTable: true,
  });
  assert.match(container.payloads.raw['zCVob/dataRaw'], /^sha256:/);
  assert.match(container.payloads.bool['zCWaypoint/underWater'], /^sha256:/);
  assert.strictEqual(container.meshAndBsp.bspVersion, 0x04090000);
  assert.strictEqual(container.meshAndBsp.size, 1162);
  assert.deepStrictEqual(
    container.meshAndBsp.chunks.map((c) => c.id),
    ['0xb000', '0xb010', '0xb020', '0xb026', '0xb030', '0xb040', '0xb050', '0xb060',
      '0xc000', '0xc010', '0xc040', '0xc045', '0xc050', '0xc0ff']
  );
  assert.strictEqual(container.meshAndBsp.chunks[2].length, 339);
  assert.match(container.meshAndBsp.chunks[2].sha256, /^sha256:/);
  assert.strictEqual(container.meshAndBsp.trailing, '');
});

// The BinSafe walker parses an entry stream that only `zCArchiverBinSafe`
// worlds have. Reading anything else used to throw out of `readHashTable`,
// which took `normalizeWorld` down with it. The instrument must instead say, in
// the dump, that it does not cover this archive: an uncovered container section
// is a coverage fact, never silent agreement. ASCII has its own walker
// (lib/container-ascii.js) and is covered; BINARY still has none.
test('containerFromBuffer reports an archive it has no walker for as uncovered instead of throwing', () => {
  withTmpDir((dir) => {
    const binary = path.join(dir, 'binary.zen');
    zenkit._authorFixtureWorld(binary, 'binary', 'g2');
    const container = containerFromBuffer(fs.readFileSync(binary));

    assert.strictEqual(container.covered, false);
    assert.strictEqual(container.archiver, 'zCArchiverGeneric');
    assert.strictEqual(container.format, 'BINARY');
    // The BINARY writer emits no date/user stamp at all — verbatim means verbatim.
    assert.deepStrictEqual(container.header.lines, [
      'ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'BINARY', 'saveGame 0', 'END',
    ]);
    // Nothing beyond the text header may be claimed.
    assert.deepStrictEqual(Object.keys(container).sort(), ['archiver', 'covered', 'format', 'header']);
  });
});

// Two dumps whose container sections are both uncovered agree on nothing — the
// instrument simply did not look. `identical` on such a pair is a claim about
// the struct dump ALONE, so the caller has to be able to tell the two apart.
test('classifyDumps reports whether the container instrument covered the pair', () => {
  const baseline = baselineDump();
  const covered = classifyDumps(baseline, JSON.parse(JSON.stringify(baseline)));
  assert.strictEqual(covered.classification, 'identical');
  assert.strictEqual(covered.containerCoverage, true);

  const uncovered = { ...baseline, container: { archiver: 'zCArchiverGeneric', format: 'BINARY', covered: false, header: { lines: [], date: '', user: '' } } };
  const result = classifyDumps(uncovered, JSON.parse(JSON.stringify(uncovered)));
  assert.strictEqual(result.classification, 'identical');
  assert.strictEqual(result.containerCoverage, false);
});

// ---------------------------------------------------------------------------
// ASCII (zCArchiverGeneric) — lib/container-ascii.js
//
// 24 of the 28 .zen files in a retail G2 install are ASCII, and the ASCII
// writer has four named defects (docs/engine-acceptance-2026-08-25.md §10.2).
// Until this walker existed the instrument answered `covered: false` for the
// very format under test, so a full fix of A1–A4 would have left the suite
// green and unchanged. These tests are the harness learning to see them.

function withAsciiFixture(fn) {
  return withTmpDir((dir) => {
    const at = path.join(dir, 'ascii.zen');
    zenkit._authorFixtureWorld(at, 'ascii', 'g2');
    return fn(fs.readFileSync(at), at);
  });
}

// The ASCII fixture cannot be loaded by ZenKit at all (that is itself a §10.2
// consequence), so there is no struct dump to pair it with. Both sides of the
// comparison therefore reuse the BinSafe fixture's struct sections and differ
// only in the `container` section — which is exactly the half under test.
function classifyAsciiPair(original, mutated) {
  const baseline = baselineDump();
  return classifyDumps(
    { ...baseline, container: containerFromBuffer(original) },
    { ...baseline, container: containerFromBuffer(mutated) }
  );
}

function asciiEvents(buf) {
  return [...walkAscii(buf)];
}

// The payload text of one (class, entryName) entry, from either walker. A path
// element is `objectName:class#index`.
function rawText(events, buf, cls, name) {
  const owner = (e) => {
    const p = e.path[e.path.length - 1];
    return p.slice(p.indexOf(':') + 1, p.lastIndexOf('#'));
  };
  const ev = events.find((e) => e.kind === 'entry' && e.entryName === name && owner(e) === cls);
  assert.ok(ev, `no ${cls}/${name} entry`);
  return buf.toString('latin1', ev.payloadOffset, ev.payloadOffset + ev.payloadLength);
}

test('walkAscii yields the archive events an ASCII world is built from', () => {
  withAsciiFixture((buf) => {
    const events = asciiEvents(buf);
    const header = events[0];
    assert.strictEqual(header.kind, 'header');
    assert.strictEqual(header.header.lines[2], 'zCArchiverGeneric');
    assert.strictEqual(header.header.lines[3], 'ASCII');
    assert.strictEqual(header.header.lines[7], 'END');

    const world = events[1];
    assert.strictEqual(world.kind, 'objectBegin');
    assert.deepStrictEqual(world.frame, { name: '%', cls: 'oCWorld:zCWorld', version: '64513', index: '0' });
    assert.strictEqual(world.objectDepth, 0);

    // The MeshAndBsp blob is raw binary embedded in an "ASCII" archive: it
    // contains 0x0a bytes and byte runs that read as archive framing, so a
    // line-oriented walker that did not special-case it by length would
    // desynchronise inside the mesh and never recover.
    const blob = events.find((ev) => ev.kind === 'rawBlob');
    assert.strictEqual(blob.entryName, 'MeshAndBsp');
    assert.strictEqual(blob.bspVersion, 0x04090000);
    assert.strictEqual(blob.size, 1162);
    assert.ok(buf.subarray(blob.fileOffset, blob.fileOffset + blob.size).includes(0x0a),
      'the blob must contain newlines, or this test proves nothing');

    const dataRaw = events.find((ev) => ev.kind === 'entry' && ev.entryName === 'dataRaw');
    assert.strictEqual(dataRaw.entryType, 'RAW');
    assert.strictEqual(buf.toString('latin1', dataRaw.payloadOffset - 4, dataRaw.payloadOffset), 'raw:');

    const eos = events[events.length - 1];
    assert.strictEqual(eos.kind, 'eos');
    assert.strictEqual(eos.objectDepth, 0);
    assert.strictEqual(eos.exact, true);
  });
});

test('containerFromBuffer covers an ASCII archive instead of reporting covered:false', () => {
  withAsciiFixture((buf) => {
    const container = containerFromBuffer(buf);
    assert.strictEqual(container.covered, true);
    assert.strictEqual(container.archiver, 'zCArchiverGeneric');
    assert.strictEqual(container.format, 'ASCII');
    assert.deepStrictEqual(container.header.lines, [
      'ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'ASCII', 'saveGame 0', 'date', 'user', 'END',
    ]);
    assert.match(container.header.date, /^\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}:\d{2}$/);

    // 19, not 18: the chest carries a zCDecal visual, which is a frame of its
    // own — the fixture's only `write_byte` field (patch 0026).
    assert.strictEqual(container.frames.total, 19);
    assert.deepStrictEqual(container.frames.classes['zCVob'], { count: 1, versions: { 52224: 1 } });
    assert.match(container.frames.sequenceHash, /^sha256:[0-9a-f]{64}$/);
    assert.deepStrictEqual(container.schemas['oCItem:zCVob'], {
      entries: [['pack', 'INTEGER'], ['dataRaw', 'RAW'], ['vobName', 'STRING'], ['itemInstance', 'STRING']],
      objects: 1,
      deviating: 0,
    });
    assert.strictEqual(container.stream.objects, 19);
    assert.strictEqual(container.stream.maxDepth, 4);
    assert.strictEqual(container.stream.balanced, true);
    assert.strictEqual(container.stream.indentExact, true);
    assert.match(container.payloads.raw['zCVob/dataRaw'], /^sha256:/);
    assert.match(container.payloads.bool['zCWaypoint/underWater'], /^sha256:/);
    assert.strictEqual(container.meshAndBsp.bspVersion, 0x04090000);
    assert.strictEqual(container.meshAndBsp.size, 1162);
    assert.deepStrictEqual(
      container.meshAndBsp.chunks.map((c) => c.id),
      ['0xb000', '0xb010', '0xb020', '0xb026', '0xb030', '0xb040', '0xb050', '0xb060',
        '0xc000', '0xc010', '0xc040', '0xc045', '0xc050', '0xc0ff']
    );
    assert.strictEqual(container.meshAndBsp.trailing, '');
  });
});

// A4, fixed (patch 0025) — the top-level `objects` field is padded to the 9
// characters ZenGin writes (`objects 1835     ` in retail OldCamp.zen), not 11.
// The field is a container fact and nothing in the parsed structs can see it,
// so the walker keeps the line verbatim and this is the only place the width
// can be asserted at all. `declared` is the count, and is unrelated.
test('the ASCII `objects` field is padded to the 9 characters ZenGin writes', () => {
  withAsciiFixture((buf) => {
    const container = containerFromBuffer(buf);
    assert.strictEqual(container.objects.declared, 12);
    assert.strictEqual(container.objects.line, `objects ${'12'.padEnd(9)}`);
  });
});

// A1, fixed (patch 0024) — `WriteArchiveAscii::write_raw` used to read a hex
// digit `std::to_chars` never wrote, so every byte below 0x10 carried the
// PREVIOUS byte's low nibble as its second digit — 49 of these 83 bytes. The
// BinSafe fixture is the same world through the same packer, so its `dataRaw`
// payload is exactly the byte string the ASCII hex must decode to: a
// zero-tolerance assertion, and the one that catches the defect coming back.
test('every ASCII raw entry decodes to the bytes the packer produced', () => {
  withAsciiFixture((buf) => {
    const binSafe = fs.readFileSync(FIXTURE);
    const expected = Buffer.from(rawText([...walk(binSafe)], binSafe, 'oCItem:zCVob', 'dataRaw'), 'latin1');
    const actual = Buffer.from(rawText(asciiEvents(buf), buf, 'oCItem:zCVob', 'dataRaw'), 'hex');

    assert.strictEqual(actual.length, expected.length, 'the packed struct must be the same length either way');
    // The bytes A1 corrupted are the sub-0x10 ones, and this entry has 49 of
    // them — an equality that would otherwise hold vacuously.
    assert.ok(expected.filter((v) => v < 0x10).length >= 40, 'the fixture must still exercise sub-0x10 bytes');
    assert.deepStrictEqual(actual, expected);
  });
});

// A5, fixed (patch 0026) — `WriteArchiveAscii` spelled a byte `byte:` and a word
// `word:`, tokens its own reader rejects (`read_entry("int")`) and ZenGin never
// writes: 144,111 `int:` entries across the 24 ASCII worlds of a retail Gothic II
// install, and zero of either. The chest's `decalAlphaWeight` is the fixture's
// only field on that path, and the whole reason it is there.
test('an ASCII byte field is written with the `int` token ZenGin and the reader use', () => {
  withAsciiFixture((buf) => {
    const text = buf.toString('latin1');
    assert.match(text, /decalAlphaWeight=int:200/);
    // Not just this field: neither token belongs in a ZenGin ASCII archive.
    assert.ok(!/=byte:/.test(text), 'no entry may carry a `byte:` type token');
    assert.ok(!/=word:/.test(text), 'no entry may carry a `word:` type token');
  });
});

// The instrument has to FAIL on a changed ASCII archive, not merely describe
// one. Each mutation below is invisible to a struct dump and must classify as
// semantic-drift naming its own container sub-key.
test('a flipped hex digit in an ASCII raw entry is semantic-drift naming the payload hash', () => {
  withAsciiFixture((buf) => {
    const mutant = Buffer.from(buf);
    const ev = asciiEvents(buf).find((e) => e.kind === 'entry' && e.entryName === 'dataRaw');
    mutant[ev.payloadOffset + 1] = mutant[ev.payloadOffset + 1] === 0x31 ? 0x32 : 0x31;
    assertDriftAt(classifyAsciiPair(buf, mutant), /^container\.payloads\.raw\..*\/dataRaw$/);
  });
});

test('an ASCII entry whose type token changed is semantic-drift naming the schema', () => {
  withAsciiFixture((buf) => {
    // A3's exact shape: `rawFloat:` where the reader — and ZenGin — writes `raw:`.
    const at = buf.indexOf('=raw:', 0, 'latin1');
    assert.ok(at > 0);
    const mutant = Buffer.concat([
      buf.subarray(0, at), Buffer.from('=rawFloat:', 'latin1'), buf.subarray(at + '=raw:'.length),
    ]);
    assertDriftAt(classifyAsciiPair(buf, mutant), /^container\.schemas\./);
  });
});

test('a re-padded ASCII `objects` field is semantic-drift naming the objects line', () => {
  withAsciiFixture((buf) => {
    const at = buf.indexOf('objects ', 0, 'latin1');
    const mutant = Buffer.concat([
      buf.subarray(0, at), Buffer.from(`objects ${'12'.padEnd(11)}`, 'latin1'),
      buf.subarray(at + `objects ${'12'.padEnd(9)}`.length),
    ]);
    assertDriftAt(classifyAsciiPair(buf, mutant), /^container\.objects\.line$/);
  });
});

test('a changed byte inside an ASCII MeshAndBsp blob is semantic-drift naming the chunk', () => {
  withAsciiFixture((buf) => {
    const mutant = Buffer.from(buf);
    const at = mutant.indexOf('MINIMAL_FIXTURE', 0, 'latin1');
    assert.ok(at > 0);
    mutant.write('MINIMAL_FIXTURF', at, 'latin1');
    assertDriftAt(classifyAsciiPair(buf, mutant), /^container\.meshAndBsp\.chunks\[0\]\./);
  });
});

test('classifyDumps reports containerCoverage true for a pair of ASCII archives', () => {
  withAsciiFixture((buf) => {
    const result = classifyAsciiPair(buf, buf);
    assert.strictEqual(result.classification, 'identical');
    assert.deepStrictEqual(result.findings, []);
    assert.strictEqual(result.containerCoverage, true);
  });
});
