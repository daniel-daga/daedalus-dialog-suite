'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSession } = require('../lib/blender-bridge/session');
const { PROTOCOL_VERSION } = require('../lib/blender-bridge/protocol');

function fakeBinding() {
  const handle = { id: 'world' };
  const calls = [];
  return {
    handle,
    calls,
    zenkitVersion: () => 'test-zenkit',
    loadWorld: (path, game) => { assert.equal(game, 'g2'); assert.equal(path, 'world.zen'); return handle; },
    openVfs: (paths) => ({ paths }),
    extractWorldMesh: (actual) => { assert.equal(actual, handle); return { positions: new Float32Array([1, 2, 3]) }; },
    vobIndex: () => ({ count: 1, visuals: ['TREE.3DS'], rotations: new Float32Array([1]) }),
    extractVisual: (_vfs, name) => ({ name }),
    decodeTexture: (_vfs, name) => ({ name, pixels: new Uint8Array([1, 2]) }),
    getVobProps: (_world, path) => ({ class: 'zCVob', name: path }),
    setVobPosition: (...args) => calls.push(['position', ...args.slice(1)]),
    setVobRotation: (...args) => calls.push(['rotation', ...args.slice(1)]),
    setVobProp: (...args) => calls.push(['props', ...args.slice(1)]),
    setVobClassProp: (...args) => calls.push(['classProps', ...args.slice(1)]),
    insertVob: (...args) => { calls.push(['add', ...args.slice(1)]); return '0/2'; },
    reparentVob: (...args) => { calls.push(['reparent', ...args.slice(1)]); return '1'; },
    saveWorld: (...args) => calls.push(['save', ...args.slice(1)]),
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

test('applies VOB edits and saves only for the active session', async () => {
  const binding = fakeBinding();
  const session = createSession(binding);
  const { sessionId } = await session.request({ version: PROTOCOL_VERSION, method: 'openWorld', params: { path: 'world.zen', gameVersion: 'g2', assetSources: [] } });

  await session.request({ version: PROTOCOL_VERSION, method: 'setVobTransform', params: { sessionId, path: '0/1', position: [1, 2, 3], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] } });
  await session.request({ version: PROTOCOL_VERSION, method: 'setVobProperties', params: { sessionId, path: '0/1', props: { name: 'Tree' }, classProps: { range: 100 } } });
  const added = await session.request({ version: PROTOCOL_VERSION, method: 'addVob', params: { sessionId, parentPath: null, options: { position: [0, 0, 0] } } });
  const moved = await session.request({ version: PROTOCOL_VERSION, method: 'reparentVob', params: { sessionId, fromPath: '0/1', parentPath: null, slot: 0 } });
  await session.request({ version: PROTOCOL_VERSION, method: 'saveWorld', params: { sessionId, path: 'saved.zen' } });

  assert.deepEqual(binding.calls, [
    ['position', '0/1', [1, 2, 3]], ['rotation', '0/1', [1, 0, 0, 0, 1, 0, 0, 0, 1], undefined],
    ['props', '0/1', { name: 'Tree' }], ['classProps', '0/1', { range: 100 }],
    ['add', null, { position: [0, 0, 0] }], ['reparent', '0/1', null, 0], ['save', 'saved.zen'],
  ]);
  assert.equal(added.path, '0/2');
  assert.equal(moved.path, '1');
  await assert.rejects(session.request({ version: PROTOCOL_VERSION, method: 'saveWorld', params: { sessionId: 'stale', path: 'nope.zen' } }), /stale/i);
});
