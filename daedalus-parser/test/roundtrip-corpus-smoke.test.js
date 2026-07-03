const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Tier-1 token-fidelity ratchet over the committed synthetic fixture corpus.
//
// Each fixture isolates one construct family so failures localize. Fixtures
// whose fidelity fixes have landed are asserted zero-drift (GREEN); every other
// fixture is asserted to still be red (KNOWN_RED) so the list cannot rot
// silently — once a fix lands, its fixture flips to red-assertion failure and
// must be promoted to GREEN in the same change.
//
// A fixture is GREEN when it round-trips token-equal: parses cleanly, generates
// without syntax errors, and shows no Tier-1 token drift and no Tier-3 semantic
// drift. It is RED otherwise (token drift, generated syntax error, or semantic
// drift).

const GREEN_FIXTURES = [
  'arity-variants.d', // fix-01 step 1 (P4 arity fallback + N8)
  'numeric-args.d',   // fix-01 step 3 (P3 numeric fidelity)
  'quoting.d',        // fix-01 step 4 (P5/N1/N2/N7 quote preservation)
  'case-drift.d'      // fix-01 step 6 (M1-M5 case-insensitive references, b_beklauen)
];

const KNOWN_RED_FIXTURES = [
  'class-prototype.d',    // P1 class/prototype declarations dropped
  'comments.d',           // P6/N3/N5 comment preservation
  'condition-idioms.d',   // P6/N5 standalone comment inside a condition body (P2 body-loss fixed)
  'declaration-order.d',  // N10 declaration-order fidelity
  'globals.d',            // P6 trailing/EOF comment preservation
  'items-npcs-mds.d',     // P6 trailing comment preservation
  'encoding-1252.d'       // P6 comment preservation (windows-1252 encoded)
];

const corpusDir = path.resolve(__dirname, 'fixtures', 'corpus');
const scriptPath = path.resolve(__dirname, '..', 'scripts', 'roundtrip-corpus.js');

function isGreen(detail) {
  return detail.status === 'ok' && detail.drift && detail.drift.tokenFidelityDrift === false;
}

function runCorpus(root, reportDir, prefix) {
  let exitCode = 0;
  try {
    execFileSync(process.execPath, [
      scriptPath,
      '--root', root,
      '--report-dir', reportDir,
      '--report-prefix', prefix,
      '--strict'
    ], { stdio: 'pipe' });
  } catch (error) {
    exitCode = typeof error.status === 'number' ? error.status : 1;
  }
  const details = JSON.parse(fs.readFileSync(path.join(reportDir, `${prefix}-details.json`), 'utf8'));
  const byName = new Map(details.map((d) => [path.basename(d.file), d]));
  return { exitCode, details, byName };
}

test('ratchet lists cover every corpus fixture exactly once (cannot rot silently)', () => {
  const fixtureFiles = fs.readdirSync(corpusDir).filter((n) => n.toLowerCase().endsWith('.d')).sort();
  const listed = [...GREEN_FIXTURES, ...KNOWN_RED_FIXTURES].sort();
  const overlap = GREEN_FIXTURES.filter((n) => KNOWN_RED_FIXTURES.includes(n));

  assert.deepEqual(overlap, [], 'a fixture must not be in both GREEN and KNOWN_RED');
  assert.deepEqual(
    listed,
    fixtureFiles,
    'every fixture file must appear in exactly one ratchet list (add new fixtures to a list)'
  );
});

test('GREEN fixtures round-trip token-equal under --strict', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-smoke-green-'));
  const greenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-smoke-greenset-'));
  for (const name of GREEN_FIXTURES) {
    fs.copyFileSync(path.join(corpusDir, name), path.join(greenDir, name));
  }

  const { exitCode, byName } = runCorpus(greenDir, reportDir, 'smoke-green');

  for (const name of GREEN_FIXTURES) {
    const detail = byName.get(name);
    assert.ok(detail, `missing report entry for ${name}`);
    assert.equal(detail.status, 'ok', `${name} should have no structural drift or syntax errors`);
    assert.equal(detail.drift.tokenFidelityDrift, false, `${name} should show zero token drift`);
  }

  // A corpus of only-green fixtures must pass --strict cleanly.
  assert.equal(exitCode, 0, 'strict run over the GREEN set should exit 0');
});

test('full corpus token-fidelity matches the ratchet (GREEN clean, KNOWN_RED still red)', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-smoke-full-'));
  const { exitCode, byName } = runCorpus(corpusDir, reportDir, 'smoke-full');

  for (const name of GREEN_FIXTURES) {
    const detail = byName.get(name);
    assert.ok(detail, `missing report entry for ${name}`);
    assert.ok(isGreen(detail), `${name} is expected to be GREEN (token-equal round-trip)`);
  }

  for (const name of KNOWN_RED_FIXTURES) {
    const detail = byName.get(name);
    assert.ok(detail, `missing report entry for ${name}`);
    assert.ok(
      !isGreen(detail),
      `${name} is listed as KNOWN_RED but round-trips clean now — promote it to GREEN_FIXTURES`
    );
  }

  // While any known-red fixture remains, the strict run over the whole corpus
  // must fail (Tier-1 token drift or generated syntax errors).
  if (KNOWN_RED_FIXTURES.length > 0) {
    assert.notEqual(exitCode, 0, 'strict run should fail while known-red fixtures remain');
  }
});
