'use strict';

const fs = require('node:fs');
const path = require('node:path');
const addon = require('node-gyp-build')(path.join(__dirname, '..'));
const { containerFromBuffer } = require('./container');

// The `container` section of a dump is computed from the archive BYTES the
// handle was loaded from (lib/container.js), so the source path is recorded
// per handle here — the native handle knows only the parsed structs.
const sourcePaths = new WeakMap();

function loadWorld(file, gameVersion) {
  const handle = addon.loadWorld(file, gameVersion);
  sourcePaths.set(handle, file);
  return handle;
}

// A mutation invalidates the recorded path: the handle's structs no longer match
// the bytes it was loaded from, so those bytes must not be reported as its
// container section. Re-save and load the result to get a container again.
function markMutated(handle) {
  sourcePaths.delete(handle);
}

function normalizeWorld(handle) {
  const dump = addon.normalizeWorld(handle);
  const source = sourcePaths.get(handle);
  dump.container = source === undefined ? null : containerFromBuffer(fs.readFileSync(source));
  return dump;
}

function setVobPosition(handle, ...rest) {
  const result = addon.setVobPosition(handle, ...rest);
  markMutated(handle);
  return result;
}

function setVobRotation(handle, ...rest) {
  const result = addon.setVobRotation(handle, ...rest);
  markMutated(handle);
  return result;
}

function setVobProp(handle, ...rest) {
  const result = addon.setVobProp(handle, ...rest);
  markMutated(handle);
  return result;
}

function insertVob(handle, ...rest) {
  const result = addon.insertVob(handle, ...rest);
  markMutated(handle);
  return result;
}

function deleteVob(handle, ...rest) {
  const result = addon.deleteVob(handle, ...rest);
  markMutated(handle);
  return result;
}

function reparentVob(handle, ...rest) {
  const result = addon.reparentVob(handle, ...rest);
  markMutated(handle);
  return result;
}

function insertItemVob(handle, ...rest) {
  const result = addon.insertItemVob(handle, ...rest);
  markMutated(handle);
  return result;
}

module.exports = {
  ...addon,
  loadWorld, normalizeWorld,
  setVobPosition, setVobRotation, setVobProp,
  insertVob, deleteVob, reparentVob, insertItemVob,
};
