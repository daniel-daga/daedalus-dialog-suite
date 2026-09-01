'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');
const { FrameDecoder, PROTOCOL_VERSION, encodeFrame } = require('../lib/blender-bridge/protocol');

test('bridge process answers a framed ping', async () => {
  const child = spawn(process.execPath, ['bin/blender-bridge.js'], { cwd: __dirname + '/..', stdio: ['pipe', 'pipe', 'pipe'] });
  const decoder = new FrameDecoder();
  const response = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { const frames = decoder.push(chunk); if (frames[0]) resolve(frames[0]); });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`bridge exited before responding (${code})`)));
  });
  child.stdin.write(encodeFrame({ id: 1, version: PROTOCOL_VERSION, method: 'ping' }));
  const result = await response;
  assert.equal(result.id, 1);
  assert.equal(result.result.protocolVersion, PROTOCOL_VERSION);
  child.stdin.end();
  await once(child, 'exit');
});
