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
// **The fixtures here are hand-authored, not retail.** They are built from
// ZenKit's `CutsceneLibrary::load` read order, which is the same contract the
// engine's writer obeys — but nobody has checked this reader against a real
// `OU.BIN` yet, and #264 says that is Daniel's machine rather than CI.

const test = require('node:test');
const assert = require('node:assert');

const { readOutputUnits } = require('../lib/output-units.js');

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
function binaryOu(messages) {
  let index = 1;
  const blocks = messages.map((m) => {
    const message = binFrame('oCMsgConversation', index++, Buffer.concat([
      u8(0), str0(m.text), str0(m.wav),
    ]));
    const atomic = binFrame('zCCSAtomicBlock', index++, message);
    return binFrame('zCCSBlock', index++, Buffer.concat([
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

/** A `zCCSLib` ASCII archive holding one message per entry given. */
function asciiOu(messages) {
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
    body.push(`\t\t\t[% oCMsgConversation 0 ${index++}]`);
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
