'use strict';

// How many alpha functions do retail decals use? (level-editor.md §16.40, #262.)
//
// `decalAlphaFunc` selects a blend path, so it is material state rather than an
// instance attribute: drawing it means `buildDecalBillboards` groups by
// (texture, alphaFunc) instead of by texture. Whether that is worth doing rests
// on two numbers this script produces — how many distinct funcs retail decals
// carry at all, and how many groups the change would add over the texture
// grouping the draw budget was decided on.
//
//   node scripts/check-decal-alpha-funcs.js [--world <a.zen> ...]
//
// With no `--world` it reads the three retail worlds out of `worlds/`
// (`scripts/extract-worlds.js` rebuilds it from an installation), so this is
// developer-local; nothing in CI runs it. The tabulation is pure and covered by
// `test/decalAlphaFuncs.test.js`.

const fs = require('node:fs');
const path = require('node:path');

const { RETAIL_WORLDS } = require('./check-visual-types.js');

/** `zenkit::AlphaFunction`, by value. */
const ALPHA_FUNCS = ['DEFAULT', 'NONE', 'BLEND', 'ADD', 'SUBTRACT', 'MULTIPLY', 'MULTIPLY_ALT'];

/**
 * Tabulates decals given as `{ texture, alphaFunc, dimension? }`. `total` and
 * `byFunc` count every decal; the groups count only what `buildDecalBillboards`
 * draws — a texture named, and an area — keyed by the name verbatim, as it keys
 * them. `mixedTextures` are the textures the change would split.
 */
function tallyDecalAlphaFuncs(decals) {
  const byFunc = new Map();
  const funcsByTexture = new Map();

  for (const { texture, alphaFunc, dimension } of decals) {
    const func = ALPHA_FUNCS[alphaFunc] ?? String(alphaFunc);
    byFunc.set(func, (byFunc.get(func) ?? 0) + 1);

    const drawn = texture !== '' && (dimension === undefined || (dimension[0] > 0 && dimension[1] > 0));
    if (!drawn) continue;
    let funcs = funcsByTexture.get(texture);
    if (funcs === undefined) { funcs = new Set(); funcsByTexture.set(texture, funcs); }
    funcs.add(func);
  }

  let funcGroups = 0;
  const mixedTextures = [];
  for (const [texture, funcs] of funcsByTexture) {
    funcGroups += funcs.size;
    if (funcs.size > 1) mixedTextures.push(texture);
  }

  return {
    total: decals.length,
    byFunc: new Map([...byFunc].sort((a, b) => b[1] - a[1])),
    textureGroups: funcsByTexture.size,
    funcGroups,
    mixedTextures,
  };
}

/** Every decal of one world, read through `getVobProps` — the alpha function is
 *  in no index column, so this is one call per decal VOB. */
function worldDecals(zenkit, file) {
  const world = zenkit.loadWorld(file, 'g2');
  const index = zenkit.vobIndex(world);
  const parent = new Int32Array(index.parent);
  const childIndex = new Uint32Array(index.childIndex);
  const visualIndex = new Uint32Array(index.visualIndex);

  // `vobIndexPath`'s walk (zen-world `model/ops.ts`): slots, not VOB indices.
  const indexPath = (vob) => {
    const slots = [];
    for (let at = vob; at >= 0; at = parent[at]) slots.push(childIndex[at]);
    return slots.reverse().join('/');
  };

  return [...new Uint32Array(index.decalVobs)].map((vob) => {
    const { decal } = zenkit.getVobProps(world, indexPath(vob));
    return { texture: index.visuals[visualIndex[vob]], alphaFunc: decal.alphaFunc, dimension: decal.dimension };
  });
}

function parseArgs(argv) {
  const worlds = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--world') worlds.push(argv[i + 1]);
  }
  if (worlds.length > 0) return worlds;

  const dir = path.join(__dirname, '..', 'worlds');
  const missing = RETAIL_WORLDS.filter((name) => !fs.existsSync(path.join(dir, name)));
  if (missing.length > 0) {
    throw new Error(`missing from worlds/: ${missing.join(', ')} — run scripts/extract-worlds.js`);
  }
  return RETAIL_WORLDS.map((name) => path.join(dir, name));
}

function report(label, tally) {
  const funcs = [...tally.byFunc].map(([func, count]) => `${func} x${count}`).join('   ');
  console.log(`  ${label.padEnd(16)}${String(tally.total).padStart(6)} decals   ${funcs}`);
  console.log(`  ${''.padEnd(16)}groups: ${tally.textureGroups} by texture -> ${tally.funcGroups} by (texture, func)`
    + `   ${tally.mixedTextures.length} textures split`);
}

function main() {
  const zenkit = require('..');
  const worlds = parseArgs(process.argv.slice(2));

  const all = [];
  console.log();
  for (const world of worlds) {
    const decals = worldDecals(zenkit, world);
    all.push(...decals);
    report(path.basename(world), tallyDecalAlphaFuncs(decals));
  }
  if (worlds.length > 1) {
    const tally = tallyDecalAlphaFuncs(all);
    report('all', tally);
    if (tally.mixedTextures.length > 0) console.log(`\n  split: ${tally.mixedTextures.join(', ')}`);
  }
  console.log();
}

module.exports = { tallyDecalAlphaFuncs, ALPHA_FUNCS };

if (require.main === module) main();
