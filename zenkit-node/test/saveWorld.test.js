'use strict';

// T6 — saveWorld: the C2 regression claim (docs/plans/level-editor-phase-0.md §6).
// load(fixture) → save must reproduce the fixture bytes, modulo the archive
// headers' `date `/`user ` stamp lines, which the writer stamps fresh.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');
const { walk } = require('../lib/container.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');
const GOLDEN = path.join(__dirname, 'fixtures', 'minimal.g2.golden.json');

// Blank the variable `date `/`user ` lines inside every ZenGin archive header
// (a world contains nested archives — e.g. the MeshAndBsp chunk carries its
// own header — so all header blocks are normalized, not just the first).
// Both buffers get the same treatment, so the comparison still proves the
// non-header remainder is byte-identical.
// The BinSafe header's `hashTableOffset` counts RAW bytes from the start of the
// file, so it shifts with the length of the `user ` stamp — i.e. with the
// machine's username. Blanking the stamp TEXT therefore still leaves a derived
// field that differs, and this test was silently machine-dependent: the fixture
// was authored by a 6-character user (`Daniel`), it passed on ubuntu/macOS CI
// whose runner is also 6 characters (`runner`), and it failed on Windows CI's
// `runneradmin` by exactly 5 bytes — 0x0B48 vs 0x0B4D.
//
// Zeroing it costs no coverage: that the entry stream ends exactly at the hash
// table is asserted by the container instrument (`endsAtHashTable`), and every
// test below that walks the table reaches it through this same offset in the
// un-normalized bytes.
function zeroHashTableOffset(buffer) {
  if (!buffer.toString('latin1', 0, 64).includes('BIN_SAFE')) return buffer;
  const headerEnd = buffer.indexOf('END\n', 0, 'latin1');
  if (headerEnd < 0) return buffer;
  const out = Buffer.from(buffer);
  out.writeUInt32LE(0, headerEnd + 4 + 8); // after END\n: version, objectCount, hashTableOffset
  return out;
}

function normalizeHeaderStamps(buffer) {
  const latin1 = buffer.toString('latin1');
  const header =
    /(ZenGin Archive\nver 1\n[^\n]*\n[^\n]*\nsaveGame \d+\n)date [^\n]*\nuser [^\n]*\n(END\n)/g;
  return zeroHashTableOffset(Buffer.from(latin1.replace(header, '$1date\nuser\n$2'), 'latin1'));
}

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-node-save-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Reproduces the CI failure locally: the same world written on a machine whose
// username is 5 characters longer is byte-identical apart from the `user` stamp
// and the hashTableOffset that shifts with it. Without zeroHashTableOffset this
// fails on the offset alone, which is what Windows CI hit and what ubuntu/macOS
// missed because their runner name happens to be the same length as the
// fixture author's.
test('normalizeHeaderStamps is invariant to the length of the user stamp', () => {
  const original = fs.readFileSync(FIXTURE);
  const latin1 = original.toString('latin1');
  const userLine = /\nuser ([^\n]*)\n/.exec(latin1);
  assert.ok(userLine, 'fixture must carry a user stamp');

  const longer = `${userLine[1]}XXXXX`; // +5, exactly the runneradmin delta
  const shifted = Buffer.from(
    latin1.replace(`\nuser ${userLine[1]}\n`, `\nuser ${longer}\n`),
    'latin1'
  );
  // A real writer would also bump the offset, since it counts raw bytes.
  const headerEnd = shifted.indexOf('END\n', 0, 'latin1');
  shifted.writeUInt32LE(shifted.readUInt32LE(headerEnd + 12) + 5, headerEnd + 12);

  assert.strictEqual(shifted.length, original.length + 5);
  assert.deepStrictEqual(normalizeHeaderStamps(shifted), normalizeHeaderStamps(original));
});

test('saveWorld reproduces the fixture bytes except the header date/user stamps', () => {
  withTmpDir((dir) => {
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(FIXTURE, 'g2'), out);

    const original = normalizeHeaderStamps(fs.readFileSync(FIXTURE));
    const resaved = normalizeHeaderStamps(fs.readFileSync(out));
    assert.deepStrictEqual(resaved, original);
  });
});

// This is the SEMANTIC half of the C2 claim. The `container` section is
// byte-level by design (it sees the writer's header stamps and the fixture's
// pre-patch `childs<N>` numbering — see the byte test above), so it is set
// aside here rather than compared against the golden.
test('saveWorld output re-loads and normalizes to the golden dump', () => {
  withTmpDir((dir) => {
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(FIXTURE, 'g2'), out);

    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    const resaved = zenkit.normalizeWorld(zenkit.loadWorld(out, 'g2'));
    delete golden.container;
    delete resaved.container;
    assert.deepStrictEqual(resaved, golden);
  });
});

// The BinSafe archiver is name-addressed: every entry carries a hash-table index
// of its name, and the engine reads properties back by name. The original ZenGin
// numbers the VOB child-count entries with one global running counter in write
// order — `childs0` for the VobTree-level count, then `childs1`, `childs2`, ...
// depth-first, one per VOB — so a world with V VOBs holds exactly the key set
// {childs0 .. childsV}. Verified against the retail NewWorld/OldWorld/AddonWorld
// worlds, whose hash tables carry V+1 distinct, gap-free `childs<N>` keys.
function binSafeHashTableKeys(buffer) {
  let pos = 0;
  for (;;) {
    const nl = buffer.indexOf(0x0a, pos);
    const line = buffer.toString('latin1', pos, nl).replace(/\r$/, '');
    pos = nl + 1;
    if (line === 'END') break;
  }
  let p = buffer.readUInt32LE(pos + 8); // hash table offset
  const count = buffer.readUInt32LE(p);
  p += 4;
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    const keyLength = buffer.readUInt16LE(p);
    keys.push(buffer.toString('latin1', p + 8, p + 8 + keyLength));
    p += 8 + keyLength;
  }
  return keys;
}

test('saveWorld numbers childs<N> entries with one gap-free global counter', () => {
  withTmpDir((dir) => {
    const out = path.join(dir, 'resaved.zen');
    const handle = zenkit.loadWorld(FIXTURE, 'g2');
    zenkit.saveWorld(handle, out);

    const vobCount = zenkit.normalizeWorld(handle).vobs.length;
    const childs = binSafeHashTableKeys(fs.readFileSync(out))
      .filter((key) => /^childs\d+$/.test(key))
      .map((key) => Number(key.slice('childs'.length)))
      .sort((a, b) => a - b);

    const expected = Array.from({ length: vobCount + 1 }, (_, i) => i);
    assert.deepStrictEqual(childs, expected);
  });
});

test('saveWorld throws a JS Error for an unwritable destination', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  const bad = path.join(__dirname, 'no-such-directory', 'nested', 'out.zen');
  assert.throws(() => zenkit.saveWorld(handle, bad), Error);
});

test('saveWorld leaves no temp file behind on failure', () => {
  withTmpDir((dir) => {
    const handle = zenkit.loadWorld(FIXTURE, 'g2');
    const bad = path.join(dir, 'missing', 'out.zen');
    assert.throws(() => zenkit.saveWorld(handle, bad), Error);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});

// ---------------------------------------------------------------------------
// Byte-fidelity tests for the ZenKit writer patches 0010-0018 (patches/). Each
// one inspects the saved bytes directly, the way ZenGin's own reader would.

// Physical hash-table rows in file order: { keyLength, insertionIndex, hash, key }.
function binSafeHashTableRows(buffer) {
  let pos = 0;
  for (;;) {
    const nl = buffer.indexOf(0x0a, pos);
    const line = buffer.toString('latin1', pos, nl).replace(/\r$/, '');
    pos = nl + 1;
    if (line === 'END') break;
  }
  let p = buffer.readUInt32LE(pos + 8);
  const count = buffer.readUInt32LE(p);
  p += 4;
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const keyLength = buffer.readUInt16LE(p);
    rows.push({
      keyLength,
      insertionIndex: buffer.readUInt16LE(p + 2),
      hash: buffer.readUInt32LE(p + 4),
      key: buffer.toString('latin1', p + 8, p + 8 + keyLength),
    });
    p += 8 + keyLength;
  }
  return rows;
}

// Every BinSafe entry named `key` with the given type byte: the payload bytes
// following the fixed-size entry head (0x12, name index u32, type u8).
function binSafeEntries(buffer, key, type, fixedSize) {
  const row = binSafeHashTableRows(buffer).find((r) => r.key === key);
  assert.ok(row, `hash table has no key ${key}`);
  const head = Buffer.alloc(6);
  head[0] = 0x12;
  head.writeUInt32LE(row.insertionIndex, 1);
  head[5] = type;
  const found = [];
  for (let at = buffer.indexOf(head); at >= 0; at = buffer.indexOf(head, at + 1)) {
    if (fixedSize !== undefined) {
      found.push(buffer.subarray(at + 6, at + 6 + fixedSize));
    } else {
      const size = buffer.readUInt16LE(at + 6);
      found.push(buffer.subarray(at + 8, at + 8 + size));
    }
  }
  return found;
}

// The MeshAndBsp blob's chunk table: Map<chunkId, payload>.
function meshChunks(buffer) {
  const marker = '[MeshAndBsp % 0 0]';
  const at = buffer.indexOf(marker, 0, 'latin1');
  assert.ok(at >= 0, 'no MeshAndBsp object');
  let p = at + marker.length + 4; // skip the bsp version
  const end = p + 4 + buffer.readUInt32LE(p);
  p += 4;
  const chunks = new Map();
  while (p + 6 <= end) {
    const id = buffer.readUInt16LE(p);
    const len = buffer.readUInt32LE(p + 2);
    chunks.set(id, buffer.subarray(p + 6, p + 6 + len));
    p += 6 + len;
  }
  assert.strictEqual(p, end, 'MeshAndBsp chunk walk must end exactly at the declared size');
  return chunks;
}

function withAuthoredFixture(fn) {
  withTmpDir((dir) => {
    const authored = path.join(dir, 'authored.zen');
    zenkit._authorFixtureWorld(authored, 'binsafe', 'g2');
    const resaved = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(authored, 'g2'), resaved);
    fn(fs.readFileSync(authored), fs.readFileSync(resaved));
  });
}

test('saveWorld is deterministic: two saves of one world are byte-identical', () => {
  withTmpDir((dir) => {
    const handle = zenkit.loadWorld(FIXTURE, 'g2');
    const a = path.join(dir, 'a.zen');
    const b = path.join(dir, 'b.zen');
    zenkit.saveWorld(handle, a);
    zenkit.saveWorld(handle, b);
    assert.deepStrictEqual(normalizeHeaderStamps(fs.readFileSync(b)), normalizeHeaderStamps(fs.readFileSync(a)));
  });
});

test('saveWorld writes the BinSafe hash table in ascending-hash, descending-index order', () => {
  withTmpDir((dir) => {
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(FIXTURE, 'g2'), out);
    const rows = binSafeHashTableRows(fs.readFileSync(out));

    let sameHashNeighbours = 0;
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const cur = rows[i];
      assert.ok(prev.hash <= cur.hash, `row ${i}: hash ${cur.hash} after ${prev.hash}`);
      if (prev.hash === cur.hash) {
        sameHashNeighbours += 1;
        assert.ok(prev.insertionIndex > cur.insertionIndex,
          `row ${i}: index ${cur.insertionIndex} after ${prev.insertionIndex} in bucket ${cur.hash}`);
      }
    }
    // ZenGin's hash has only 97 buckets, so a world's key set always collides;
    // make sure the tie rule was actually exercised.
    assert.ok(sameHashNeighbours > 0, 'expected at least one hash collision in the table');
  });
});

test('saveWorld stamps the header date in ZenGin shape (d.m.yyyy hh:mm:ss)', () => {
  withTmpDir((dir) => {
    const before = new Date();
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(FIXTURE, 'g2'), out);
    const after = new Date();

    const header = fs.readFileSync(out).toString('latin1', 0, 256);
    const match = header.match(/\ndate ([^\n]*)\n/);
    assert.ok(match, 'header has a date line');
    assert.match(match[1], /^\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}:\d{2}$/);
    const day = (d) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
    assert.ok([day(before), day(after)].includes(match[1].split(' ')[0]), `unexpected date ${match[1]}`);
  });
});

test('saveWorld writes oCMobContainer.locked=true as the BOOL raw value 0xFFFFFFFF', () => {
  withTmpDir((dir) => {
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(FIXTURE, 'g2'), out);
    const values = binSafeEntries(fs.readFileSync(out), 'locked', 0x06, 4).map((b) => b.readUInt32LE(0));
    assert.deepStrictEqual(values, [0xffffffff]);
  });
});

// `colorAniList` is ONE string of ASCII colour tokens, and ZenGin writes an
// element whose channels are equal as a bare greyscale scalar (`255 `) rather
// than a triple. Measured over the three retail G2 worlds: of the 5,240 tokens
// in their 1,111 `colorAniList` strings, 26 are written short (8 NewWorld,
// 2 OldWorld, 16 AddonWorld) and not one of the 5,214 triples has r == g == b —
// so "short iff r == g == b" re-emits all 1,111 strings byte-for-byte, and those
// 26 tokens are exactly the residual the retail byte-diff still reported.
test('saveWorld writes a colorAniList colour with r == g == b as a greyscale scalar', () => {
  withTmpDir((dir) => {
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(FIXTURE, 'g2'), out);
    const values = binSafeEntries(fs.readFileSync(out), 'colorAniList', 0x01)
      .map((payload) => payload.toString('latin1'));
    assert.deepStrictEqual(values, ['255 (10 20 30) 64 ']);
  });
});

test('saveWorld writes the nested material-list archive header like ZenGin', () => {
  withTmpDir((dir) => {
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(FIXTURE, 'g2'), out);
    const matlist = meshChunks(fs.readFileSync(out)).get(0xb020).toString('latin1');
    const materialCount = zenkit.normalizeWorld(zenkit.loadWorld(FIXTURE, 'g2')).mesh.materials.length;
    const objects = `objects ${materialCount}`.padEnd('objects '.length + 9, ' ');
    assert.ok(matlist.startsWith(
      `ZenGin Archive\nver 1\nzCArchiverGeneric\nBINARY\nsaveGame 0\nEND\n${objects}\nEND\n\n`),
    JSON.stringify(matlist.slice(0, 96)));
  });
});

test('saveWorld appends the G2 alpha-test byte after the last material object', () => {
  withAuthoredFixture((authored, resaved) => {
    for (const buffer of [authored, resaved]) {
      const matlist = meshChunks(buffer).get(0xb020);
      const text = matlist.toString('latin1');
      const body = matlist.subarray(text.indexOf('END\n', text.indexOf('END\n') + 4) + 5);
      const count = body.readUInt32LE(0);
      let p = 4;
      for (let i = 0; i < count; i += 1) {
        p = body.indexOf(0, p) + 1; // material name
        p += body.readUInt32LE(p); // object record (self-sized)
      }
      assert.strictEqual(body.length, p + 1, 'exactly one byte follows the last material');
      assert.strictEqual(body[p], 1);
    }
  });
});

test('saveWorld preserves the mesh date pad word and the BSP header version', () => {
  withAuthoredFixture((authored, resaved) => {
    for (const buffer of [authored, resaved]) {
      const chunks = meshChunks(buffer);
      const marker = chunks.get(0xb000);
      // version u16, then the 16-byte date whose last word is the pad.
      assert.strictEqual(marker.readUInt16LE(2 + 14), 0x4a01);
      assert.strictEqual(chunks.get(0xc000).readUInt16LE(0), 3);
    }
  });
});

test('saveWorld lists shared light-map textures in first-reference order', () => {
  withAuthoredFixture((authored, resaved) => {
    for (const buffer of [authored, resaved]) {
      const chunk = meshChunks(buffer).get(0xb026);
      const textureCount = chunk.readUInt32LE(0);
      assert.strictEqual(textureCount, 3);
      let p = 4;
      const firstPixelBytes = [];
      for (let i = 0; i < textureCount; i += 1) {
        assert.strictEqual(chunk.toString('latin1', p, p + 4), 'ZTEX');
        p += 4 + 8 * 4; // signature + version, format, w, h, mipmaps, refw, refh, avg colour
        firstPixelBytes.push(chunk[p]);
        p += 4; // one 1x1 RGBA8 mipmap
      }
      const lightmapCount = chunk.readUInt32LE(p);
      p += 4;
      const indices = [];
      for (let i = 0; i < lightmapCount; i += 1) {
        indices.push(chunk.readUInt32LE(p + 9 * 4));
        p += 9 * 4 + 4;
      }
      assert.strictEqual(p, chunk.length);
      // Fixture: textures A, B, C referenced by light-maps in the order A, B, A, C.
      assert.deepStrictEqual(indices, [0, 1, 0, 2]);
      assert.deepStrictEqual(firstPixelBytes, [0x10, 0x20, 0x30]);
    }
  });
});

test('saveWorld round-trips bit 15 of the packed zCVob flag word', () => {
  withAuthoredFixture((authored, resaved) => {
    const payloads = (buffer) => binSafeEntries(buffer, 'dataRaw', 0x09);
    const a = payloads(authored);
    const b = payloads(resaved);
    assert.ok(a.length >= 4, `expected the fixture's vobs, got ${a.length} dataRaw entries`);
    assert.strictEqual(a.filter((raw) => raw.length === 83 && (raw[74] & 0x80) !== 0).length, 1);
    assert.deepStrictEqual(b, a);
  });
});

// ---------------------------------------------------------------------------
// The non-BinSafe guard (docs/engine-acceptance-2026-08-25.md §10.2, §10.3).
//
// Only the BinSafe writer path is verified — against the retail corpus and
// against the original engine. The ASCII writer corrupts every raw entry it
// emits and ZenKit cannot re-load its own ASCII output at all, and the BINARY
// path has had no fidelity work either. A save that silently produces a file
// nothing can re-open is worse than no save, so saveWorld refuses.
//
// The guard is exercised on a BINARY world because an ASCII one still cannot
// reach it: loading ZenKit's own ASCII output fails, so an ASCII handle cannot
// be produced in-process. It now fails by *throwing* — it used to abort the
// whole process, which is a defect in this addon's build rather than in the
// ASCII writer (see the `_HAS_EXCEPTIONS` note in binding.gyp), and the abort
// was load-bearing for this comment but never for the guard. Both formats go
// through the same `format != BINSAFE` check.
function withBinaryWorld(fn) {
  withTmpDir((dir) => {
    const authored = path.join(dir, 'authored.zen');
    zenkit._authorFixtureWorld(authored, 'binary', 'g2');
    fn(zenkit.loadWorld(authored, 'g2'), dir);
  });
}

test('saveWorld refuses a world that was not loaded from a BinSafe archive', () => {
  withBinaryWorld((handle, dir) => {
    const out = path.join(dir, 'out.zen');
    assert.throws(() => zenkit.saveWorld(handle, out), /binsafe|BinSafe/);
    assert.strictEqual(fs.existsSync(out), false);
  });
});

// The diagnostic harness (scripts/zen-roundtrip.js) measures the unverified
// paths on purpose — that is how §10.2's four ASCII defects were found — so
// the refusal is overridable, explicitly and per call.
test('saveWorld saves a non-BinSafe world when explicitly allowed', () => {
  withBinaryWorld((handle, dir) => {
    const out = path.join(dir, 'out.zen');
    zenkit.saveWorld(handle, out, { allowNonBinSafe: true });
    assert.ok(fs.statSync(out).size > 0);
  });
});

// Patch 0044. `VTrigger::load` unpacks bits 0 and 2 of `flags` and bits 0-5 of
// `filterFlags` into bools; 0028 made `save` rebuild both bytes from those
// bools, which drops every bit with no bool behind it — bits 1 and 3-7 of
// `flags`. Retail carries them (the four bytes sampled in OldWorld are
// 0b00010010, bits 1 and 4), which is why the four retail BinSafe worlds went
// from `identical` to `semantic-drift` on the `flags` field alone
// (docs/plans/level-editor.md §16.13). Seeding the unmapped bits into an
// authored world and re-saving must give every flag byte back unchanged.
test('saveWorld preserves the trigger flag bits load() never unpacks', () => {
  const UNMAPPED = { flags: 0b11111010, filterFlags: 0b11000000 };

  // In walk order, so the seeded file and the re-saved file line up positionally.
  const flagBytes = (buffer) =>
    [...walk(buffer)]
      .filter((ev) => ev.kind === 'entry' && ev.entryName in UNMAPPED)
      .map((ev) => ({ name: ev.entryName, offset: ev.payloadOffset, byte: buffer.readUInt8(ev.payloadOffset) }));

  withTmpDir((dir) => {
    const authored = path.join(dir, 'authored.zen');
    zenkit._authorFixtureWorld(authored, 'binsafe', 'g2', 'mesh-extraction');

    const seeded = Buffer.from(fs.readFileSync(authored));
    const found = flagBytes(seeded);
    assert.ok(found.length >= 4, `expected trigger flag bytes in the fixture, found ${found.length}`);
    for (const entry of found) seeded.writeUInt8(entry.byte | UNMAPPED[entry.name], entry.offset);

    const seededFile = path.join(dir, 'seeded.zen');
    fs.writeFileSync(seededFile, seeded);
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(seededFile, 'g2'), out);

    const expected = flagBytes(seeded).map((entry) => [entry.name, entry.byte]);
    const actual = flagBytes(fs.readFileSync(out)).map((entry) => [entry.name, entry.byte]);
    assert.deepStrictEqual(actual, expected);
  });
});
