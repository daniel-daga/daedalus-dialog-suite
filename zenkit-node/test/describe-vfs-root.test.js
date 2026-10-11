'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { resolveInstallSources } = require('../scripts/describe-vfs-root');

test('install source resolution uses the repository zen-world workspace', () => {
  const available = new Set([
    'C:/Gothic II/Data/Textures.vdf',
    'C:/Gothic II/_work/Data/Meshes/_compiled',
  ]);

  assert.deepEqual(
    resolveInstallSources('C:\\Gothic II', [], (candidate) => available.has(candidate)),
    [
      path.normalize('C:/Gothic II/Data/Textures.vdf'),
      path.normalize('C:/Gothic II/_work/Data/Meshes/_compiled'),
    ],
  );
});
