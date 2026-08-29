'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');
const { extractWorlds } = require('../scripts/extract-worlds.js');

// A loose directory mounts like an archive, so the walk, the flattening and
// the collision rule are exercised without a retail VDF; the retail read
// itself is covered in assets.test.js (vfsRead, gated on the install).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-extract-'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const bytes = (seed) => Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * seed) & 0xff));

const SOURCE = path.join(root, 'source');
const OLD = bytes(3);
const NEW = bytes(11);
fs.mkdirSync(path.join(SOURCE, '_WORK', 'DATA', 'WORLDS', 'OLDWORLD'), { recursive: true });
fs.mkdirSync(path.join(SOURCE, '_WORK', 'DATA', 'WORLDS', 'NEWWORLD'), { recursive: true });
fs.writeFileSync(path.join(SOURCE, '_WORK', 'DATA', 'WORLDS', 'OLDWORLD', 'OLDWORLD.ZEN'), OLD);
fs.writeFileSync(path.join(SOURCE, '_WORK', 'DATA', 'WORLDS', 'NEWWORLD', 'NEWWORLD.ZEN'), NEW);
fs.writeFileSync(path.join(SOURCE, '_WORK', 'DATA', 'WORLDS', 'README.TXT'), 'not a world');

test.after(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // A live VFS keeps mounted files mapped; Windows may refuse the delete.
  }
});

test('extractWorlds writes every .ZEN in the tree flat into outDir, and nothing else', () => {
  const out = path.join(root, 'out');
  const worlds = extractWorlds(zenkit, [SOURCE], out);

  assert.deepStrictEqual(worlds.map((w) => w.name), ['NEWWORLD.ZEN', 'OLDWORLD.ZEN']);
  assert.deepStrictEqual(fs.readdirSync(out).sort(), ['NEWWORLD.ZEN', 'OLDWORLD.ZEN']);
  assert.strictEqual(sha256(fs.readFileSync(path.join(out, 'NEWWORLD.ZEN'))), sha256(NEW));
  assert.strictEqual(sha256(fs.readFileSync(path.join(out, 'OLDWORLD.ZEN'))), sha256(OLD));

  const newWorld = worlds.find((w) => w.name === 'NEWWORLD.ZEN');
  assert.strictEqual(newWorld.size, NEW.length);
  assert.strictEqual(newWorld.sha256, sha256(NEW));
  assert.strictEqual(newWorld.path, '_WORK/DATA/WORLDS/NEWWORLD/NEWWORLD.ZEN');
  assert.strictEqual(newWorld.file, path.join(out, 'NEWWORLD.ZEN'));
});

test('extractWorlds takes the later source for a world both sources carry', () => {
  // Worlds.vdf then Worlds_Addon.vdf: the addon's NewWorld is the one that
  // ships, and it is the reason the default mounts the addon volume last.
  const addon = path.join(root, 'addon');
  const ADDON_NEW = bytes(29);
  fs.mkdirSync(path.join(addon, '_WORK', 'DATA', 'WORLDS', 'NEWWORLD'), { recursive: true });
  fs.writeFileSync(path.join(addon, '_WORK', 'DATA', 'WORLDS', 'NEWWORLD', 'NEWWORLD.ZEN'), ADDON_NEW);

  const out = path.join(root, 'out-addon');
  const worlds = extractWorlds(zenkit, [SOURCE, addon], out);
  assert.deepStrictEqual(worlds.map((w) => w.name), ['NEWWORLD.ZEN', 'OLDWORLD.ZEN']);
  assert.strictEqual(sha256(fs.readFileSync(path.join(out, 'NEWWORLD.ZEN'))), sha256(ADDON_NEW));
});

test('extractWorlds refuses two worlds of one name in different directories', () => {
  // A flat output would silently keep one of them; the retail archives never
  // do this, so it is an error worth stopping on rather than a case to resolve.
  const twins = path.join(root, 'twins');
  fs.mkdirSync(path.join(twins, 'A'), { recursive: true });
  fs.mkdirSync(path.join(twins, 'B'), { recursive: true });
  fs.writeFileSync(path.join(twins, 'A', 'TWIN.ZEN'), bytes(5));
  fs.writeFileSync(path.join(twins, 'B', 'TWIN.ZEN'), bytes(7));

  const out = path.join(root, 'out-twins');
  assert.throws(() => extractWorlds(zenkit, [twins], out), /two worlds named TWIN\.ZEN/);
  assert.ok(!fs.existsSync(out));
});
