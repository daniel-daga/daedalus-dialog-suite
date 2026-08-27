'use strict';

// T7 — the `zen-roundtrip` harness (docs/plans/level-editor-phase-0.md §6).
// The plan's acceptance test: "against fixtures, a seeded corrupt fixture exits
// non-zero and names the offending structure". Everything here drives the real
// CLI through spawnSync, because the exit code and the report artifact are the
// harness's contract.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const zenkit = require('..');
const { walk } = require('../lib/container.js');

const HARNESS = path.join(__dirname, '..', 'scripts', 'zen-roundtrip.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-roundtrip-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A seeded corruption the STRUCT DUMP cannot see: ZenGin declares `locked` as a
// signed one-bit bit-field, so a set flag reads back as 0xFFFFFFFF (patch 0017).
// Rewriting it to the naive `1` still loads as `true`, so the re-save restores
// 0xFFFFFFFF and only the container instrument notices the difference.
function seedContainerCorruption(dir, name) {
  const buf = Buffer.from(fs.readFileSync(FIXTURE));
  const entry = [...walk(buf)].find((ev) => ev.kind === 'entry' && ev.entryName === 'locked');
  assert.strictEqual(entry.entryType, 'BOOL');
  assert.strictEqual(buf.readUInt32LE(entry.payloadOffset), 0xffffffff);
  buf.writeUInt32LE(1, entry.payloadOffset);
  const at = path.join(dir, name);
  fs.writeFileSync(at, buf);
  return at;
}

function run(dir, extra = []) {
  const reportDir = path.join(dir, 'reports');
  const proc = spawnSync(
    process.execPath,
    [HARNESS, '--root', dir, '--game', 'g2', '--report-dir', reportDir, ...extra],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'zen-roundtrip.json'), 'utf8'));
  return { proc, report, worlds: Object.fromEntries(report.worlds.map((w) => [w.name, w])) };
}

test('a clean world round-trips: identical, container-instrumented, exit 0', () => {
  withTmpDir((dir) => {
    fs.copyFileSync(FIXTURE, path.join(dir, 'clean.zen'));
    const { proc, worlds } = run(dir, ['--strict']);

    assert.strictEqual(proc.status, 0, proc.stderr);
    assert.strictEqual(worlds['clean.zen'].verdict, 'identical');
    assert.strictEqual(worlds['clean.zen'].deterministic, true);
    assert.strictEqual(worlds['clean.zen'].instrument, 'full');
    assert.strictEqual(worlds['clean.zen'].byteDiff.coverage.gap, 0);
    assert.match(proc.stdout, /COVERAGE: 1 \.zen found; 1 measured \(1 container-instrumented, 0 struct-dump only\)/);
  });
});

test('--fixtures mode reports the C2 claim and never calls itself fidelity', () => {
  const proc = spawnSync(process.execPath, [HARNESS, '--fixtures'], { encoding: 'utf8' });
  assert.strictEqual(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /CLAIM: C2 .*NOT a fidelity result/);
});

test('a seeded corrupt world exits non-zero under --strict and names the structure', () => {
  withTmpDir((dir) => {
    seedContainerCorruption(dir, 'corrupt.zen');

    const { proc, worlds } = run(dir, ['--strict']);
    assert.strictEqual(proc.status, 1, `expected a blocking exit, got ${proc.status}\n${proc.stdout}`);

    const row = worlds['corrupt.zen'];
    assert.strictEqual(row.verdict, 'semantic-drift');
    const named = row.findings.filter((f) => /^container\.payloads\.bool\..*\/locked$/.test(f.path));
    assert.ok(named.length, `expected a BOOL payload finding, got: ${row.findings.map((f) => f.path).join(', ')}`);
    // The point of the seed: no parsed-struct section sees it.
    assert.ok(row.findings.every((f) => f.path.startsWith('container.')));
    assert.ok(row.byteDiff.differing.some((d) => /locked/.test(d.key)), JSON.stringify(row.byteDiff.differing));
    assert.match(proc.stdout, /BLOCKING: 1 — corrupt\.zen \(semantic-drift\)/);
  });
});

test('without --strict a blocking world is reported but the exit code stays 0', () => {
  withTmpDir((dir) => {
    seedContainerCorruption(dir, 'corrupt.zen');
    const { proc, worlds } = run(dir);
    assert.strictEqual(proc.status, 0);
    assert.strictEqual(worlds['corrupt.zen'].verdict, 'semantic-drift');
  });
});

test('a .zen that is not a world is skipped with a reason, not counted as a failure', () => {
  withTmpDir((dir) => {
    // The four FireTree/ItLsTorchBurning .zen files in a retail G2 install are
    // VOB libraries: no MeshAndBsp, so no world to round-trip.
    fs.writeFileSync(
      path.join(dir, 'library.zen'),
      'ZenGin Archive\nver 1\nzCArchiverGeneric\nASCII\nsaveGame 0\nEND\nobjects 0\nEND\n\n[]\n',
      'latin1'
    );
    fs.copyFileSync(FIXTURE, path.join(dir, 'clean.zen'));

    const { proc, worlds } = run(dir, ['--strict']);
    assert.strictEqual(proc.status, 0, proc.stdout);
    assert.strictEqual(worlds['library.zen'].status, 'skipped');
    assert.strictEqual(worlds['library.zen'].verdict, 'not-a-world');
    assert.match(proc.stdout, /1 skipped \(not worlds\)/);
  });
});

// Each world is measured in a child process because ZenKit could abort the
// process outright on the ASCII path (a hard 0xC0000409 on Windows). That is
// no longer what happens — see below — but the isolation stays: a crash is a
// result to record, not the end of the run.
//
// The status asserted here is EXACT and it is the one a *working* writer
// earns. It used to be `unreadable`, pinning defects A1–A4
// (docs/engine-acceptance-2026-08-25.md §10.2): ZenKit could not re-load what
// its own ASCII writer produced. Patches 0024 (A1) and 0025 (A4) fixed the two
// that mattered to the reload, and the round-trip now completes end to end. A
// three-way `['crashed', 'unreadable', 'ok']` here would have stayed green
// through both the defect and the fix, so it is spelled out instead: IF THIS
// GOES RED WITH `unreadable`, THE ASCII WRITER HAS REGRESSED.
//
// What this is NOT is a ZenGin-fidelity result. The fixture is authored by
// ZenKit's own ASCII writer, so it can only ever prove self-consistency; a
// real ASCII fidelity claim needs a ZenGin-written fixture, which nothing in
// the repository has. A2 and A3 also remain open, and both live on the
// unpacked write path this packed fixture never takes.
test('an ASCII world round-trips to an exact verdict and is fully instrumented', () => {
  withTmpDir((dir) => {
    zenkit._authorFixtureWorld(path.join(dir, 'a-ascii.zen'), 'ascii', 'g2');
    fs.copyFileSync(FIXTURE, path.join(dir, 'b-clean.zen'));

    const { proc, worlds } = run(dir);
    assert.strictEqual(proc.status, 0, proc.stderr);
    assert.strictEqual(Object.keys(worlds).length, 2);
    assert.strictEqual(worlds['b-clean.zen'].verdict, 'identical');

    const ascii = worlds['a-ascii.zen'];
    assert.strictEqual(ascii.format, 'ASCII');
    assert.strictEqual(ascii.status, 'ok');
    assert.strictEqual(ascii.verdict, 'identical');
    assert.strictEqual(ascii.findings.length, 0, JSON.stringify(ascii.findings));
    // The whole point of fixing A1: the re-save re-loads, so the harness gets
    // past `loadWorld` and the ASCII container walker is actually reached.
    // `instrument: 'none'` here means it did not — which is what the defect
    // looked like, and the assertion that would catch it coming back.
    assert.strictEqual(ascii.instrument, 'full');
    assert.strictEqual(ascii.containerCoverage, true);
    assert.strictEqual(ascii.blob.identical, true);
    assert.strictEqual(ascii.resavedSize, ascii.size);
    assert.strictEqual(ascii.deterministic, true);

    // Nothing blocks any more, so --strict has to exit 0 on the same pair.
    const strict = run(dir, ['--strict']);
    assert.strictEqual(strict.proc.status, 0, `expected a clean exit, got ${strict.proc.status}\n${strict.proc.stdout}`);
    assert.match(strict.proc.stdout, /VERDICTS: .*1× identical \[ASCII\].*1× identical \[BIN_SAFE\]/);
    assert.match(strict.proc.stdout, /BLOCKING: 0/);
  });
});

// The harness's byte diff dispatches on the archive format the way
// `containerFromBuffer` does. It used to be gated on BIN_SAFE, so every ASCII
// row reported `whole-file` — a verdict that has no event alignment, no
// coverage number and therefore nothing to say about *where* two files differ.
// The accounting is asserted rather than the kind alone: a diff that claimed to
// be event-aligned without walking the stream would leave bytes unaccounted for.
test('an ASCII world gets an event-aligned byte diff, not a whole-file fallback', () => {
  withTmpDir((dir) => {
    const at = path.join(dir, 'ascii.zen');
    zenkit._authorFixtureWorld(at, 'ascii', 'g2');
    const size = fs.statSync(at).size;

    const { proc, worlds } = run(dir, ['--strict']);
    assert.strictEqual(proc.status, 0, proc.stderr);

    const row = worlds['ascii.zen'];
    assert.strictEqual(row.format, 'ASCII');
    const diff = row.byteDiff;
    assert.strictEqual(diff.kind, 'event-aligned', JSON.stringify(diff));
    assert.strictEqual(diff.aligned, true, JSON.stringify(diff.alignBreak));
    // Every byte of the file reached the diff, and every event span matched:
    // header + stream + trailer add back up to the file it was pointed at.
    assert.strictEqual(diff.coverage.total, size);
    assert.strictEqual(diff.coverage.gap, 0);
    assert.deepStrictEqual(diff.differing, []);
    assert.strictEqual(diff.events[0], diff.events[1]);
    assert.ok(diff.events[0] > 20, `too few events to have walked a world: ${diff.events[0]}`);
    assert.strictEqual(diff.coverage.accounted, size);
    assert.ok(diff.identicalEventBytes > 0, 'no event bytes were compared at all');
    assert.match(proc.stdout, /ascii\.zen\s+identical\s+.*gap 0, 0 differing events/);
  });
});

test('--drill adds differing-byte samples to the report', () => {
  withTmpDir((dir) => {
    seedContainerCorruption(dir, 'corrupt.zen');
    const { worlds } = run(dir, ['--drill']);
    const samples = worlds['corrupt.zen'].byteDiff.samples;
    assert.ok(samples.length, 'expected at least one drilled sample');
    assert.notStrictEqual(samples[0].original, samples[0].resaved);
  });
});
