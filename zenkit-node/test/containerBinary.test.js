'use strict';

// The third archive format's container walker (#227; level-editor.md §14.3 3.1).
//
// BINARY was the one format the instrument could not look inside, so every
// BINARY round trip reported `struct-only` — and the harness's own rule is that
// a struct-only row is never a fidelity pass. What makes it hard is the format:
// a BINARY entry carries no name, no type tag and no length, so an entry is
// bare bytes and there is nothing in the stream that tells an entry apart from
// the four bytes of a child object's size. Only object *frames* are
// recoverable, and only by scanning for them and then proving the scan.
//
// The proof is what these tests are about. The archive declares its own object
// count in `objects N`, the frames must nest laminarly, and the outermost must
// span exactly to EOF — so a walk that invented a frame, or missed one, says so
// rather than reporting a section that happens to match on both sides.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');
const { classifyDumps } = require('../lib/classify.js');
const { containerFromBuffer } = require('../lib/container.js');
const { walkBinary, readBinaryHeader } = require('../lib/container-binary.js');
const { byteDiff, walkerFor } = require('../lib/container-diff.js');

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-node-container-binary-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The one BINARY input that exists on any machine: the fixture author writes
 *  it, because no retail `.zen` is BINARY and `saveWorld` cannot convert one. */
function authored() {
  return withTmpDir((dir) => {
    const file = path.join(dir, 'binary.zen');
    zenkit._authorFixtureWorld(file, 'binary', 'g2');
    return fs.readFileSync(file);
  });
}

const BINARY = authored();

test('the binary header carries the object count the archive declares', () => {
  const header = readBinaryHeader(BINARY);

  assert.deepStrictEqual(header.lines, [
    'ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'BINARY', 'saveGame 0', 'END',
  ]);
  // ZenGin pads the count to a nine-character field and ZenKit matches it, so
  // the padding is a container fact: a writer that stopped padding would move
  // every byte after it.
  assert.strictEqual(header.objectsField, 'objects 12       ');
  assert.strictEqual(header.declaredObjects, 12);
  // `END\n` then a blank line, which `write_line("END\n")` produces — the first
  // object frame starts after it.
  assert.strictEqual(BINARY.readUInt32LE(header.entryStart) + header.entryStart, BINARY.length);
});

test('walkBinary recovers every object frame, and proves it against the declared count', () => {
  const events = [...walkBinary(BINARY)];
  const head = events[0];
  assert.strictEqual(head.kind, 'header');

  const begins = events.filter((e) => e.kind === 'objectBegin');
  const ends = events.filter((e) => e.kind === 'objectEnd');
  assert.strictEqual(begins.length, ends.length);

  // `write_object_begin` hands out an index only for a real class name, so the
  // declared count is the frames that are neither a reference (`§`) nor the
  // class-less `%` wrappers the world uses for its sections.
  const counted = begins.filter((e) => e.frame.cls !== '' && e.frame.cls !== '§');
  assert.strictEqual(counted.length, head.header.declaredObjects);

  const classes = counted.map((e) => e.frame.cls);
  assert.ok(classes.includes('oCWorld:zCWorld'), classes.join(', '));
  assert.ok(classes.includes('oCMobContainer:oCMobInter:oCMOB:zCVob'), classes.join(', '));
  assert.strictEqual(classes.filter((c) => c === 'zCWaypoint').length, 4);

  // A reference frame is a frame — it has a size and a name and occupies bytes
  // — and it names the index it points back at rather than a class.
  const refs = begins.filter((e) => e.frame.cls === '§');
  assert.ok(refs.length > 0, 'the fixture waynet writes its right-hand edges as references');

  const eos = events[events.length - 1];
  assert.strictEqual(eos.kind, 'eos');
  assert.strictEqual(eos.exact, true);
});

test('the mesh blob is a raw region, not a place to look for frames', () => {
  // Exactly as the BinSafe walker treats it: `MeshAndBsp` carries a whole
  // nested archive with its own object counter, so scanning into it would find
  // frames the outer `objects N` does not count and break the proof.
  const events = [...walkBinary(BINARY)];
  const blob = events.find((e) => e.kind === 'rawBlob');

  assert.ok(blob, 'the fixture world has a MeshAndBsp section');
  assert.strictEqual(blob.entryName, 'MeshAndBsp');
  assert.strictEqual(blob.bspVersion, 0x04090000);
  assert.ok(blob.size > 0);

  const inside = events.filter(
    (e) => e.kind === 'objectBegin' && e.fileOffset > blob.fileOffset
      && e.fileOffset < blob.fileOffset + blob.size,
  );
  assert.deepStrictEqual(inside, []);
});

test('the container section is covered for BINARY, and says what the format cannot', () => {
  const section = containerFromBuffer(BINARY);

  assert.strictEqual(section.format, 'BINARY');
  assert.strictEqual(section.covered, true);
  assert.strictEqual(section.stream.declaredObjectCount, 12);
  assert.strictEqual(section.stream.objects, section.frames.total);
  assert.ok(section.stream.maxDepth >= 2);
  assert.strictEqual(typeof section.frames.sequenceHash, 'string');
  assert.ok(section.frames.classes['oCWorld:zCWorld']);

  // The honest hole, stated rather than left to be inferred: a BINARY entry has
  // no name and no type, so the per-entry sections the other two formats carry
  // cannot exist here. `payloads` digests each object's own bytes instead,
  // which is the finest grain this format admits.
  assert.strictEqual(section.schemas, undefined);
  assert.deepStrictEqual(section.entryNames, false);
  assert.ok(Object.keys(section.payloads.objects).length > 0);
});

test('a BINARY pair gets an event-aligned diff, not a whole-file verdict', () => {
  // What the missing walker actually cost: `walkerFor` returned null, so every
  // BINARY comparison fell back to "nothing looked inside these bytes".
  assert.ok(walkerFor(BINARY));

  const same = byteDiff(BINARY, Buffer.from(BINARY));
  assert.strictEqual(same.kind, 'event-aligned');
  assert.strictEqual(same.aligned, true);
  // Only with gap 0 does "the rest is identical" mean anything.
  assert.strictEqual(same.coverage.gap, 0);
  assert.strictEqual(same.differing.length, 0);
});

test('a changed byte inside an object is named by the object it is in', () => {
  const events = [...walkBinary(BINARY)];
  const item = events.find((e) => e.kind === 'objectBegin' && e.frame.cls === 'oCItem:zCVob');
  assert.ok(item, 'the fixture places an item');

  // One byte of the item's own payload, past its frame header.
  const mutant = Buffer.from(BINARY);
  const at = item.bodyStart + 4;
  mutant[at] = mutant[at] ^ 0xff;

  const diff = byteDiff(BINARY, mutant);
  assert.strictEqual(diff.kind, 'event-aligned');
  assert.strictEqual(diff.aligned, true);
  assert.strictEqual(diff.differing.length, 1);
  assert.match(diff.differing[0].key, /oCItem/);
});

test('a BINARY round trip is a fidelity pass now, not a struct-only row', () => {
  // What the missing walker cost, at the level the harness reports. The round
  // trip itself was always clean; nothing had ever looked inside the bytes to
  // say so, and the harness's own rule is that a struct-only row is never a
  // fidelity pass. `allowNonBinSafe` is the diagnostic override `saveWorld`
  // keeps for exactly this: the BINARY writer path is still unverified against
  // an engine, and measuring it is not shipping it.
  withTmpDir((dir) => {
    const original = path.join(dir, 'original.zen');
    const resaved = path.join(dir, 'resaved.zen');
    zenkit._authorFixtureWorld(original, 'binary', 'g2');
    zenkit.saveWorld(zenkit.loadWorld(original, 'g2'), resaved, { allowNonBinSafe: true });

    const result = classifyDumps(
      zenkit.normalizeWorld(zenkit.loadWorld(original, 'g2')),
      zenkit.normalizeWorld(zenkit.loadWorld(resaved, 'g2')),
    );
    assert.strictEqual(result.classification, 'identical');
    assert.strictEqual(result.containerCoverage, true);

    const diff = byteDiff(fs.readFileSync(original), fs.readFileSync(resaved));
    assert.strictEqual(diff.kind, 'event-aligned');
    assert.strictEqual(diff.coverage.gap, 0);
    assert.deepStrictEqual(diff.differing, []);
  });
});

test('a walk that cannot prove itself reports no coverage rather than a section', () => {
  // The whole point of the count check. Raising the declared count by one makes
  // the recovered frames disagree with the archive's own claim, and a section
  // built on a walk that cannot be proved is worse than none: it would compare
  // equal to another unproved walk and read as a fidelity pass.
  const mutant = Buffer.from(BINARY);
  const header = readBinaryHeader(BINARY);
  mutant.write('objects 13       ', header.objectsFieldOffset, 'latin1');

  const section = containerFromBuffer(mutant);
  assert.strictEqual(section.format, 'BINARY');
  assert.strictEqual(section.covered, false);
  assert.match(section.reason, /declare/i);
});
