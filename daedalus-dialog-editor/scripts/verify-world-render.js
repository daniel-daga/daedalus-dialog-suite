#!/usr/bin/env node
/**
 * Look at the ground, in the real app, and say whether it is there
 * (level-editor.md §7, "triangle winding").
 *
 * Developer-local, like `verify-world-edit.js` and `measure-viewport.js`: it
 * needs a Gothic install, the built native addon and a GPU. Unlike them it
 * asserts nothing about the *model* — it reads the pixels the GPU produced.
 *
 *   npm run build            # renderer AND main; this drives the built app
 *   node scripts/verify-world-render.js
 *   node scripts/verify-world-render.js --point 41183,3305,1306
 *
 * **Why pixels, and why this project owes this script one.** The winding defect
 * (5ce4dae) drew every floor in the world transparent from above and every VOB
 * inside out. It was visible the instant anyone looked, and it survived a full
 * green suite for the whole of Phase 1a — because every test that could have
 * caught it looked at one half of the rule. The mirror inverts the rasteriser's
 * front/back test; Three.js cancels that per object; the two compose, and a test
 * of either half endorses whatever the code does. Reading an index buffer back,
 * or a matrix's determinant, is exactly what passed while the world was
 * inside-out. So the only witness that is not a restatement of the code is the
 * frame, and the only question that cannot be answered from either half alone is
 * the one a human answered by looking: **is the ground opaque from above?**
 *
 * **Both halves of it, because one is not enough.** The camera is put directly
 * over a patch of open ground — found in the world by `openGround` below, not
 * written down — and then directly under the same patch:
 *
 *   from above — the ground must be drawn:  the frame is full
 *   from below — the same ground must not:  there is sky in the frame
 *
 * A single view says only that *something* was drawn. The pair is the winding
 * statement itself, and reversing the winding swaps the two answers rather than
 * losing one — so this fails loudly with `threeIndexOrder` reverted. It is also
 * what rules out the fix nobody should reach for: `DoubleSide`, or a material
 * lying about `side`, passes the view from above and fails the view from below.
 *
 * Reads the world; writes both frames to a temp directory, never into the
 * install. The .png is the evidence — the assertion above it is the test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

function arg(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const INSTALL = arg('install', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Gothic II');
const WORLD = arg('world', path.join(INSTALL, '_work', 'Data', 'Worlds', 'NewWorld', 'NewWorld.zen'));
const POINT = arg('point', null);
/** ZenGin centimetres: 20 m up is close enough that the ground fills the frame,
 *  and 5 m down is under a surface that is a single-sided shell. */
const ABOVE = 2000;
const BELOW = 500;
/** How much ground the middle of the frame covers from 20 m up, near enough. */
const REACH = 700;
/** Clear of anything else this far above and this far below (ZenGin cm). */
const CLEARANCE = 3000;
/** `scene.background`, which is what a culled triangle leaves behind. */
const CLEAR = [0x10, 0x14, 0x1c];
/** Only the middle of the frame: the edges of a 70° view from 20 m up are
 *  looking sideways at whatever else the world has, and the claim here is about
 *  the surface the camera is pointed at. */
const CENTRE = 0.5;
/** Never inside the Gothic install. */
const SHOTS = os.tmpdir();

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

/**
 * The share of the centre of a frame that is the clear colour — i.e. that has
 * nothing drawn on it.
 *
 * The tolerance is per channel and small: `antialias` is off and the clear
 * colour goes through the output colour-space conversion, so an untouched pixel
 * comes back as itself give or take a rounding step. Any lit ground texture is
 * nowhere near it.
 */
function emptyShare({ width, height, rgba }) {
  const pixels = Buffer.from(rgba, 'base64');
  const x0 = Math.floor((width * (1 - CENTRE)) / 2);
  const y0 = Math.floor((height * (1 - CENTRE)) / 2);
  const x1 = width - x0;
  const y1 = height - y0;

  let empty = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const at = (y * width + x) * 4;
      total++;
      if (CLEAR.every((value, i) => Math.abs(pixels[at + i] - value) <= 2)) empty++;
    }
  }
  return empty / total;
}

/**
 * A patch of world mesh with open sky above it and 30 m of nothing below —
 * read out of the world here, in this process, through the binding.
 *
 * **Derived rather than written down, because the assertion depends on it.**
 * "The ground is opaque from above" only means anything where the ground is the
 * only thing on that line: over a roof in Khorinis, a culled floor reveals the
 * room below and the frame stays just as full, and the check would pass on a
 * world drawn inside out. The first point tried here was one such — measured.
 * So a candidate is accepted only when a vertical line through it, and through
 * eight points on a 7 m ring around it, meets the world mesh exactly once.
 *
 * Up-facing triangles only, and every 313th of them, which walks the whole
 * island rather than one corner of it.
 */
function openGround(mesh) {
  const triangles = [];
  for (const chunk of mesh.chunks) {
    const positions = new Float32Array(chunk.positions);
    const normals = new Float32Array(chunk.normals);
    const indices = new Uint32Array(chunk.indices);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      triangles.push([
        positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2],
        positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2],
        positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2],
        (normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1]) / 3,
      ]);
    }
  }

  /** Every height at which the vertical line through (x, z) meets the mesh. */
  const heightsAt = (x, z) => {
    const heights = [];
    for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of triangles) {
      // Inside the triangle in plan view: the three edge cross-products agree.
      const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
      const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
      const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
      if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;

      const [ux, uy, uz] = [bx - ax, by - ay, bz - az];
      const [vx, vy, vz] = [cx - ax, cy - ay, cz - az];
      const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      if (Math.abs(ny) < 1e-9) continue;   // a wall, seen edge-on from above
      heights.push(ay + (nx * (ax - x) + nz * (az - z)) / ny);
    }
    return heights;
  };

  const ring = [[0, 0]];
  for (let k = 0; k < 8; k++) {
    ring.push([Math.cos((k * Math.PI) / 4) * REACH, Math.sin((k * Math.PI) / 4) * REACH]);
  }

  for (let i = 0; i < triangles.length; i += 313) {
    const t = triangles[i];
    if (t[9] < 0.95) continue;   // not flat ground
    const point = [(t[0] + t[3] + t[6]) / 3, (t[1] + t[4] + t[7]) / 3, (t[2] + t[5] + t[8]) / 3];

    const clear = ring.every(([dx, dz]) => heightsAt(point[0] + dx, point[2] + dz)
      .every((y) => Math.abs(y - point[1]) < 200 || y < point[1] - CLEARANCE));
    if (clear) return point;
  }
  throw new Error('no open ground found in this world — pass one with --point');
}

async function main() {
  for (const [what, where] of [['install', INSTALL], ['world', WORLD]]) {
    if (!fs.existsSync(where)) throw new Error(`No ${what} at ${where}`);
  }

  const zenkit = require('zenkit-node');
  const point = POINT === null
    ? openGround(zenkit.extractWorldMesh(zenkit.loadWorld(WORLD, 'g2')))
    : POINT.split(',').map(Number);

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'world-render-'));
  fs.writeFileSync(path.join(project, 'world.d'), '// render fixture\n');

  const app = await electron.launch({ args: ['.'], cwd: path.join(__dirname, '..') });

  // Matched on exact titles: "Select Gothic Mod Project Folder" also contains
  // "Gothic", and answering it with the installation directory opens the whole
  // Gothic install as the editor's project.
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (options) => {
      switch (options.title) {
        case 'Open a ZenGin world': return { canceled: false, filePaths: [paths.world] };
        case 'Select the Gothic installation directory':
          return { canceled: false, filePaths: [paths.install] };
        case 'Select Gothic Mod Project Folder': return { canceled: false, filePaths: [paths.project] };
        default: throw new Error(`unexpected dialog: ${options.title}`);
      }
    };
  }, { world: WORLD, install: INSTALL, project });

  const page = await app.firstWindow();
  page.setDefaultTimeout(180_000);
  page.on('console', (message) => {
    if (/error|Error/.test(message.text())) console.error('  [renderer]', message.text());
  });

  await page.getByRole('button', { name: /Open Project/i }).first().click();
  await page.getByTestId('world-toggle').click();
  await page.getByTestId('world-choose-install').click();
  await page.getByTestId('world-install-path').waitFor();

  console.log(`opening ${path.basename(WORLD)} …`);
  await page.getByTestId('world-open').click();
  await page.getByTestId('world-viewport').waitFor();
  await page.waitForFunction(() => globalThis.__worldViewport !== undefined);

  // `renderFrom` waits for the BVH and every texture before it draws — no sleep
  // stands in for that, because a half-loaded scene is a different scene.
  const look = async (from, at, name) => {
    const frame = await page.evaluate(
      ([eye, target]) => globalThis.__worldViewport.renderFrom(eye, target),
      [from, at],
    );
    // The camera stays where the frame was taken, so this .png is that frame.
    const shot = path.join(SHOTS, `verify-world-render-${name}-${process.pid}.png`);
    await page.getByTestId('world-viewport').screenshot({ path: shot });
    return { empty: emptyShare(frame), size: `${frame.width}x${frame.height}`, shot };
  };

  const [x, y, z] = point;
  const down = await look([x, y + ABOVE, z], [x, y, z], 'from-above');
  const up = await look([x, y - BELOW, z], [x, y, z], 'from-below');

  // ── the whole test ────────────────────────────────────────────────────────
  //
  // The thresholds are measured, not guessed. With `threeIndexOrder` reverted —
  // which is the 5ce4dae defect exactly — this run reports:
  //
  //   from above   100.0% covered  ->   65.8% covered
  //   from below    15.2% empty    ->    0.0% empty
  //
  // From above, the ground is the only thing on that line and it is 20 m away,
  // so a frame that is anything but full means it was culled: the third of the
  // frame that goes clear under the sabotage is the sky, seen straight through
  // the floor of the world, with the far side of the island around it.
  //
  // From below, the surface 5 m overhead subtends the entire view — every ray
  // in the upper hemisphere meets it — so if it were drawn there would be no
  // sky at all, which is what the sabotaged run measures. Any clear pixel is
  // proof it was culled. That is the half a `DoubleSide` "fix" fails, and it is
  // why one view is not enough: seen from above alone, a world drawn on both
  // sides is indistinguishable from a world drawn on the right one.
  check(down.empty < 0.01,
    `the ground is not there from above: ${(down.empty * 100).toFixed(1)}% of the frame is `
    + `the clear colour — the world mesh is being drawn from the inside (${down.shot})`);
  check(up.empty > 0.05,
    `the ground is drawn from below too: ${(up.empty * 100).toFixed(1)}% of the frame is `
    + `the clear colour, and a surface 5 m overhead leaves none (${up.shot})`);

  const row = (label, value) => console.log(`  ${String(label).padEnd(22)}${value}`);
  console.log(`\n${path.basename(WORLD)} — the ground, looked at\n`);
  row('Open ground at', `${point.map(Math.round).join(', ')}${POINT === null ? '' : ' (given)'}`);
  row('Frame', down.size);
  row(`From ${ABOVE / 100} m above`, `${(100 - down.empty * 100).toFixed(1)}% covered — ${down.shot}`);
  row(`From ${BELOW / 100} m below`, `${(up.empty * 100).toFixed(1)}% empty — ${up.shot}`);

  await app.close();
  fs.rmSync(project, { recursive: true, force: true });
  report();
}

function report() {
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nGround OK.');
}

main().catch((error) => { console.error('FAILED:', error); process.exit(1); });
