'use strict';

// One-off converter: vobbilder's hand-authored category tree → the seed the
// asset browser ships (level-editor.md §16.26, "Wanted on top").
//
//   node scripts/convert-vobbilder.js <path-to-vobbilder> [out.json]
//
// vobbilder ("VOB-Katalog", Felix Horn aka HornOx, devmode.de) is a static
// HTML+JS Spacer-era catalogue. Its data file `neue_daten.js` is cp1252 and
// declares, per category path, an array of 4-tuples:
//
//   vobs["Items/Schwerter"] = new Array(new Array(dir, baseName, view, games), …)
//
// `dir` is the tool's own thumbnail directory (`g2/items/it_weapons/`),
// `baseName` the `.3DS` source name without extension, `view` the index of
// the preferred thumbnail angle (0 oben, 1 vorn, 2 links, 3 perspektive) and
// `games` a bit set — 1 Gothic 1, 2 Gothic II, 4 the author's own. Only the
// category path and the base name are taken, and only entries with the G2
// bit: the editor renders its own thumbnails, and G1 is not installed here.
//
// The result is checked in as `src/shared/assetCategorySeed.json`; the tool
// itself and its images are not shipped.

const fs = require('node:fs');
const path = require('node:path');

const [, , toolDir, outArg] = process.argv;
if (!toolDir) {
  console.error('usage: node scripts/convert-vobbilder.js <vobbilder dir> [out.json]');
  process.exit(2);
}
const out = outArg ?? path.join(__dirname, '..', 'src', 'shared', 'assetCategorySeed.json');

const source = new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(toolDir, 'neue_daten.js')));
// The file is plain assignments into a `vobs` array; evaluating it in a
// function scope with `Array` in reach is the whole parse.
const vobs = {};
new Function('vobs', source)(vobs);

const G2 = 2;
const categories = [];
for (const [categoryPath, entries] of Object.entries(vobs)) {
  const visuals = [];
  for (const [, baseName, , games] of entries) {
    if (!(games & G2)) continue;
    const name = `${String(baseName).toUpperCase()}.3DS`;
    if (!visuals.includes(name)) visuals.push(name);
  }
  visuals.sort();
  if (visuals.length > 0) categories.push({ path: categoryPath, visuals });
}

const seed = {
  $source: 'Converted from vobbilder ("VOB-Katalog") by Felix Horn aka HornOx, '
    + 'http://devmode.de/gothic/vobbilder/ — category tree and Gothic II entries only, '
    + `by scripts/convert-vobbilder.js. ${categories.length} categories, `
    + `${categories.reduce((n, c) => n + c.visuals.length, 0)} entries.`,
  version: 1,
  categories,
};

fs.writeFileSync(out, `${JSON.stringify(seed, null, 2)}\n`);
console.log(`${out}: ${seed.$source}`);
