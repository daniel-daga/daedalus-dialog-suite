'use strict';

// Settles the one thing extractVisual deliberately does not claim: the
// triangle winding of a proto mesh (src/mesh_extract.cc ExtractProtoMesh emits
// the stored order, unreversed, with no claim attached).
//
// The measurement is coordinate-system-free on purpose. Whether a winding is
// "clockwise" depends on the handedness you read it in, and ZenGin space is
// not Three.js space — so asking that question here would just move the guess.
// What can be measured without choosing a basis is whether the geometric
// normal of a triangle taken in *stored index order*,
//
//     g = (p1 - p0) x (p2 - p0)
//
// points the same way as the outward normals ZenGin stored on that triangle's
// own wedges. Both live in the same basis, so their dot product is a fact
// about the data rather than about a convention. The renderer then only has to
// know its own front-face rule.
//
//   node scripts/check-visual-winding.js --root "<Gothic II>\_work\Data\Meshes" [--limit N]
//   node scripts/check-visual-winding.js --world "<...>\NewWorld\NewWorld.zen"
//
// `--world` runs the identical measurement over a world mesh, which reaches
// the data through zCMesh's vertex/feature indirection rather than MRM wedges.
// It is the cross-check: a unanimous result from one reader is as likely to be
// a sign error in this script as a fact about ZenGin, and two independent
// readers agreeing is what separates the two.
//
// Developer-local: it needs a real installation. Nothing in CI runs it.

const fs = require('node:fs');
const path = require('node:path');

const zenkit = require('..');

function parseArgs(argv) {
  const args = { root: null, world: null, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = argv[i + 1];
    else if (argv[i] === '--world') args.world = argv[i + 1];
    else if (argv[i] === '--limit') args.limit = Number(argv[i + 1]);
  }
  if (!args.root && !args.world) {
    throw new Error('usage: check-visual-winding.js (--root <dir of .MRM> | --world <a.zen>) [--limit N]');
  }
  return args;
}

function findProtoMeshes(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toUpperCase().endsWith('.MRM')) found.push(entry.name.toUpperCase());
    }
  };
  walk(root);
  return [...new Set(found)].sort();
}

// Below this the triangle has no usable geometric normal (a zero-area
// triangle) or its wedge normals cancel, and it says nothing either way.
const DEGENERATE = 1e-12;
// A dot product inside this band is too close to perpendicular to read as
// agreement or opposition; counted apart rather than rounded into a verdict.
const AMBIGUOUS = 0.1;

function measureChunk(chunk) {
  const positions = new Float32Array(chunk.positions);
  const normals = new Float32Array(chunk.normals);
  const indices = new Uint32Array(chunk.indices);
  const tally = { agree: 0, oppose: 0, ambiguous: 0, degenerate: 0 };

  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];

    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const g = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const s = [
      normals[a] + normals[b] + normals[c],
      normals[a + 1] + normals[b + 1] + normals[c + 1],
      normals[a + 2] + normals[b + 2] + normals[c + 2],
    ];

    const gLen = Math.hypot(...g);
    const sLen = Math.hypot(...s);
    if (gLen < DEGENERATE || sLen < DEGENERATE) {
      tally.degenerate += 1;
      continue;
    }

    const dot = (g[0] * s[0] + g[1] * s[1] + g[2] * s[2]) / (gLen * sLen);
    if (dot > AMBIGUOUS) tally.agree += 1;
    else if (dot < -AMBIGUOUS) tally.oppose += 1;
    else tally.ambiguous += 1;
  }

  return tally;
}

function report(total, meshes, label) {
  const decided = total.agree + total.oppose;
  console.log('');
  console.log(`${label} triangles: ${total.agree} agree, ${total.oppose} oppose, ` +
    `${total.ambiguous} ambiguous, ${total.degenerate} degenerate`);
  if (meshes !== null) {
    console.log(`meshes:    ${meshes.agree} all-agree, ${meshes.oppose} all-oppose, ` +
      `${meshes.mixed} mixed, ${meshes.undecided} undecided, ${meshes.failed} unreadable`);
  }
  if (decided > 0) {
    const share = ((100 * total.agree) / decided).toFixed(3);
    console.log(`RESULT: ${share}% of decidable triangles have (p1-p0)x(p2-p0) ` +
      'pointing along the stored normals.');
  }
}

function checkWorld(file) {
  const payload = zenkit.extractWorldMesh(zenkit.loadWorld(file, 'g2'));
  const total = { agree: 0, oppose: 0, ambiguous: 0, degenerate: 0 };
  for (const chunk of payload.chunks) {
    const tally = measureChunk(chunk);
    for (const key of Object.keys(total)) total[key] += tally[key];
  }
  report(total, null, `${path.basename(file)} world-mesh`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.world) {
    checkWorld(args.world);
    if (!args.root) return;
  }

  const names = findProtoMeshes(args.root).slice(0, args.limit);
  console.log(`${names.length} proto meshes under ${args.root}`);

  const vfs = zenkit.openVfs([args.root]);
  const total = { agree: 0, oppose: 0, ambiguous: 0, degenerate: 0 };
  const meshes = { agree: 0, oppose: 0, mixed: 0, undecided: 0, failed: 0 };

  for (const name of names) {
    let payload;
    try {
      payload = zenkit.extractVisual(vfs, name);
    } catch (error) {
      meshes.failed += 1;
      console.log(`  ! ${name}: ${error.message}`);
      continue;
    }
    if (payload === null) {
      meshes.failed += 1;
      continue;
    }

    const tally = { agree: 0, oppose: 0, ambiguous: 0, degenerate: 0 };
    for (const chunk of payload.chunks) {
      const chunkTally = measureChunk(chunk);
      for (const key of Object.keys(tally)) tally[key] += chunkTally[key];
    }
    for (const key of Object.keys(total)) total[key] += tally[key];

    if (tally.agree > 0 && tally.oppose > 0) meshes.mixed += 1;
    else if (tally.agree > 0) meshes.agree += 1;
    else if (tally.oppose > 0) meshes.oppose += 1;
    else meshes.undecided += 1;
  }

  report(total, meshes, 'proto-mesh');
}

main();
