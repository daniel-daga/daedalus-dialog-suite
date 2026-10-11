'use strict';
// Pulls every .ZEN out of the retail world archives into one flat directory,
// so the measurement scripts (`--world <a.zen>`) and tools/mutate.js have a
// corpus without an extraction into the install's `_work` tree. The install
// stays stock: the archives are opened read-only, nothing is renamed, and the
// six-VDF `.disabled` layout the old harness needed is gone with it.
//
//   node scripts/extract-worlds.js [outDir] [source ...]
//
//   outDir   default zenkit-node/worlds (gitignored)
//   source   VDF archives or loose directories, mounted in order, later ones
//            winning. Default: <Gothic II>/Data/Worlds.vdf then
//            Worlds_Addon.vdf — addon LAST, because Worlds.vdf alone yields a
//            pre-addon NewWorld with a different hash. <Gothic II> is
//            ZENKIT_G2_ROOT or the Steam default.
//
// The output is flat because every consumer takes a file path and the retail
// names are unique; two entries sharing a name is an error, not a silent
// overwrite.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const NEWWORLD_SHA256 = 'b4dac8674be44820d63e5bdaf63525b8e7ca1a0ad50d62a2e3e1fe905cb8d4b5';

function walk(zenkit, handle, dir, out) {
  for (const entry of zenkit.vfsList(handle, dir) ?? []) {
    const at = dir === '/' ? entry.name : `${dir}/${entry.name}`;
    if (entry.type === 'directory') walk(zenkit, handle, at, out);
    else if (/\.zen$/i.test(entry.name)) out.push({ name: entry.name, path: at });
  }
  return out;
}

function extractWorlds(zenkit, sources, outDir) {
  const handle = zenkit.openVfs(sources);
  const found = walk(zenkit, handle, '/', []);

  const seen = new Map();
  for (const world of found) {
    const key = world.name.toUpperCase();
    if (seen.has(key)) {
      throw new Error(`two worlds named ${world.name}: ${seen.get(key)} and ${world.path}`);
    }
    seen.set(key, world.path);
  }

  fs.mkdirSync(outDir, { recursive: true });
  return found
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((world) => {
      const bytes = zenkit.vfsRead(handle, world.name);
      const file = path.join(outDir, world.name);
      fs.writeFileSync(file, bytes);
      return {
        name: world.name,
        path: world.path,
        file,
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
    });
}

function main() {
  const zenkit = require('..');
  const root = process.env.ZENKIT_G2_ROOT
    || 'C:/Program Files (x86)/Steam/steamapps/common/Gothic II';
  const outDir = process.argv[2] || path.join(__dirname, '..', 'worlds');
  const sources = process.argv.length > 3
    ? process.argv.slice(3)
    : ['Worlds.vdf', 'Worlds_Addon.vdf'].map((name) => path.join(root, 'Data', name));

  const worlds = extractWorlds(zenkit, sources, outDir);
  console.log(`${worlds.length} worlds -> ${outDir}\n`);
  for (const world of worlds) {
    console.log(`  ${world.name.padEnd(28)}${String(world.size).padStart(11)}  ${world.sha256.slice(0, 16)}`);
  }

  const newWorld = worlds.find((world) => world.name.toUpperCase() === 'NEWWORLD.ZEN');
  if (newWorld) {
    console.log(newWorld.sha256 === NEWWORLD_SHA256
      ? '\nNEWWORLD.ZEN is the addon world the engine harness has always hashed.'
      : '\nNEWWORLD.ZEN does NOT match the recorded addon hash - was Worlds_Addon.vdf mounted last?');
  }
}

if (require.main === module) main();

module.exports = { extractWorlds, NEWWORLD_SHA256 };
