'use strict';

// Reading an OutputUnit database — `OU.CSL` / `OU.BIN` (#264).
//
// These hold the subtitle text the game actually shows. Reparsing scripts does
// not regenerate them, so a line written in the editor compiles clean and then
// shows the *old* subtitle in game, which reads as our bug. The first half of
// #264 is to notice that drift, which needs a reader before it needs anything
// else.
//
// An OU database is a `zCCSLib` ZenGin archive, so the container walkers this
// repo already has do the framing: ASCII entries carry their own names, and
// BINARY entries carry nothing at all, which is why that format is read
// positionally against the schema instead.
//
// **The fixtures are hand-built, in the retail layout.** They were first built
// from ZenKit's `CutsceneLibrary::load` read order alone, and the retail
// `OU.BIN` (2026-09-26, the MDK's, 20,826 lines) disagreed twice: it is
// **BIN_SAFE**, which the reader refused, and its message class is the whole
// chain `oCMsgConversation:oCNpcMessage:zCEventMessage`, which the reader did
// not recognise — so every subtitle read back empty. `binSafeOu` below is that
// file's layout, hash table included; the last test reads the real files
// wherever a Gothic install has them.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const { readOutputUnits, rewriteOutputUnits } = require('../lib/output-units.js');

/** The class chain every retail OU writes for its messages. */
const CHAIN = 'oCMsgConversation:oCNpcMessage:zCEventMessage';

/** `WriteArchiveBinary`'s frame: uint32 size, uint16 version, uint32 index,
 *  string0 objectName, string0 className — the size patched at the end to span
 *  the whole frame, which is the only thing delimiting it. */
function binFrame(cls, index, body) {
  const head = Buffer.concat([
    Buffer.alloc(4),
    u16(0),
    u32(index),
    str0('%'),
    str0(cls),
  ]);
  const frame = Buffer.concat([head, body]);
  frame.writeUInt32LE(frame.length, 0);
  return frame;
}

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; };
const u8 = (v) => Buffer.from([v]);
const str0 = (v) => Buffer.concat([Buffer.from(v, 'latin1'), Buffer.from([0])]);

/** The same database as `asciiOu`, in the format the game actually loads.
 *  Note `write_enum` is ONE byte here and four in the other two formats. */
function binaryOu(messages, cls = CHAIN) {
  // Numbered parent first, the order the archive writes objects in — the same
  // numbering `asciiOu` gives.
  let index = 1;
  const blocks = messages.map((m) => {
    const blockIndex = index++;
    const atomicIndex = index++;
    const message = binFrame(cls, index++, Buffer.concat([
      u8(0), str0(m.text), str0(m.wav),
    ]));
    const atomic = binFrame('zCCSAtomicBlock', atomicIndex, message);
    return binFrame('zCCSBlock', blockIndex, Buffer.concat([
      str0(m.name), i32(1), f32(0), atomic,
    ]));
  });
  const lib = binFrame('zCCSLib', 0, Buffer.concat([i32(messages.length), ...blocks]));
  const head = Buffer.from([
    'ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'BINARY', 'saveGame 0', 'END',
    `objects ${1 + messages.length * 3}  `, 'END',
  ].join('\n') + '\n', 'latin1');
  return Buffer.concat([head, lib]);
}

/** The retail `OU.BIN`'s own format. Every entry is `0x12`, the index of its
 *  name in the hash table, a type byte and the value; object frames are STRING
 *  entries. The hash table is the retail file's exactly — names in insertion
 *  order, ZenGin's hash values, and the physical order it writes them in. */
const RETAIL_KEYS = [
  ['NumOfItems', 93], ['blockName', 68], ['numOfBlocks', 39], ['subBlock0', 50],
  ['subType', 74], ['text', 13], ['name', 41],
];
const RETAIL_KEY_ORDER = [5, 2, 6, 3, 1, 4, 0];

function binSafeOu(messages) {
  const bsStr = (v) => { const b = Buffer.from(v, 'latin1'); return Buffer.concat([u8(1), u16(b.length), b]); };
  const key = (name) => Buffer.concat([u8(0x12), u32(RETAIL_KEYS.findIndex(([k]) => k === name))]);
  const end = bsStr('[]');
  const parts = [bsStr('[% zCCSLib 0 0]'), key('NumOfItems'), u8(2), i32(messages.length)];
  let index = 1;
  for (const m of messages) {
    parts.push(
      bsStr(`[% zCCSBlock 0 ${index++}]`),
      key('blockName'), bsStr(m.name),
      key('numOfBlocks'), u8(2), i32(1),
      key('subBlock0'), u8(3), f32(0),
      bsStr(`[% zCCSAtomicBlock 0 ${index++}]`),
      bsStr(`[% ${CHAIN} 0 ${index++}]`),
      key('subType'), u8(0x11), u32(0),
      key('text'), bsStr(m.text),
      key('name'), bsStr(m.wav),
      end, end, end,
    );
  }
  parts.push(end);
  const body = Buffer.concat(parts);
  const text = Buffer.from([
    'ZenGin Archive', 'ver 1', 'zCArchiverBinSafe', 'BIN_SAFE', 'saveGame 0',
    'date 17.10.2003 12:57:16', 'user bjoern.pankratz', 'END',
  ].join('\n') + '\n', 'latin1');
  const hashTable = Buffer.concat([u32(RETAIL_KEYS.length), ...RETAIL_KEY_ORDER.map((i) => {
    const [name, hash] = RETAIL_KEYS[i];
    return Buffer.concat([u16(name.length), u16(i), u32(hash), Buffer.from(name, 'latin1')]);
  })]);
  const counts = Buffer.concat([u32(2), u32(1 + messages.length * 3), u32(text.length + 12 + body.length)]);
  return Buffer.concat([text, counts, body, hashTable]);
}

/** A `zCCSLib` ASCII archive holding one message per entry given. */
function asciiOu(messages, cls = CHAIN) {
  const objects = 1 + messages.length * 3;
  const head = [
    'ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'ASCII', 'saveGame 0', 'END',
    `objects ${objects}  `, 'END', '',
  ];
  const body = [`[% zCCSLib 0 0]`, `\tNumOfItems=int:${messages.length}`];
  let index = 1;
  for (const m of messages) {
    body.push(`\t[% zCCSBlock 0 ${index++}]`);
    body.push(`\t\tblockName=string:${m.name}`);
    body.push('\t\tnumOfBlocks=int:1');
    body.push('\t\tsubBlock0=float:0');
    body.push(`\t\t[% zCCSAtomicBlock 0 ${index++}]`);
    body.push(`\t\t\t[% ${cls} 0 ${index++}]`);
    body.push('\t\t\t\tsubType=enum:0');
    body.push(`\t\t\t\ttext=string:${m.text}`);
    body.push(`\t\t\t\tname=string:${m.wav}`);
    body.push('\t\t\t[]');
    body.push('\t\t[]');
    body.push('\t[]');
  }
  body.push('[]');
  return Buffer.from(head.concat(body).join('\n') + '\n', 'latin1');
}

test('reads every block of an ASCII OU database, name and subtitle together', () => {
  const buf = asciiOu([
    { name: 'DIA_TEST_HELLO_15_00', text: 'Was willst du?', wav: 'DIA_TEST_HELLO_15_00.WAV' },
    { name: 'DIA_TEST_HELLO_15_01', text: 'Nichts.', wav: 'DIA_TEST_HELLO_15_01.WAV' },
  ]);

  const ou = readOutputUnits(buf);

  assert.strictEqual(ou.format, 'ASCII');
  assert.deepStrictEqual(ou.units, [
    { name: 'DIA_TEST_HELLO_15_00', text: 'Was willst du?', wav: 'DIA_TEST_HELLO_15_00.WAV' },
    { name: 'DIA_TEST_HELLO_15_01', text: 'Nichts.', wav: 'DIA_TEST_HELLO_15_01.WAV' },
  ]);
});

test('keeps a subtitle that contains the separators the format uses', () => {
  // `name=type:value` splits on the FIRST `=` and the first `:` after it, so a
  // subtitle holding either character is where a naive split loses text — and
  // losing text silently is exactly what the drift check must not do.
  const buf = asciiOu([
    { name: 'DIA_X_00', text: 'Nun: 10 Erz = 1 Gold, klar?', wav: 'DIA_X_00.WAV' },
  ]);

  assert.deepStrictEqual(readOutputUnits(buf).units, [
    { name: 'DIA_X_00', text: 'Nun: 10 Erz = 1 Gold, klar?', wav: 'DIA_X_00.WAV' },
  ]);
});

test('reports an empty database as empty rather than failing', () => {
  assert.deepStrictEqual(readOutputUnits(asciiOu([])).units, []);
});

test('refuses a file that is not a ZenGin archive, naming what it saw', () => {
  assert.throws(
    () => readOutputUnits(Buffer.from('func void DIA_Test() {};\n', 'latin1')),
    /not a ZenGin archive/i,
  );
});

test('refuses an archive that is not a cutscene library', () => {
  // A world opened by mistake — same container, wrong contents. Reading it as
  // an OU database would report every line of the project as missing.
  const buf = Buffer.from([
    'ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'ASCII', 'saveGame 0', 'END',
    'objects 1  ', 'END', '',
    '[% oCWorld:zCWorld 0 0]', '\tsomething=int:1', '[]',
  ].join('\n') + '\n', 'latin1');

  assert.throws(() => readOutputUnits(buf), /zCCSLib/);
});

test('reads a BINARY OU database — the format the game actually loads', () => {
  const buf = binaryOu([
    { name: 'DIA_TEST_HELLO_15_00', text: 'Was willst du?', wav: 'DIA_TEST_HELLO_15_00.WAV' },
    { name: 'DIA_TEST_HELLO_15_01', text: 'Nichts.', wav: 'DIA_TEST_HELLO_15_01.WAV' },
  ]);

  const ou = readOutputUnits(buf);

  assert.strictEqual(ou.format, 'BINARY');
  assert.deepStrictEqual(ou.units, [
    { name: 'DIA_TEST_HELLO_15_00', text: 'Was willst du?', wav: 'DIA_TEST_HELLO_15_00.WAV' },
    { name: 'DIA_TEST_HELLO_15_01', text: 'Nichts.', wav: 'DIA_TEST_HELLO_15_01.WAV' },
  ]);
});

test('reads the same database identically whichever format it is in', () => {
  // The two formats are written by different code paths in the engine and read
  // by different ones here; a drift report must not depend on which the user
  // happens to have. `subType` alone is 4 bytes in one and 1 in the other.
  const messages = [
    { name: 'DIA_A_00', text: 'Eins.', wav: 'DIA_A_00.WAV' },
    { name: 'DIA_B_00', text: 'Zwei: ja = gut', wav: 'DIA_B_00.WAV' },
  ];

  assert.deepStrictEqual(
    readOutputUnits(binaryOu(messages)).units,
    readOutputUnits(asciiOu(messages)).units,
  );
  assert.deepStrictEqual(
    readOutputUnits(binSafeOu(messages)).units,
    readOutputUnits(asciiOu(messages)).units,
  );
});

test('reads a BIN_SAFE OU database — the format the retail OU.BIN is in', () => {
  const buf = binSafeOu([
    { name: 'DIA_TEST_HELLO_15_00', text: 'Was willst du?', wav: 'DIA_TEST_HELLO_15_00.WAV' },
    { name: 'DIA_TEST_HELLO_15_01', text: 'Nichts.', wav: 'DIA_TEST_HELLO_15_01.WAV' },
  ]);

  const ou = readOutputUnits(buf);

  assert.strictEqual(ou.format, 'BIN_SAFE');
  assert.deepStrictEqual(ou.units, [
    { name: 'DIA_TEST_HELLO_15_00', text: 'Was willst du?', wav: 'DIA_TEST_HELLO_15_00.WAV' },
    { name: 'DIA_TEST_HELLO_15_01', text: 'Nichts.', wav: 'DIA_TEST_HELLO_15_01.WAV' },
  ]);
});

test('a message is known by its base class, whether or not its chain is written', () => {
  // The retail file writes the chain; reading only the bare class name left
  // every retail subtitle empty, which reported the whole project as stale.
  const m = [{ name: 'DIA_A_00', text: 'Eins.', wav: 'DIA_A_00.WAV' }];
  for (const cls of [CHAIN, 'oCMsgConversation']) {
    assert.deepStrictEqual(readOutputUnits(asciiOu(m, cls)).units, m, `ASCII, ${cls}`);
    assert.deepStrictEqual(readOutputUnits(binaryOu(m, cls)).units, m, `BINARY, ${cls}`);
  }
});

test('refuses a truncated BINARY database instead of reporting short', () => {
  // A half-written OU is the failure this has to name: silently returning the
  // blocks it managed to read would report every line after the cut as missing
  // from the database, which is a drift report about nothing.
  const buf = binaryOu([
    { name: 'DIA_A_00', text: 'Eins.', wav: 'DIA_A_00.WAV' },
    { name: 'DIA_B_00', text: 'Zwei.', wav: 'DIA_B_00.WAV' },
  ]);

  assert.throws(() => readOutputUnits(buf.subarray(0, buf.length - 12)), /truncated|beyond/i);
});

// ── Writing one back (#264's second half) ────────────────────────────────────
//
// The engine shows a line's subtitle from the OU, not the script, so a line
// edited in the editor needs its entry rewritten. `rewriteOutputUnits` takes the
// file as it is and the lines the scripts hold, and returns the file with those
// lines set — same format, same header, every entry no script claims kept.

const VANILLA = { name: 'DIA_XARDAS_HELLO_14_00', text: 'Du bist zurück.', wav: 'DIA_XARDAS_HELLO_14_00.WAV' };
const OURS = { name: 'DIA_HARALD_HELLO_15_00', text: 'Alter Text.', wav: 'DIA_HARALD_HELLO_15_00.WAV' };

for (const [format, build] of [['ASCII', asciiOu], ['BINARY', binaryOu], ['BIN_SAFE', binSafeOu]]) {
  test(`${format}: with nothing to change, the file comes back byte-identical`, () => {
    // The writer and the hand-built fixture agree byte for byte: the writer is
    // checked against the same read order as the reader, not against itself.
    const original = build([OURS, VANILLA]);
    assert.deepStrictEqual(rewriteOutputUnits(original, [{ name: OURS.name, text: OURS.text }]), original);
  });

  test(`${format}: a changed line gets its new subtitle, and nothing else moves`, () => {
    const original = build([OURS, VANILLA]);
    const rewritten = rewriteOutputUnits(original, [{ name: 'dia_harald_hello_15_00', text: 'Neuer Text: ja = gut' }]);

    assert.strictEqual(readOutputUnits(rewritten).format, format);
    assert.deepStrictEqual(rewritten, build([{ ...OURS, text: 'Neuer Text: ja = gut' }, VANILLA]));
  });

  test(`${format}: a line the database lacks is added, upper-cased, with its wav`, () => {
    const original = build([OURS, VANILLA]);
    const rewritten = rewriteOutputUnits(original, [{ name: 'Dia_Harald_Hello_15_01', text: 'Noch was.' }]);

    const added = { name: 'DIA_HARALD_HELLO_15_01', text: 'Noch was.', wav: 'DIA_HARALD_HELLO_15_01.WAV' };
    assert.deepStrictEqual(readOutputUnits(rewritten).units, [OURS, added, VANILLA]);
    // The new entry carries the class chain its neighbours do.
    assert.strictEqual(rewritten.toString('latin1').split(CHAIN).length - 1, 3);
  });
}

// The real files, wherever an install has them: the GMBT-managed OU under
// `_work`, and the MDK's retail copy the engine harness carries. Both formats
// must read to the same lines, and writing nothing back must change no byte.
const G2_ROOT = process.env.ZENKIT_G2_ROOT
  || 'C:/Program Files (x86)/Steam/steamapps/common/Gothic II';
const REAL_OU_DIRS = [
  path.join(G2_ROOT, '_work', 'Data', 'Scripts', 'Content', 'Cutscene'),
  path.join(__dirname, '..', 'tools', 'gmbt', 'mdk', 'Scripts', 'Content', 'Cutscene'),
];
for (const dir of REAL_OU_DIRS) {
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^ou\.(bin|csl)$/i.test(f)).map((f) => path.join(dir, f))
    : [];
  test(`a real OU database reads whole and rewrites byte-identical (${dir})`,
    { skip: files.length === 2 ? false : 'no OU.BIN + OU.CSL here' }, () => {
      const read = files.map((f) => {
        const bytes = fs.readFileSync(f);
        assert.deepStrictEqual(rewriteOutputUnits(bytes, []), bytes, `${f} survives a no-op rewrite`);
        return readOutputUnits(bytes);
      });
      assert.deepStrictEqual(read.map((r) => r.format).sort(), ['ASCII', 'BIN_SAFE']);
      assert.ok(read[0].units.length > 0);
      assert.ok(read[0].units.every((u) => u.text !== '' && u.wav !== ''), 'no line reads back empty');
      // As sets: an OU.BIN the engine rebuilt from a newer OU.CSL comes out
      // sorted by name, while the CSL keeps script order.
      const names = (r) => r.units.map((u) => u.name).sort();
      assert.deepStrictEqual(names(read[0]), names(read[1]));
    });
}

test('a database that was sorted stays sorted; one that was not keeps its order and gains at the end', () => {
  const sorted = asciiOu([OURS, VANILLA]); // H before X
  const unsorted = asciiOu([VANILLA, OURS]);
  const added = [{ name: 'DIA_IGOR_00', text: 'Hm.' }];

  assert.deepStrictEqual(
    readOutputUnits(rewriteOutputUnits(sorted, added)).units.map((u) => u.name),
    ['DIA_HARALD_HELLO_15_00', 'DIA_IGOR_00', 'DIA_XARDAS_HELLO_14_00'],
  );
  assert.deepStrictEqual(
    readOutputUnits(rewriteOutputUnits(unsorted, added)).units.map((u) => u.name),
    ['DIA_XARDAS_HELLO_14_00', 'DIA_HARALD_HELLO_15_00', 'DIA_IGOR_00'],
  );
});

test('the header the file had is kept — date, user and line endings — with the object count updated', () => {
  const original = Buffer.from([
    'ZenGin Archive', 'ver 1', 'zCArchiverGeneric', 'ASCII', 'saveGame 0',
    'date 12.3.2003 14:02:11', 'user nico', 'END', 'objects 4        ', 'END', '',
    '[% zCCSLib 0 0]', '\tNumOfItems=int:1',
    '\t[% zCCSBlock 0 1]', `\t\tblockName=string:${OURS.name}`, '\t\tnumOfBlocks=int:1', '\t\tsubBlock0=float:0',
    '\t\t[% zCCSAtomicBlock 0 2]', '\t\t\t[% oCMsgConversation 0 3]', '\t\t\t\tsubType=enum:2',
    `\t\t\t\ttext=string:${OURS.text}`, `\t\t\t\tname=string:${OURS.wav}`, '\t\t\t[]', '\t\t[]', '\t[]', '[]', '',
  ].join('\r\n'), 'latin1');

  const rewritten = rewriteOutputUnits(original, [{ name: 'DIA_NEW_00', text: 'Neu.' }]).toString('latin1');

  assert.ok(rewritten.startsWith('ZenGin Archive\r\nver 1\r\nzCArchiverGeneric\r\nASCII\r\nsaveGame 0\r\ndate 12.3.2003 14:02:11\r\nuser nico\r\nEND\r\nobjects 7        \r\nEND\r\n\r\n'));
  assert.ok(!/[^\r]\n/.test(rewritten), 'every line ends in CRLF, as the file\'s did');
  // An entry keeps the subType it had; a new one takes the one the file uses.
  assert.strictEqual((rewritten.match(/subType=enum:2/g) || []).length, 2);
});

// Gothic's files are windows-1252, not latin1: the two agree everywhere but
// 0x80–0x9F, which is exactly where German typography lives („ “ – …). Read as
// latin1, `„` (0x84) is a control character — so every line using one read as
// drift, and a rewrite would have written it back as a byte the game renders as
// nothing.
test('subtitles are windows-1252 both ways: „quotes“, dashes and the euro sign survive', () => {
  const text = '„Nimm das“ – für 5 € … klar?';
  const original = asciiOu([{ name: 'DIA_Q_00', text: 'alt', wav: 'DIA_Q_00.WAV' }]);
  for (const build of [asciiOu, binaryOu, binSafeOu]) {
    const rewritten = rewriteOutputUnits(build([{ name: 'DIA_Q_00', text: 'alt', wav: 'DIA_Q_00.WAV' }]), [{ name: 'DIA_Q_00', text }]);
    assert.strictEqual(readOutputUnits(rewritten).units[0].text, text);
  }
  const bytes = rewriteOutputUnits(original, [{ name: 'DIA_Q_00', text }]);
  // „ is 0x84 and “ is 0x93 in windows-1252; € is 0x80.
  assert.ok(bytes.includes(Buffer.from([0x84, 0x4e])), '„ written as 0x84');
  assert.ok(bytes.includes(Buffer.from([0x93])), '“ written as 0x93');
  assert.ok(bytes.includes(Buffer.from([0x80])), '€ written as 0x80');
});
