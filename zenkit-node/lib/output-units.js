'use strict';

// Reading an OutputUnit database — `OU.CSL` / `OU.BIN` (#264).
//
// These files hold the subtitle text the game shows. Reparsing scripts does not
// regenerate them, so a line written in the editor compiles clean and then
// shows the *old* subtitle in game. Noticing that drift needs the file read,
// which is what this is; writing one back is #264's other half and is not here.
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

/** A `zCCSBlock` whose message has been read, or is still being read. */
function emptyUnit() {
  return { name: '', text: '', wav: '' };
}

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
  return buf.toString('latin1', ev.payloadOffset, ev.payloadOffset + ev.payloadLength);
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
    this.pos += 4;
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
    const value = this.buf.toString('latin1', this.pos, z);
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
    block.float32(); // subBlock0
    units.push({ name, ...readBinaryMessage(block) });
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
  message.byte(); // subType — one byte here, four in ASCII and BinSafe
  const text = message.string();
  const wav = message.string();
  return { text, wav };
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
  if (format === 'ASCII') return { format, units: readAsciiUnits(buf) };
  if (format === 'BINARY') {
    return { format, units: readBinaryUnits(buf, readBinaryHeader(buf).entryStart) };
  }

  throw new Error(`cannot read an OutputUnit database in ${format} format yet`);
}

module.exports = { readOutputUnits };
