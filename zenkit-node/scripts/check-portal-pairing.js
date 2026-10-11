'use strict';

// Does every `P:A_B` have its `P:B_A`? (level-editor.md §16.22, question 1.)
//
// §16.18 shipped the portal *material* checks because their rules came out of
// counting retail, and left the pairing check unwritten for exactly the
// measurement this script makes. ZenGin marks a portal face with a material
// named `P:<sector>_<sector>`, one name per direction; whether the reverse name
// is always there decides what a missing one means. If retail is 100% paired,
// an unpaired name is worth a warning. If retail itself carries one-sided
// portals, there is no check to write — and saying so is the honest outcome
// (§16.22, "a measurement is allowed to kill its own check").
//
// Name work only: `mesh.materials` and `bsp.sectorNames` out of
// `normalizeWorld`, the same two lists `checkPortalMaterials` reads. No
// geometry, so nothing here depends on the planarity or orientation questions.
//
//   node scripts/check-portal-pairing.js --world "<...>\OldWorld\OldWorld.zen"
//
// Developer-local: it needs a real installation. Nothing in CI runs it.

const path = require('node:path');

/** The two sides of `P:A_B`, uppercased, or null when the name is not that. */
function sidesOf(material) {
  const upper = material.toUpperCase();
  if (!upper.startsWith('P:')) return null;
  const sides = upper.slice(2).split('_');
  if (sides.length !== 2 || (!sides[0] && !sides[1])) return null;
  return sides;
}

/**
 * Count portal materials against their mirrors. Case-insensitive and
 * malformed-tolerant, exactly as `checkPortalMaterials` is: a name it calls
 * malformed has no mirror to look for and is counted apart rather than
 * reported as unpaired.
 */
function pairPortalMaterials(materials) {
  const malformed = [];
  const seen = new Map(); // "A_B" -> { material, count }

  for (const material of materials) {
    if (!material.toUpperCase().startsWith('P:')) continue;
    const sides = sidesOf(material);
    if (sides === null) { malformed.push(material); continue; }

    const key = sides.join('_');
    const entry = seen.get(key);
    if (entry) entry.count += 1;
    else seen.set(key, { material, count: 1 });
  }

  const unpaired = [];
  let pairs = 0;
  let selfPaired = 0;
  let repeated = 0;

  for (const [key, entry] of seen) {
    repeated += entry.count - 1;
    const [a, b] = key.split('_');
    const mirror = `${b}_${a}`;
    if (mirror === key) { selfPaired += 1; pairs += 1; continue; }
    if (!seen.has(mirror)) {
      unpaired.push({ material: entry.material, wanted: `P:${mirror}` });
      continue;
    }
    // Count each two-sided portal once, from the side that sorts first.
    if (key < mirror) pairs += 1;
  }

  return {
    portalMaterials: malformed.length + [...seen.values()].reduce((n, e) => n + e.count, 0),
    distinct: seen.size,
    repeated,
    pairs,
    selfPaired,
    unpaired,
    malformed,
  };
}

function parseArgs(argv) {
  let world = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--world') world = argv[i + 1];
  }
  if (!world) throw new Error('usage: check-portal-pairing.js --world <a.zen>');
  return { world };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const zenkit = require('..');

  const dump = zenkit.normalizeWorld(zenkit.loadWorld(args.world, 'g2'));
  const result = pairPortalMaterials(dump.mesh.materials);

  const row = (label, value) => console.log(`  ${String(label).padEnd(34)}${value}`);
  console.log(`\n${path.basename(args.world)} — portal materials against their mirrors\n`);
  row('sectors', dump.bsp.sectorNames.length);
  row('materials', dump.mesh.materials.length);
  row('  named P:', result.portalMaterials);
  row('  distinct names', result.distinct);
  row('  repeated entries', result.repeated);
  row('two-way pairs', result.pairs);
  row('  of them symmetric (P:A_A)', result.selfPaired);
  row('names with no mirror', result.unpaired.length);
  row('malformed names', result.malformed.length);

  for (const entry of result.unpaired) {
    console.log(`    ${entry.material.padEnd(30)} wants ${entry.wanted}`);
  }
  for (const material of result.malformed) {
    console.log(`    malformed: ${material}`);
  }
}

module.exports = { sidesOf, pairPortalMaterials };

if (require.main === module) main();
