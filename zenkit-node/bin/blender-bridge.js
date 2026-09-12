#!/usr/bin/env node
'use strict';

const { FrameDecoder, PROTOCOL_VERSION, encodeFrame } = require('../lib/blender-bridge/protocol');
const { createSession } = require('../lib/blender-bridge/session');

let session;
function getSession() {
  if (!session) session = createSession(require('../lib'));
  return session;
}
const decoder = new FrameDecoder();
let chain = Promise.resolve();

function write(value) { process.stdout.write(encodeFrame(value)); }
function handle(request) {
  const { id } = request;
  const respond = request.method === 'ping'
    ? Promise.resolve({ protocolVersion: PROTOCOL_VERSION, zenkitVersion: 'deferred' })
    : getSession().request(request);
  return respond.then((result) => write({ id, result }), (error) => write({ id, error: { message: error.message } }));
}

process.stdin.on('data', (chunk) => {
  try { for (const request of decoder.push(chunk)) chain = chain.then(() => handle(request)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; process.stdin.destroy(); }
});
