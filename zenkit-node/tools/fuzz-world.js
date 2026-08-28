'use strict';
// Seeded corruption fuzzer for the world reader (`docs/plans/level-editor.md`
// §16.11 — unvalidated counts feeding `resize`/indexing). Each seed writes N
// random bytes into a copy of a fixture and loads it in a child process, so a
// segfault or a hang is a reported line rather than the end of the run.
//
// **Corrupt the entry stream, not the whole file.** A byte flipped in the text
// header is rejected before any reader runs: 100 bytes anywhere gave 30 clean
// throws in 30 seeds, while 20 bytes confined to the stream keeps finding
// defects. `--whole` is there to reproduce that contrast, not to find bugs with.
//
// **200 seeds is the baseline, not the default 40.** 40 of 40 came back clean
// after patch 0032 and widening the same run to 200 immediately found six more
// (two crashes, four hangs) in two minutes -- see level-editor.md 16.11.
//
// A seed that fails prints its mutation list; `--seed <n>` replays exactly that
// seed and then delta-debugs it down to the smallest subset of mutations that
// still fails, which is what turns a crash into a named field.
//
// **`--counts` is the mode that finds this defect class on purpose.** Random
// bytes find a count only by luck -- 20 of them over a 50 MB retail world
// essentially never land on the four bytes of one -- so `--counts` sweeps every
// INTEGER entry in the stream in turn, rewriting each to one large-but-not-absurd
// value. An absurd count is the harmless case (`resize` throws `bad_alloc`); the
// dangerous one is merely large, so it commits gigabytes and still returns. A
// load that succeeds is therefore reported with its wall clock, and a slow
// `LOADED` is a finding, not a pass.
//
// **Its limit is the fixture's field set, and that is not a small limit.** A
// sweep only reaches the INTEGER entries the file it is given happens to carry,
// so `minimal.g2.zen` -- which has no `oCNpc` -- hides all five of the NPC
// reader's element counts, three of which were unbounded (patch `0040`). Point
// `--file` at a world that carries the class, or author one: the `npc` fixture
// variant exists for exactly that.
//
// Usage:
//   node tools/fuzz-world.js [--seeds 40] [--bytes 20] [--whole] [--file <zen>]
//   node tools/fuzz-world.js --seed 2 [--bytes 20] [--file <zen>]
//   node tools/fuzz-world.js --counts [--value 268435455] [--file <zen>]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readHeader, walk } = require('../lib/container.js');

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
function attemptBuffer(buf) {
  const target = path.join(dir, `run${run++}.zen`);
  fs.writeFileSync(target, buf);

  const started = Date.now();
  const proc = spawnSync(process.execPath, [child, target], {
    encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL',
  });
  const timedOut = !!(proc.error && proc.error.code === 'ETIMEDOUT');
  // Deleted right away: a retail world is 75 MB, and keeping one copy per seed
  // fills the disk long before a 200-seed run is over.
  fs.rmSync(target, { force: true });
  return {
    bad: timedOut || proc.status !== 0,
    elapsed: Date.now() - started,
    label: timedOut ? 'HANG' : proc.status !== 0
      ? `CRASH 0x${(proc.status >>> 0).toString(16)}`
      : (proc.stdout || '').trim().split('\n')[0],
  };
}

function attempt(muts) {
  const buf = Buffer.from(base);
  for (const m of muts) buf[m.off] = m.to;
  return attemptBuffer(buf);
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

if (args.includes('--counts')) {
  // Every INTEGER entry, one at a time. The counts that size a container are a
  // subset of these; the rest are ordinary fields and are expected to load.
  const value = Number(flag('value', 0x0fffffff));
  const targets = [...walk(base)].filter((ev) => ev.kind === 'entry' && ev.entryType === 'INTEGER');
  const clean = attemptBuffer(Buffer.from(base));
  // A load of the untouched file is the baseline every `LOADED` below is judged
  // against: "slow" only means anything next to it.
  console.log(`baseline: ${clean.label} in ${clean.elapsed} ms, ${targets.length} INTEGER entries to sweep`);

  let flagged = 0;
  for (const ev of targets) {
    const buf = Buffer.from(base);
    buf.writeUInt32LE(value, ev.payloadOffset);
    const result = attemptBuffer(buf);
    const slow = result.label === 'LOADED' && result.elapsed > clean.elapsed * 4 + 1000;
    if (result.bad || slow) flagged++;
    if (result.bad || slow || process.env.FUZZ_VERBOSE) {
      console.log(`${ev.entryName} @${ev.payloadOffset} (${ev.path.join('/')}): ${result.label} in ${result.elapsed} ms`);
    }
  }
  console.log(`${flagged} of ${targets.length} INTEGER entries crashed, hung or loaded slowly`);
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
