'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

// The unpacked `zCVob` write path (`pack=int:0`, one entry per field) is the
// form ZenGin also writes and ZenKit's own reader still supports, but nothing
// in the library switches to it: `VirtualObject`'s `pack` flag is a file-static
// that only `enable_packed_save` writes and nothing called. Two defects had
// been sitting behind that unreachable branch — a writer/reader disagreement on
// the `trafoOSToWSRot` entry type, and three entries written twice — and this
// is the only thing that reaches them.
function authorBoth() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-unpacked-'));
  const packed = path.join(dir, 'packed.zen');
  const unpacked = path.join(dir, 'unpacked.zen');
  zenkit._authorFixtureWorld(packed, 'ascii', 'g2', 'minimal', true);
  zenkit._authorFixtureWorld(unpacked, 'ascii', 'g2', 'minimal', false);
  return { dir, packed, unpacked };
}

test('the unpacked zCVob writer emits ZenGin\'s entry forms, not ZenKit-only ones', () => {
  const { dir, packed, unpacked } = authorBoth();
  try {
    const text = fs.readFileSync(unpacked, 'latin1');

    // The switch actually took effect — otherwise everything below is vacuous.
    assert.match(text, /pack=int:0/);
    assert.doesNotMatch(text, /dataRaw=/);

    // A3: ZenGin writes `trafoOSToWSRot` as a `raw:` hex entry and
    // `ReadArchiveAscii::read_mat3x3` reads one; the writer emitted `rawFloat:`.
    assert.match(text, /trafoOSToWSRot=raw:[0-9a-f]{72}\r?\n/);
    assert.doesNotMatch(text, /trafoOSToWSRot=rawFloat:/);

    // A2: the unpacked branch writes presetName/vobName/visual and the common
    // tail wrote them a second time. ASCII entries are read positionally, so a
    // duplicate is a stream desync, not a harmless repeat.
    for (const entry of ['presetName', 'vobName', 'visual']) {
      const perVob = new RegExp(`^\\s*${entry}=string:`, 'gm');
      const packedCount = (fs.readFileSync(packed, 'latin1').match(perVob) || []).length;
      const unpackedCount = (text.match(perVob) || []).length;
      assert.strictEqual(
        unpackedCount,
        5,
        `${entry}: expected one per VOB, got ${unpackedCount} (packed writes ${packedCount})`
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unpacked ASCII world loads back to the same world as the packed one', () => {
  const { dir, packed, unpacked } = authorBoth();
  try {
    const a = zenkit.normalizeWorld(zenkit.loadWorld(packed, 'g2'));
    const b = zenkit.normalizeWorld(zenkit.loadWorld(unpacked, 'g2'));

    // The one field the two forms disagree on, and it is A6, not this patch:
    // the fixture's VOBs carry ZenKit's `physics_enabled = true` default, the
    // packed writer gates bit 6 on a `rigid_body` only save-games ever fill so
    // it writes false, and the unpacked form has no entry for the field at all
    // — ZenGin only stores it in the packed layout. Asserted rather than
    // stripped so that landing A6 has to come back through this test.
    assert.strictEqual(a.vobs[0].flags.physicsEnabled, false);
    assert.strictEqual(b.vobs[0].flags.physicsEnabled, true);
    const withoutPhysics = (dump) =>
      dump.vobs.map((v) => ({ ...v, flags: { ...v.flags, physicsEnabled: null } }));

    assert.deepStrictEqual(withoutPhysics(b), withoutPhysics(a));
    assert.deepStrictEqual(b.waynet, a.waynet);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The half of A2 that was reachable all along and is what the 20 retail ASCII
// worlds actually measure: `save` packed every VObject regardless of the form
// it was loaded in, and the packed layout has no room for most of the tail, so
// re-saving OldCamp turned 1277 `pack=int:0` VObjects into `pack=int:1` and
// lost 43.9% of the ASCII entries with them.
test('a re-save keeps each VOB in the layout it was loaded in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-unpacked-'));
  try {
    const source = path.join(dir, 'source.zen');
    const resaved = path.join(dir, 'resaved.zen');
    zenkit._authorFixtureWorld(source, 'ascii', 'g2', 'minimal', false);

    const handle = zenkit.loadWorld(source, 'g2');
    zenkit.saveWorld(handle, resaved, { allowNonBinSafe: true });

    const text = fs.readFileSync(resaved, 'latin1');
    assert.strictEqual((text.match(/pack=int:0/g) || []).length, 5);
    assert.doesNotMatch(text, /pack=int:1/);

    assert.deepStrictEqual(
      zenkit.normalizeWorld(zenkit.loadWorld(resaved, 'g2')).vobs,
      zenkit.normalizeWorld(zenkit.loadWorld(source, 'g2')).vobs
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an authored VOB still defaults to the packed layout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-unpacked-'));
  try {
    const at = path.join(dir, 'packed.zen');
    zenkit._authorFixtureWorld(at, 'ascii', 'g2', 'minimal');
    const text = fs.readFileSync(at, 'latin1');
    assert.strictEqual((text.match(/pack=int:1/g) || []).length, 5);
    assert.doesNotMatch(text, /pack=int:0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
