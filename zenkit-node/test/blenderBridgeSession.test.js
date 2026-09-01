'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSession } = require('../lib/blender-bridge/session');
const { PROTOCOL_VERSION } = require('../lib/blender-bridge/protocol');

function fakeBinding() {
  const handle = { id: 'world' };
  return {
    handle,
    zenkitVersion: () => 'test-zenkit',
    loadWorld: (path, game) => { assert.equal(game, 'g2'); assert.equal(path, 'world.zen'); return handle; },
    openVfs: (paths) => ({ paths }),
    extractWorldMesh: (actual) => { assert.equal(actual, handle); return { positions: new Float32Array([1, 2, 3]) }; },
    vobIndex: () => ({ count: 1, visuals: ['TREE.3DS'], rotations: new Float32Array([1]) }),
    extractVisual: (_vfs, name) => ({ name }),
    decodeTexture: (_vfs, name) => ({ name, pixels: new Uint8Array([1, 2]) }),
  };
}

test('rejects a protocol mismatch and reports bridge identity', async () => {
  const session = createSession(fakeBinding());
  await assert.rejects(session.request({ version: 999, method: 'ping' }), /protocol/i);
  assert.deepEqual(await session.request({ version: PROTOCOL_VERSION, method: 'ping' }), {
    protocolVersion: PROTOCOL_VERSION, zenkitVersion: 'test-zenkit',
  });
});

test('opens a world projection and serializes typed arrays', async () => {
  const session = createSession(fakeBinding());
  const result = await session.request({
    version: PROTOCOL_VERSION, method: 'openWorld', params: { path: 'world.zen', gameVersion: 'g2', assetSources: ['assets'] },
  });

  assert.match(result.sessionId, /^[a-f0-9-]+$/);
  assert.deepEqual(result.worldMesh.positions, { type: 'Float32Array', base64: Buffer.from(new Float32Array([1, 2, 3]).buffer).toString('base64') });
  assert.deepEqual(result.vobIndex.rotations, { type: 'Float32Array', base64: Buffer.from(new Float32Array([1]).buffer).toString('base64') });
  assert.deepEqual(result.visualNames, ['TREE.3DS']);
});

test('loads visuals and textures lazily for the active session', async () => {
  const session = createSession(fakeBinding());
  const { sessionId } = await session.request({ version: PROTOCOL_VERSION, method: 'openWorld', params: { path: 'world.zen', gameVersion: 'g2', assetSources: [] } });
  assert.deepEqual(await session.request({ version: PROTOCOL_VERSION, method: 'getVisual', params: { sessionId, name: 'TREE.3DS' } }), { name: 'TREE.3DS' });
  const texture = await session.request({ version: PROTOCOL_VERSION, method: 'getTexture', params: { sessionId, name: 'TREE.TGA' } });
  assert.deepEqual(texture.pixels, { type: 'Uint8Array', base64: 'AQI=' });
});
