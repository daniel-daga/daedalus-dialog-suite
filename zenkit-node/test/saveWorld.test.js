'use strict';

// T6 — saveWorld: the C2 regression claim (docs/plans/level-editor-phase-0.md §6).
// load(fixture) → save must reproduce the fixture bytes, modulo the archive
// headers' `date `/`user ` stamp lines, which the writer stamps fresh.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');
const GOLDEN = path.join(__dirname, 'fixtures', 'minimal.g2.golden.json');

// Blank the variable `date `/`user ` lines inside every ZenGin archive header
// (a world contains nested archives — e.g. the MeshAndBsp chunk carries its
// own header — so all header blocks are normalized, not just the first).
// Both buffers get the same treatment, so the comparison still proves the
// non-header remainder is byte-identical.
function normalizeHeaderStamps(buffer) {
  const latin1 = buffer.toString('latin1');
  const header =
    /(ZenGin Archive\nver 1\n[^\n]*\n[^\n]*\nsaveGame \d+\n)date [^\n]*\nuser [^\n]*\n(END\n)/g;
  return Buffer.from(latin1.replace(header, '$1date\nuser\n$2'), 'latin1');
}

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-node-save-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('saveWorld reproduces the fixture bytes except the header date/user stamps', () => {
  withTmpDir((dir) => {
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(FIXTURE, 'g2'), out);

    const original = normalizeHeaderStamps(fs.readFileSync(FIXTURE));
    const resaved = normalizeHeaderStamps(fs.readFileSync(out));
    assert.deepStrictEqual(resaved, original);
  });
});

test('saveWorld output re-loads and normalizes to the golden dump', () => {
  withTmpDir((dir) => {
    const out = path.join(dir, 'resaved.zen');
    zenkit.saveWorld(zenkit.loadWorld(FIXTURE, 'g2'), out);

    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    assert.deepStrictEqual(zenkit.normalizeWorld(zenkit.loadWorld(out, 'g2')), golden);
  });
});

test('saveWorld throws a JS Error for an unwritable destination', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  const bad = path.join(__dirname, 'no-such-directory', 'nested', 'out.zen');
  assert.throws(() => zenkit.saveWorld(handle, bad), Error);
});

test('saveWorld leaves no temp file behind on failure', () => {
  withTmpDir((dir) => {
    const handle = zenkit.loadWorld(FIXTURE, 'g2');
    const bad = path.join(dir, 'missing', 'out.zen');
    assert.throws(() => zenkit.saveWorld(handle, bad), Error);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });
});
