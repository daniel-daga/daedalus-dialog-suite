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
  'arity-variants.d',    // fix-01 step 1 (P4 arity fallback + N8)
  'numeric-args.d',      // fix-01 step 3 (P3 numeric fidelity)
  'quoting.d',           // fix-01 step 4 (P5/N1/N2/N7 quote preservation)
  'case-drift.d',        // fix-01 step 6 (M1-M5 case-insensitive references, b_beklauen)
  'class-prototype.d',   // fix-01 step 7 (P1 class/prototype declarations)
  'declaration-order.d', // fix-01 step 8 (N10 declaration-order fidelity + header suppression)
  'comments.d',          // fix-01 step 9 (P6/N3/N4/N5 comment preservation)
  'condition-idioms.d',  // fix-01 step 9 (P6/N5 standalone comment inside a condition body)
  'globals.d',           // fix-01 step 9 (P6 trailing/EOF comment preservation)
  'items-npcs-mds.d',    // fix-01 step 9 (P6 trailing comment preservation)
  'encoding-1252.d',     // fix-01 step 9 (P6 comment preservation, windows-1252 encoded)
  'blank-lines.d',       // #286 blank lines between top-level declarations
  'crlf-layout.d',       // #440 a CRLF file keeps its line endings
  'body-blank-line.d',   // #440 a blank line inside a body
  'body-same-line-statements.d', // #440 two statements on one line
  'body-trailing-comment.d',     // #440 a trailing statement comment
  'same-line-declarations.d',    // #440 two declarations on one line
  'property-gaps.d',             // #440 a blank line inside a C_INFO property list
  'zpe-extensions.d'             // #392 zPE META, test blocks and namespace carried verbatim
];

// The whole synthetic corpus is now Tier-1 token-clean. New fidelity gaps land
// here as a fresh red fixture; fix and promote to GREEN in the same change.
const KNOWN_RED_FIXTURES = [];

// Tier-2 byte ratchet: fixtures that must round-trip byte-identical, line
// endings included. Byte drift is otherwise only reported; these fixtures pin
// the formatting fixes that have landed so a regression fails here instead of
// vanishing into a report.
const BYTE_EXACT_FIXTURES = [
  'arity-variants.d',
  'case-drift.d',
  'class-prototype.d',   // #286
  'declaration-order.d',
  'encoding-1252.d',
  'globals.d',
  'items-npcs-mds.d',    // #286 blank line between a comment and its declaration
  'numeric-args.d',
  'blank-lines.d',       // #286
  'crlf-layout.d',       // #440 line endings are the file's own
  'body-blank-line.d',   // #440
  'body-same-line-statements.d', // #440
  'body-trailing-comment.d',     // #440
  'same-line-declarations.d',    // #440
  'property-gaps.d',             // #440
  'zpe-extensions.d',            // #392
  'comments.d'                   // #440 a trailing statement comment and an inline subtitle
];

const corpusDir = path.resolve(__dirname, 'fixtures', 'corpus');
const scriptPath = path.resolve(__dirname, '..', 'scripts', 'roundtrip-corpus.js');

function isGreen(detail) {
  return detail.status === 'ok' && detail.drift && detail.drift.tokenFidelityDrift === false;
}

function runCorpus(root, reportDir, prefix, extraArgs = []) {
  let exitCode = 0;
  try {
    execFileSync(process.execPath, [
      scriptPath,
      '--root', root,
      '--report-dir', reportDir,
      '--report-prefix', prefix,
      '--strict',
      ...extraArgs
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

// #448: a file the grammar rejects used to be counted, printed and dropped, so
// `--strict` exited 0 over a corpus whose files had never been measured.
test('--strict fails a corpus holding a file the parser rejects', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-smoke-unparseable-report-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-smoke-unparseable-'));
  fs.copyFileSync(path.join(corpusDir, 'quoting.d'), path.join(dir, 'quoting.d'));
  fs.writeFileSync(path.join(dir, 'unparseable.d'), 'var int A = ;\n');

  const { exitCode, details, byName } = runCorpus(dir, reportDir, 'smoke-unparseable');

  assert.equal(byName.get('unparseable.d').status, 'source_syntax_error');
  assert.equal(details.length, 2, 'the unparseable file must be reported, not dropped');
  assert.notEqual(exitCode, 0, '--strict must fail on a file it could not parse');

  // The one file no compiler accepts (MDK's Externals.d) gets named explicitly
  // instead of turning the whole gate down.
  const allowed = runCorpus(dir, reportDir, 'smoke-unparseable-allowed', [
    '--allow-syntax-error', path.join(dir, 'unparseable.d')
  ]);
  assert.equal(allowed.exitCode, 0, 'a named syntax error must not fail --strict');
});

// #448: Tier 2 used to compare two decoded strings, so an encode/decode loss
// was invisible by construction. 0x81 is unassigned in windows-1252: iconv
// decodes it to U+FFFD and writes back 0x9D, so the save path cannot reproduce
// the file. Only reading the file's bytes can see that.
test('byte fidelity compares the file bytes, so an unmappable byte is caught', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-smoke-lossy-report-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-smoke-lossy-'));
  fs.copyFileSync(path.join(corpusDir, 'globals.d'), path.join(dir, 'globals.d'));
  fs.writeFileSync(path.join(dir, 'unassigned-byte.d'), Buffer.concat([
    Buffer.from('const string S = "'),
    Buffer.from([0x81]),
    Buffer.from('";\n')
  ]));

  const { byName } = runCorpus(dir, reportDir, 'smoke-lossy');
  const lossy = byName.get('unassigned-byte.d');
  const clean = byName.get('globals.d');

  assert.equal(lossy.status, 'ok', 'the file parses; the defect is in the encoding, not the grammar');
  assert.equal(lossy.drift.tokenFidelityDrift, false, 'the decoded tokens are equal — only the bytes differ');
  assert.equal(lossy.drift.byteFidelityDrift, true, 'the bytes on disk must be compared, not the decoded text');
  assert.equal(clean.drift.byteFidelityDrift, false, 'a file that round-trips must not be reported as lossy');
});

test('BYTE_EXACT fixtures round-trip byte-identical', () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-smoke-bytes-'));
  const { byName } = runCorpus(corpusDir, reportDir, 'smoke-bytes');

  for (const name of BYTE_EXACT_FIXTURES) {
    const detail = byName.get(name);
    assert.ok(detail, `missing report entry for ${name}`);
    assert.equal(detail.drift.byteFidelityDrift, false, `${name} should round-trip byte-identical`);
  }
});
