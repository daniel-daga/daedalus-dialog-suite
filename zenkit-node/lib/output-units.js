'use strict';

// Reading and rewriting an OutputUnit database — `OU.CSL` / `OU.BIN` (#264).
//
// These files hold the subtitle text the game shows. Reparsing scripts does not
// regenerate them, so a line written in the editor compiles clean and then
// shows the *old* subtitle in game. Noticing that drift needs the file read;
// fixing it needs the file rewritten with the lines the scripts hold, which is
// `rewriteOutputUnits` — the same schema, written in the order it is read.
//
// An OU database is a `zCCSLib` ZenGin archive, so the container walkers do the
// framing and this module only knows the schema. One `zCCSBlock` per line:
//
//   zCCSLib
//     NumOfItems=int:N
//     zCCSBlock         blockName=string:<the AI_Output id>
//       zCCSAtomicBlock
//         oCMsgConversation   subType=enum, text=string, name=string:<the wav>
//
// The read order is `CutsceneLibrary::load`'s, which is the contract the
// engine's own writer obeys. **Checked against hand-authored fixtures only** —
// no retail `OU.BIN` is in this tree (#264 leaves that to a machine that has
// Gothic installed), so treat a disagreement with a real file as this reader's
// fault before the file's.

const { readHeader } = require('./container.js');
const { walkAscii } = require('./container-ascii.js');
const { readBinaryHeader } = require('./container-binary.js');

// Gothic writes windows-1252. It agrees with latin1 everywhere but 0x80–0x9F,
// which is where German typography lives („ “ – …): read as latin1, `„` is a
// control character. Five bytes there are unassigned and stay as they are.
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const CP1252_ENCODE = new Map([...CP1252_HIGH].map((ch, i) => [ch, 0x80 + i]));

function decode1252(buf, start, end) {
  let out = '';
  for (let i = start; i < end; i++) {
    const b = buf[i];
    out += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  }
  return out;
}

/** A character windows-1252 cannot hold becomes `?`, as the engine's own
 *  conversion does, rather than a wrong byte. */
function encode1252(text) {
  const bytes = Buffer.alloc(text.length);
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const mapped = CP1252_ENCODE.get(ch);
    bytes[n++] = mapped ?? (code <= 0xff && !(code >= 0x80 && code <= 0x9f) ? code : 0x3f);
  }
  return bytes.subarray(0, n);
}

/** A `zCCSBlock` whose message has been read, or is still being read. `time`
 *  and `subType` are carried only so a rewrite writes back what it read. */
function emptyUnit() {
  return { name: '', text: '', wav: '', time: undefined, subType: 0 };
}

const publicUnit = ({ name, text, wav }) => ({ name, text, wav });

function readAsciiUnits(buf) {
  const units = [];
  let unit = null;
  let sawLib = false;
  let inMessage = false;

  for (const ev of walkAscii(buf)) {
    if (ev.kind === 'objectBegin') {
      const cls = ev.frame.cls;
      if (ev.objectDepth === 0) {
        if (cls !== 'zCCSLib') {
          throw new Error(`not an OutputUnit database: the root object is \`${cls}\`, not \`zCCSLib\``);
        }
        sawLib = true;
      } else if (cls === 'zCCSBlock' && ev.objectDepth === 1) {
        unit = emptyUnit();
        units.push(unit);
      } else if (cls === 'oCMsgConversation') {
        inMessage = true;
      }
    } else if (ev.kind === 'objectEnd') {
      // The end frame carries the depth it closed *to*, so a message ends at
      // the depth its own frame began at.
      if (inMessage && ev.objectDepth === 3) inMessage = false;
    } else if (ev.kind === 'entry' && unit) {
      if (ev.entryName === 'blockName') unit.name = entryValue(buf, ev);
      else if (ev.entryName === 'subBlock0' && unit.time === undefined) unit.time = entryValue(buf, ev);
      else if (inMessage && ev.entryName === 'subType') unit.subType = Number(entryValue(buf, ev));
      else if (inMessage && ev.entryName === 'text') unit.text = entryValue(buf, ev);
      else if (inMessage && ev.entryName === 'name') unit.wav = entryValue(buf, ev);
    }
  }

  if (!sawLib) throw new Error('not an OutputUnit database: no `zCCSLib` object in the archive');
  return units;
}

// The walker reports where a payload starts and how long it is rather than the
// text, which is what keeps a subtitle holding `=` or `:` intact — the split
// that produced those offsets took the first of each, and everything after is
// the value.
function entryValue(buf, ev) {
  return decode1252(buf, ev.payloadOffset, ev.payloadOffset + ev.payloadLength);
}

// BINARY carries no entry names, no type tags and no lengths — an entry is
// bare bytes — so there is nothing to walk and the schema *is* the reader.
// `lib/container-binary.js` scans for frames because a world's schema is
// unknown; a `zCCSLib` is known exactly, so this descends it instead. Every
// read is bounded by the frame's own declared size, which is the only thing
// delimiting a frame in this format.
class BinaryCursor {
  constructor(buf, pos, end) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }

  need(n, what) {
    if (this.pos + n > this.end) {
      throw new Error(`truncated OutputUnit database: ${what} runs past the end of its object`);
    }
  }

  int32() {
    this.need(4, 'an int');
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  float32() {
    this.need(4, 'a float');
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  byte() {
    this.need(1, 'a byte');
    return this.buf[this.pos++];
  }

  // `write_string0`: the bytes then a NUL. A string is also ended by \r or \n
  // (`ReadStream::read_line`), which is how an OU written by ZenGin rather than
  // ZenKit still reads.
  string() {
    let z = this.pos;
    while (z < this.end && this.buf[z] !== 0 && this.buf[z] !== 0x0d && this.buf[z] !== 0x0a) z += 1;
    if (z >= this.end) {
      throw new Error('truncated OutputUnit database: a string runs past the end of its object');
    }
    const value = decode1252(this.buf, this.pos, z);
    this.pos = z + 1;
    return value;
  }

  /** `uint32 size, uint16 version, uint32 index, string0 name, string0 class`. */
  frame() {
    this.need(10, 'an object frame');
    const start = this.pos;
    const size = this.buf.readUInt32LE(start);
    if (size < 10 || start + size > this.end) {
      throw new Error(
        `truncated OutputUnit database: an object claims ${size} bytes, ` +
        `which runs beyond the ${this.end - start} left in its parent`,
      );
    }
    this.pos = start + 10;
    this.string(); // objectName, `%` for everything a zCCSLib holds
    const cls = this.string();
    return { cls, body: new BinaryCursor(this.buf, this.pos, start + size), end: start + size };
  }
}

function expectFrame(cursor, cls) {
  const frame = cursor.frame();
  if (frame.cls !== cls) {
    throw new Error(`not an OutputUnit database: expected a \`${cls}\` object, found \`${frame.cls}\``);
  }
  cursor.pos = frame.end;
  return frame.body;
}

function readBinaryUnits(buf, entryStart) {
  const root = new BinaryCursor(buf, entryStart, buf.length);
  const lib = expectFrame(root, 'zCCSLib');

  const count = lib.int32();
  const units = [];
  for (let i = 0; i < count; i++) {
    const block = expectFrame(lib, 'zCCSBlock');
    const name = block.string();
    block.int32(); // numOfBlocks — always 1; CutsceneLibrary rejects anything else
    const time = block.float32(); // subBlock0
    units.push({ name, time, ...readBinaryMessage(block) });
  }
  return units;
}

/** A block holds either the atomic block with the message, or another block
 *  that eventually does — `CutsceneBlock::get_message` walks that chain. */
function readBinaryMessage(block) {
  const frame = block.frame();
  if (frame.cls === 'zCCSBlock') {
    frame.body.string(); // blockName of the inner block, which nothing reads
    frame.body.int32();
    frame.body.float32();
    return readBinaryMessage(frame.body);
  }
  if (frame.cls !== 'zCCSAtomicBlock') {
    throw new Error(`not an OutputUnit database: a block holds a \`${frame.cls}\``);
  }
  const message = expectFrame(frame.body, 'oCMsgConversation');
  const subType = message.byte(); // one byte here, four in ASCII and BinSafe
  const text = message.string();
  const wav = message.string();
  return { text, wav, subType };
}

/**
 * Read an OutputUnit database.
 *
 * @param {Buffer} buf the whole `OU.CSL` / `OU.BIN` file
 * @returns {{ format: string, units: Array<{ name: string, text: string, wav: string }> }}
 *   `units` in file order — NOT the name order `CutsceneLibrary::load` sorts
 *   into, because file order is what a drift report should quote back.
 */
function readOutputUnits(buf) {
  let header;
  try {
    header = readHeader(buf);
  } catch {
    throw new Error('not a ZenGin archive: no `END` line in the first bytes');
  }
  if (header.lines[0] !== 'ZenGin Archive') {
    throw new Error(`not a ZenGin archive: first line is ${JSON.stringify(header.lines[0])}`);
  }

  const format = header.lines[3];
  return { format, units: readUnits(buf, format).map(publicUnit) };
}

function readUnits(buf, format) {
  if (format === 'ASCII') return readAsciiUnits(buf);
  if (format === 'BINARY') return readBinaryUnits(buf, readBinaryHeader(buf).entryStart);
  throw new Error(`cannot read an OutputUnit database in ${format} format yet`);
}

// ── Writing ──────────────────────────────────────────────────────────────────

const byName = (a, b) => {
  const x = a.name.toUpperCase();
  const y = b.name.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** The subType most of the file's entries carry — what a new entry gets. */
function commonSubType(units) {
  const counts = new Map();
  for (const { subType } of units) counts.set(subType, (counts.get(subType) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [subType, count] of counts) {
    if (count > bestCount) { best = subType; bestCount = count; }
  }
  return best;
}

/**
 * Set `lines` into the database: an entry whose name matches (case-insensitive,
 * as Daedalus is) takes the new text; a name the database lacks is added,
 * upper-cased as the engine's writer does, with `<NAME>.WAV`. Every other entry
 * is kept — a retail OU holds ~14k vanilla lines no mod script claims.
 */
function mergeUnits(units, lines) {
  const wasSorted = units.every((unit, i) => i === 0 || byName(units[i - 1], unit) <= 0);
  const subType = commonSubType(units);
  const index = new Map(units.map((unit) => [unit.name.toUpperCase(), unit]));
  for (const { name, text } of lines) {
    const key = name.toUpperCase();
    const unit = index.get(key);
    if (unit) {
      unit.text = text;
    } else {
      const added = { name: key, text, wav: `${key}.WAV`, time: undefined, subType };
      units.push(added);
      index.set(key, added);
    }
  }
  // A sorted database stays sorted — the engine looks entries up by name — and
  // one that was not is left in its own order, gaining at the end.
  if (wasSorted) units.sort(byName);
  return units;
}

const cp1252 = encode1252;
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; };
const str0 = (v) => Buffer.concat([cp1252(v), Buffer.from([0])]);

/** `uint32 size, uint16 version, uint32 index, string0 name, string0 class`,
 *  the size spanning the whole frame — the only thing delimiting one. */
function binaryFrame(cls, index, body) {
  const frame = Buffer.concat([Buffer.alloc(4), u16(0), u32(index), str0('%'), str0(cls), body]);
  frame.writeUInt32LE(frame.length, 0);
  return frame;
}

/** Objects are numbered parent first, the order the archive writes them in. */
function binaryBody(units) {
  let index = 1;
  const blocks = units.map((unit) => {
    const blockIndex = index++;
    const atomicIndex = index++;
    const message = binaryFrame('oCMsgConversation', index++, Buffer.concat([
      Buffer.from([unit.subType]), str0(unit.text), str0(unit.wav),
    ]));
    return binaryFrame('zCCSBlock', blockIndex, Buffer.concat([
      str0(unit.name), i32(1), f32(unit.time ?? 0), binaryFrame('zCCSAtomicBlock', atomicIndex, message),
    ]));
  });
  return binaryFrame('zCCSLib', 0, Buffer.concat([i32(units.length), ...blocks]));
}

function asciiBody(units, eol) {
  const lines = ['[% zCCSLib 0 0]', `\tNumOfItems=int:${units.length}`];
  let index = 1;
  for (const unit of units) {
    lines.push(
      `\t[% zCCSBlock 0 ${index++}]`,
      `\t\tblockName=string:${unit.name}`,
      '\t\tnumOfBlocks=int:1',
      `\t\tsubBlock0=float:${unit.time ?? '0'}`,
      `\t\t[% zCCSAtomicBlock 0 ${index++}]`,
      `\t\t\t[% oCMsgConversation 0 ${index++}]`,
      `\t\t\t\tsubType=enum:${unit.subType}`,
      `\t\t\t\ttext=string:${unit.text}`,
      `\t\t\t\tname=string:${unit.wav}`,
      '\t\t\t[]',
      '\t\t[]',
      '\t[]',
    );
  }
  lines.push('[]');
  return cp1252(lines.join(eol) + eol);
}

/**
 * The file with `lines` (`{ name, text }` — an `AI_Output` id and its subtitle)
 * set into it, in the format it was in (#264).
 *
 * The header is the file's own, byte for byte — its date, its user, its line
 * endings — with only the object count changed, padded to the width it had.
 * Nested block chains, which `readOutputUnits` follows to their message, come
 * back as one block per line: the shape every OU the engine writes has.
 * **Checked against hand-authored fixtures only**, like the reader.
 *
 * @param {Buffer} original the whole `OU.CSL` / `OU.BIN` file
 * @param {Array<{ name: string, text: string }>} lines
 * @returns {Buffer}
 */
function rewriteOutputUnits(original, lines) {
  const header = readHeader(original);
  const format = header.lines[3];
  const units = mergeUnits(readUnits(original, format), lines);

  // Header up to its first END, then `objects N`, then everything up to the
  // body — the second END and whatever blank line the file put after it.
  let pos = 0;
  for (const line of header.lines) {
    pos = original.indexOf(0x0a, pos) + 1;
    if (line === 'END') break;
  }
  const objectsEnd = original.indexOf(0x0a, pos);
  const crlf = original[objectsEnd - 1] === 0x0d;
  const objectsLine = original.toString('latin1', pos, crlf ? objectsEnd - 1 : objectsEnd);
  const bodyStart = format === 'BINARY'
    ? readBinaryHeader(original).entryStart
    : original.indexOf('[', objectsEnd);
  const objects = `objects ${1 + units.length * 3}`.padEnd(objectsLine.length);

  return Buffer.concat([
    original.subarray(0, pos),
    cp1252(objects),
    original.subarray(crlf ? objectsEnd - 1 : objectsEnd, bodyStart),
    format === 'BINARY' ? binaryBody(units) : asciiBody(units, crlf ? '\r\n' : '\n'),
  ]);
}

module.exports = { readOutputUnits, rewriteOutputUnits };
