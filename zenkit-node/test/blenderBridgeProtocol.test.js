'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MAX_FRAME_BYTES,
  FrameDecoder,
  encodeFrame,
} = require('../lib/blender-bridge/protocol');

test('encodes a JSON request as a little-endian length-prefixed frame', () => {
  const value = { id: 1, method: 'ping' };
  const encoded = encodeFrame(value);
  const payload = Buffer.from(JSON.stringify(value));

  assert.equal(encoded.readUInt32LE(0), payload.length);
  assert.deepEqual(encoded.subarray(4), payload);
});

test('decodes a request split across input chunks', () => {
  const encoded = encodeFrame({ id: 2, method: 'ping' });
  const decoder = new FrameDecoder();

  assert.deepEqual(decoder.push(encoded.subarray(0, 5)), []);
  assert.deepEqual(decoder.push(encoded.subarray(5)), [{ id: 2, method: 'ping' }]);
});

test('decodes coalesced frames and preserves the incomplete suffix', () => {
  const first = encodeFrame({ id: 3, method: 'ping' });
  const second = encodeFrame({ id: 4, method: 'ping' });
  const decoder = new FrameDecoder();

  assert.deepEqual(decoder.push(Buffer.concat([first, second.subarray(0, 6)])), [
    { id: 3, method: 'ping' },
  ]);
  assert.deepEqual(decoder.push(second.subarray(6)), [{ id: 4, method: 'ping' }]);
});

test('rejects invalid JSON and invalid frame lengths', () => {
  const decoder = new FrameDecoder();
  const invalidJson = Buffer.from('{');
  const invalidJsonFrame = Buffer.alloc(4 + invalidJson.length);
  invalidJsonFrame.writeUInt32LE(invalidJson.length, 0);
  invalidJson.copy(invalidJsonFrame, 4);

  assert.throws(() => decoder.push(invalidJsonFrame), /invalid JSON/i);

  const zeroLength = Buffer.alloc(4);
  assert.throws(() => new FrameDecoder().push(zeroLength), /invalid frame length/i);

  const oversized = Buffer.alloc(4);
  oversized.writeUInt32LE(MAX_FRAME_BYTES + 1, 0);
  assert.throws(() => new FrameDecoder().push(oversized), /invalid frame length/i);
});
