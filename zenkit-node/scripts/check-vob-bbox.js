'use strict';

// What is a VOB's stored bounding box, exactly? (level-editor.md §7.)
//
// `setVobPosition` translates `bbox` by the same delta it moves the VOB,
// because the engine culls by that box and a moved VOB with a stale one may
// vanish. A **rotation** cannot be handled that way — an axis-aligned box does
// not rotate into an axis-aligned box — so before any `RotateVob` op exists,
// this asks the data what the box actually is:
//
//   - is it the tight world-space AABB of the VOB's own visual, placed by its
//     rotation and position? Then a rotation can recompute it exactly from the
//     visual, the result is a pure function of the transform, and the op stays
//     invertible: undo recomputes the same box it started from.
//   - or is it something looser or unrelated? Then re-fitting it is a guess,
//     and the honest move is to say so rather than write one.
//
// The comparison is made in **ZenGin space throughout** — the visual's own
// vertex positions, the VOB's rotation and position, and the stored box all
// live in the same basis, so no coordinate convention enters. It is exactly the
// discipline `check-visual-winding.js` uses for the same reason.
//
//   node scripts/check-vob-bbox.js --world "<...>\NewWorld\NewWorld.zen" \
//        --assets "<Gothic II>" [--limit N]
//
// Developer-local: it needs a real installation. Nothing in CI runs it.

const fs = require('node:fs');
const path = require('node:path');

const zenkit = require('..');

function parseArgs(argv) {
  const args = { world: null, install: null, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--world') args.world = argv[i + 1];
    else if (argv[i] === '--assets') args.install = argv[i + 1];
    else if (argv[i] === '--limit') args.limit = Number(argv[i + 1]);
  }
  if (!args.world || !args.install) {
    throw new Error('usage: check-vob-bbox.js --world <a.zen> --assets <Gothic II dir> [--limit N]');
  }
  return args;
}

/** The four VDFs `zen-world/assets` mounts, in its measured order. */
function assetSources(install) {
  const data = path.join(install, 'Data');
  const names = ['Worlds.vdf', 'Meshes.vdf', 'Textures.vdf', 'Anims.vdf'];
  const sources = [];
  for (const name of names) {
    for (const candidate of [name, `${name}.disabled`]) {
      const full = path.join(data, candidate);
      if (fs.existsSync(full)) { sources.push(full); break; }
    }
  }
  return sources;
}

/** The visual's own bounds, over every chunk, in the visual's own space. */
function visualBounds(payload) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const chunk of payload.chunks) {
    const positions = new Float32Array(chunk.positions);
    // An attachment hangs on a hierarchy node and carries that node's matrix
    // accumulated down the chain, row-major and deliberately *not* baked into
    // the positions. Skipping it puts a chest's lid at the chest's origin.
    const t = chunk.transform ? Array.from(new Float32Array(chunk.transform)) : null;

    for (let at = 0; at < positions.length; at += 3) {
      let [x, y, z] = [positions[at], positions[at + 1], positions[at + 2]];
      if (t) {
        [x, y, z] = [
          t[0] * x + t[1] * y + t[2] * z + t[3],
          t[4] * x + t[5] * y + t[6] * z + t[7],
          t[8] * x + t[9] * y + t[10] * z + t[11],
        ];
      }
      const p = [x, y, z];
      for (let axis = 0; axis < 3; axis += 1) {
        if (p[axis] < min[axis]) min[axis] = p[axis];
        if (p[axis] > max[axis]) max[axis] = p[axis];
      }
    }
  }

  return Number.isFinite(min[0]) ? { min, max } : null;
}

/** The world AABB of a box placed by a row-major rotation and a position. */
function placedBounds(bounds, rotation, position) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let corner = 0; corner < 8; corner += 1) {
    const local = [
      corner & 1 ? bounds.max[0] : bounds.min[0],
      corner & 2 ? bounds.max[1] : bounds.min[1],
      corner & 4 ? bounds.max[2] : bounds.min[2],
    ];
    for (let row = 0; row < 3; row += 1) {
      const value = rotation[row * 3] * local[0]
        + rotation[row * 3 + 1] * local[1]
        + rotation[row * 3 + 2] * local[2]
        + position[row];
      if (value < min[row]) min[row] = value;
      if (value > max[row]) max[row] = value;
    }
  }

  return { min, max };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const handle = zenkit.loadWorld(args.world, 'g2');
  const dump = zenkit.normalizeWorld(handle);
  const vfs = zenkit.openVfs(assetSources(args.install), { overwrite: 'all' });

  // One decode per distinct visual name: NewWorld's 23,288 VOBs name 445.
  const boundsOf = new Map();
  const bounds = (name) => {
    if (!boundsOf.has(name)) {
      const payload = zenkit.extractVisual(vfs, name);
      boundsOf.set(name, payload === null ? null : visualBounds(payload));
    }
    return boundsOf.get(name);
  };

  // The second question, and it is about the *whole* corpus rather than the
  // VOBs with a resolvable visual: `zCVob` stores a 3x3 and a position and has
  // no scale field, so the only way a scaled VOB could exist is a rotation
  // matrix whose columns are not unit length. Whether ZenGin honours one is not
  // something to reason about — but whether the retail worlds contain one is
  // measurable, and it is what decides whether a scale gizmo has anything to
  // write to.
  const scaled = { checked: 0, nonUnit: 0, worst: 0, worstVisual: null };

  const tally = {
    considered: 0, unresolved: 0, noBox: 0,
    tight: 0, loose: 0, tooSmall: 0, unrelated: 0,
  };
  const worst = [];
  let sumSlack = 0;

  for (const vob of dump.vobs) {
    // Every VOB, not only the ones with a visual: a scaled matrix anywhere in
    // the corpus is the whole answer.
    scaled.checked += 1;
    for (let col = 0; col < 3; col += 1) {
      const length = Math.hypot(vob.rotation[col], vob.rotation[col + 3], vob.rotation[col + 6]);
      const off = Math.abs(length - 1);
      if (off > scaled.worst) { scaled.worst = off; scaled.worstVisual = vob.visual || vob.className; }
      if (off > 0.001) { scaled.nonUnit += 1; break; }
    }

    if (tally.considered >= args.limit) break;
    // A level compo's visual is a slice of the compiled world mesh and must
    // never resolve; a decal names a texture and a .pfx is a script instance.
    if (vob.className === 'zCVobLevelCompo' || !vob.visual) continue;

    const local = bounds(vob.visual);
    if (local === null) { tally.unresolved += 1; continue; }

    const stored = vob.bbox;
    const size = Math.max(
      stored[3] - stored[0], stored[4] - stored[1], stored[5] - stored[2],
    );
    if (!(size > 0)) { tally.noBox += 1; continue; }

    tally.considered += 1;
    const fitted = placedBounds(local, vob.rotation, vob.position);

    // Signed slack per face: positive means the stored box is *outside* the
    // fitted one there, negative means it cuts the visual off.
    const slack = [
      fitted.min[0] - stored[0], fitted.min[1] - stored[1], fitted.min[2] - stored[2],
      stored[3] - fitted.max[0], stored[4] - fitted.max[1], stored[5] - fitted.max[2],
    ];
    const smallest = Math.min(...slack);
    const largest = Math.max(...slack);
    sumSlack += largest;

    // Relative to the VOB's own size: 1 cm on a torch is not 1 cm on a castle.
    const relative = largest / size;
    if (smallest < -0.5) tally.tooSmall += 1;
    else if (relative < 0.01) tally.tight += 1;
    else if (relative < 0.5) tally.loose += 1;
    else tally.unrelated += 1;

    worst.push({ vob: vob.className, visual: vob.visual, size, smallest, largest });
  }

  worst.sort((a, b) => Math.abs(b.smallest) - Math.abs(a.smallest));

  const row = (label, value) => console.log(`  ${String(label).padEnd(34)}${value}`);
  console.log(`\n${path.basename(args.world)} — stored VOB bbox vs. the visual placed by its own transform\n`);
  row('VOBs compared', tally.considered);
  row('  tight (<1% of the VOB size)', tally.tight);
  row('  loose (1-50% larger)', tally.loose);
  row('  much larger (>50%)', tally.unrelated);
  row('  SMALLER than the visual', tally.tooSmall);
  row('skipped — visual unresolved', tally.unresolved);
  row('skipped — stored box is empty', tally.noBox);
  row('mean slack, cm', (sumSlack / Math.max(1, tally.considered)).toFixed(2));

  console.log();
  row('VOB transforms checked', scaled.checked);
  row('  with a non-unit column (scaled)', scaled.nonUnit);
  row('  worst deviation from unit', scaled.worst.toExponential(2));
  row('  on', scaled.worstVisual ?? '—');

  console.log('\n  worst five by how far the stored box cuts into the visual:');
  for (const entry of worst.slice(0, 5)) {
    console.log(`    ${entry.visual.padEnd(38)}size ${entry.size.toFixed(0).padStart(6)}  `
      + `cuts ${entry.smallest.toFixed(1).padStart(8)}  slack ${entry.largest.toFixed(1)}`);
  }
  console.log();
}

main();
