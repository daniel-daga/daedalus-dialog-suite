'use strict';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 256 * 1024 * 1024;

function encodeFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length === 0 || payload.length > MAX_FRAME_BYTES) {
    throw new RangeError('invalid frame length');
  }

  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

class FrameDecoder {
  #pending = Buffer.alloc(0);

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError('frame input must be a Buffer');
    }

    const input = this.#pending.length === 0 ? chunk : Buffer.concat([this.#pending, chunk]);
    const values = [];
    let offset = 0;

    while (input.length - offset >= 4) {
      const length = input.readUInt32LE(offset);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        throw new RangeError('invalid frame length');
      }
      if (input.length - offset - 4 < length) break;

      try {
        values.push(JSON.parse(input.toString('utf8', offset + 4, offset + 4 + length)));
      } catch (error) {
        throw new SyntaxError(`invalid JSON frame: ${error.message}`);
      }
      offset += 4 + length;
    }

    this.#pending = input.subarray(offset);
    return values;
  }
}

module.exports = { PROTOCOL_VERSION, MAX_FRAME_BYTES, encodeFrame, FrameDecoder };
