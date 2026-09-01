'use strict';

const { randomUUID } = require('node:crypto');
const { PROTOCOL_VERSION } = require('./protocol');

function serialize(value) {
  if (ArrayBuffer.isView(value)) {
    return {
      type: value.constructor.name,
      base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    };
  }
  if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', base64: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  return value;
}

function createSession(zenkit) {
  let current;
  function requireSession(sessionId) {
    if (!current || current.id !== sessionId) throw new Error('unknown or stale Blender bridge session');
    return current;
  }
  return {
    async request(request) {
      if (!request || request.version !== PROTOCOL_VERSION) throw new Error(`unsupported bridge protocol version ${request?.version}`);
      const { method, params = {} } = request;
      if (method === 'ping') return { protocolVersion: PROTOCOL_VERSION, zenkitVersion: zenkit.zenkitVersion() };
      if (method === 'openWorld') {
        const { path, gameVersion, assetSources = [] } = params;
        if (typeof path !== 'string' || !['g1', 'g2'].includes(gameVersion) || !Array.isArray(assetSources)) throw new TypeError('invalid openWorld parameters');
        const world = zenkit.loadWorld(path, gameVersion);
        const vfs = assetSources.length === 0 ? null : zenkit.openVfs(assetSources);
        const vobIndex = zenkit.vobIndex(world);
        current = { id: randomUUID(), world, vfs, path };
        return serialize({ sessionId: current.id, worldMesh: zenkit.extractWorldMesh(world), vobIndex, visualNames: [...new Set(vobIndex.visuals.filter(Boolean))] });
      }
      const session = requireSession(params.sessionId);
      if (method === 'getVisual') return serialize(zenkit.extractVisual(session.vfs, params.name));
      if (method === 'getTexture') return serialize(zenkit.decodeTexture(session.vfs, params.name, params.level ?? 0));
      throw new Error(`unknown Blender bridge method ${method}`);
    },
  };
}

module.exports = { createSession, serialize };
