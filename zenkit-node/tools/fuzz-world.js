'use strict';
// Seeded corruption fuzzer for the world reader (`docs/plans/level-editor.md`
// §16.11 — unvalidated counts feeding `resize`/indexing). Each seed writes N
// random bytes into a copy of a fixture and loads it in a child process, so a
// segfault or a hang is a reported line rather than the end of the run.
//
// **Corrupt the entry stream, not the whole file.** A byte flipped in the text
// header is rejected before any reader runs: 100 bytes anywhere gave 30 clean
// throws in 30 seeds, while 20 bytes confined to the stream gave 4 access
// violations and 1 hang in 40. `--whole` is there to reproduce that contrast,
// not to find bugs with.
//
// A seed that fails prints its mutation list; `--seed <n>` replays exactly that
// seed and then delta-debugs it down to the smallest subset of mutations that
// still fails, which is what turns a crash into a named field.
//
// Usage:
//   node tools/fuzz-world.js [--seeds 40] [--bytes 20] [--whole] [--file <zen>]
//   node tools/fuzz-world.js --seed 2 [--bytes 20] [--file <zen>]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readHeader } = require('../lib/container.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};

const file = flag('file', path.join(ROOT, 'test', 'fixtures', 'minimal.g2.zen'));
const nBytes = Number(flag('bytes', 20));
const nSeeds = Number(flag('seeds', 40));
const only = args.includes('--seed') ? Number(flag('seed')) : null;
const whole = args.includes('--whole');

const base = fs.readFileSync(file);
const header = readHeader(base);
const lo = whole ? 0 : header.entryStart;
const hi = whole ? base.length : header.hashTableOffset;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-fuzz-'));
const child = path.join(dir, 'load.js');
fs.writeFileSync(child, `
  const zenkit = require(${JSON.stringify(ROOT)});
  try {
    zenkit.loadWorld(process.argv[2], 'g2');
    console.log('LOADED');
  } catch (err) {
    console.log('THREW ' + JSON.stringify(err.message));
  }
`);

// A named PRNG rather than Math.random: a seed has to replay byte for byte, or
// a crash cannot be delta-debugged after the fact.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mutations(seed) {
  const next = rng((seed * 7919) >>> 0);
  const out = [];
  for (let i = 0; i < nBytes; i++) {
    const off = lo + Math.floor(next() * (hi - lo));
    out.push({ off, from: base[off], to: Math.floor(next() * 256) });
  }
  return out;
}

let run = 0;
function attempt(muts) {
  const buf = Buffer.from(base);
  for (const m of muts) buf[m.off] = m.to;
  const target = path.join(dir, `run${run++}.zen`);
  fs.writeFileSync(target, buf);

  const proc = spawnSync(process.execPath, [child, target], {
    encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL',
  });
  const timedOut = !!(proc.error && proc.error.code === 'ETIMEDOUT');
  return {
    bad: timedOut || proc.status !== 0,
    label: timedOut ? 'HANG' : proc.status !== 0
      ? `CRASH 0x${(proc.status >>> 0).toString(16)}`
      : (proc.stdout || '').trim().split('\n')[0],
  };
}

function describe(muts) {
  return muts.map((m) => `${m.off}: 0x${m.from.toString(16)} -> 0x${m.to.toString(16)}`).join('\n  ');
}

if (only !== null) {
  const muts = mutations(only);
  const first = attempt(muts);
  console.log(`seed ${only}: ${first.label}`);
  if (!first.bad) process.exit(1);

  // Delta debugging: drop one mutation at a time for as long as the rest still
  // fails. Quadratic in `--bytes` and each step is a process spawn, which is
  // why the default byte count is small.
  let cur = muts;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const candidate = cur.slice(0, i).concat(cur.slice(i + 1));
      if (attempt(candidate).bad) {
        cur = candidate;
        changed = true;
        break;
      }
    }
  }
  console.log(`minimal (${cur.length} of ${nBytes}):\n  ${describe(cur)}`);
  process.exit(0);
}

let bad = 0;
for (let seed = 1; seed <= nSeeds; seed++) {
  const muts = mutations(seed);
  const result = attempt(muts);
  if (result.bad) bad++;
  console.log(`seed ${seed}: ${result.label}${result.bad ? `\n  ${describe(muts)}` : ''}`);
}
console.log(`${bad} of ${nSeeds} seeds did not throw cleanly (--seed <n> to minimize one)`);
