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
// The read order is `CutsceneLibrary::load`'s. **Checked against real files
// since 2026-09-26**: the MDK's retail `OU.BIN` (BIN_SAFE) and `OU.CSL` (ASCII),
// 20,826 lines each, and an engine-rebuilt pair — all read whole, both formats
// agree, and a rewrite with nothing to change is byte-identical. BINARY has
// still met only hand-built fixtures; no real OU in that format has been seen.

const { readHeader, walk: walkBinSafe, readHashTable } = require('./container.js');
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

/** A `zCCSBlock` whose message has been read, or is still being read. `time`,
 *  `subType` and `messageClass` are carried only so a rewrite writes back what
 *  it read. */
function emptyUnit() {
  return { name: '', text: '', wav: '', time: undefined, subType: 0, messageClass: undefined };
}

// The engine writes the message's whole class chain —
// `oCMsgConversation:oCNpcMessage:zCEventMessage` in the retail OU, BinSafe and
// ASCII alike — and ZenGin resolves a chain to the first class it knows. So the
// base class is what identifies a message, and the chain as written is what
// goes back out. A new entry takes the chain the file already uses.
const MESSAGE_CLASS = 'oCMsgConversation';
const RETAIL_MESSAGE_CHAIN = 'oCMsgConversation:oCNpcMessage:zCEventMessage';
const isMessageClass = (cls) => cls.split(':')[0] === MESSAGE_CLASS;

const publicUnit = ({ name, text, wav }) => ({ name, text, wav });

/** ASCII and BinSafe name every entry and their walkers yield the same events,
 *  so one reader serves both; `value` turns an entry into its string or number. */
function readNamedUnits(events, value) {
  const units = [];
  let unit = null;
  let sawLib = false;
  let inMessage = false;

  for (const ev of events) {
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
      } else if (isMessageClass(cls) && unit) {
        inMessage = true;
        unit.messageClass = cls;
      }
    } else if (ev.kind === 'objectEnd') {
      // The end frame carries the depth it closed *to*, so a message ends at
      // the depth its own frame began at.
      if (inMessage && ev.objectDepth === 3) inMessage = false;
    } else if (ev.kind === 'entry' && unit) {
      if (ev.entryName === 'blockName') unit.name = value(ev);
      else if (ev.entryName === 'subBlock0' && unit.time === undefined) unit.time = value(ev);
      else if (inMessage && ev.entryName === 'subType') unit.subType = Number(value(ev));
      else if (inMessage && ev.entryName === 'text') unit.text = value(ev);
      else if (inMessage && ev.entryName === 'name') unit.wav = value(ev);
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

/** A BinSafe entry is typed: a string as ASCII's is, a number as its bytes. */
function binSafeValue(buf, ev) {
  if (ev.entryType === 'STRING') return entryValue(buf, ev);
  if (ev.entryType === 'FLOAT') return buf.readFloatLE(ev.payloadOffset);
  return buf.readInt32LE(ev.payloadOffset);
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
  const messageFrame = frame.body.frame();
  if (!isMessageClass(messageFrame.cls)) {
    throw new Error(`not an OutputUnit database: expected a \`${MESSAGE_CLASS}\` object, found \`${messageFrame.cls}\``);
  }
  const message = messageFrame.body;
  const subType = message.byte(); // one byte here, four in ASCII and BinSafe
  const text = message.string();
  const wav = message.string();
  return { text, wav, subType, messageClass: messageFrame.cls };
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
  if (format === 'ASCII') return readNamedUnits(walkAscii(buf), (ev) => entryValue(buf, ev));
  if (format === 'BIN_SAFE') return readNamedUnits(walkBinSafe(buf), (ev) => binSafeValue(buf, ev));
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

/** The message class chain most of the file's entries carry — what a new entry
 *  gets. The retail chain when there is no entry to ask. */
function commonMessageClass(units) {
  const counts = new Map();
  for (const { messageClass } of units) counts.set(messageClass, (counts.get(messageClass) ?? 0) + 1);
  let best = RETAIL_MESSAGE_CHAIN;
  let bestCount = 0;
  for (const [messageClass, count] of counts) {
    if (count > bestCount) { best = messageClass; bestCount = count; }
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
  const messageClass = commonMessageClass(units);
  const index = new Map(units.map((unit) => [unit.name.toUpperCase(), unit]));
  for (const { name, text } of lines) {
    const key = name.toUpperCase();
    const unit = index.get(key);
    if (unit) {
      unit.text = text;
    } else {
      const added = { name: key, text, wav: `${key}.WAV`, time: undefined, subType, messageClass };
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
    const message = binaryFrame(unit.messageClass, index++, Buffer.concat([
      Buffer.from([unit.subType]), str0(unit.text), str0(unit.wav),
    ]));
    return binaryFrame('zCCSBlock', blockIndex, Buffer.concat([
      str0(unit.name), i32(1), f32(unit.time ?? 0), binaryFrame('zCCSAtomicBlock', atomicIndex, message),
    ]));
  });
  return binaryFrame('zCCSLib', 0, Buffer.concat([i32(units.length), ...blocks]));
}

// BinSafe: an object frame is a STRING `[% class 0 index]`; an entry is 0x12,
// the uint32 index of its name in the hash table, a type byte and the value.
// Every OU uses the same seven names, so the original's hash table goes back out
// as it was — its hashes are ZenGin's, and nothing here has to compute one.
const BS_STRING = 0x01;
const BS_INT = 0x02;
const BS_FLOAT = 0x03;
const BS_ENUM = 0x11;
const BS_HASH = 0x12;

function bsString(text) {
  const bytes = cp1252(text);
  return Buffer.concat([Buffer.from([BS_STRING]), u16(bytes.length), bytes]);
}

function binSafeBody(units, hashTable) {
  const keyIndex = new Map(hashTable.entries.map((entry, i) => [entry.key, i]));
  const entry = (key, payload) => {
    const i = keyIndex.get(key);
    if (i === undefined) throw new Error(`cannot write \`${key}\`: the database's hash table has no such name`);
    return Buffer.concat([Buffer.from([BS_HASH]), u32(i), payload]);
  };
  const int = (type, v) => Buffer.concat([Buffer.from([type]), i32(v)]);
  const end = bsString('[]');

  const parts = [bsString('[% zCCSLib 0 0]'), entry('NumOfItems', int(BS_INT, units.length))];
  let index = 1;
  for (const unit of units) {
    parts.push(
      bsString(`[% zCCSBlock 0 ${index++}]`),
      entry('blockName', bsString(unit.name)),
      entry('numOfBlocks', int(BS_INT, 1)),
      entry('subBlock0', Buffer.concat([Buffer.from([BS_FLOAT]), f32(unit.time ?? 0)])),
      bsString(`[% zCCSAtomicBlock 0 ${index++}]`),
      bsString(`[% ${unit.messageClass} 0 ${index++}]`),
      entry('subType', int(BS_ENUM, unit.subType)),
      entry('text', bsString(unit.text)),
      entry('name', bsString(unit.wav)),
      end, end, end,
    );
  }
  parts.push(end);
  return Buffer.concat(parts);
}

/** The text header as it was, then `uint32 version, objects, hash table
 *  offset`, the entries, and the original hash table. */
function rewriteBinSafe(original, header, units) {
  const body = binSafeBody(units, readHashTable(original, header.hashTableOffset));
  return Buffer.concat([
    original.subarray(0, header.entryStart - 12),
    u32(header.bsVersion), u32(1 + units.length * 3), u32(header.entryStart + body.length),
    body,
    original.subarray(header.hashTableOffset),
  ]);
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
      `\t\t\t[% ${unit.messageClass} 0 ${index++}]`,
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
 * A no-op rewrite of the real files is byte-identical; see the reader.
 *
 * @param {Buffer} original the whole `OU.CSL` / `OU.BIN` file
 * @param {Array<{ name: string, text: string }>} lines
 * @returns {Buffer}
 */
function rewriteOutputUnits(original, lines) {
  const header = readHeader(original);
  const format = header.lines[3];
  const units = mergeUnits(readUnits(original, format), lines);
  if (format === 'BIN_SAFE') return rewriteBinSafe(original, header, units);

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
