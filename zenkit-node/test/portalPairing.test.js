'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { pairPortalMaterials } = require('../scripts/check-portal-pairing.js');

// The counting behind the measurement `check-portal-pairing.js` reports over
// the retail worlds (level-editor.md §16.22 q1). The script itself needs an
// installation; this pins what it counts, on lists small enough to read.

test('a P:A_B with its P:B_A is one pair and nothing unpaired', () => {
  const r = pairPortalMaterials(['P:RICEB02_RICEB01', 'P:RICEB01_RICEB02', 'NW_STONE']);
  assert.strictEqual(r.portalMaterials, 2);
  assert.strictEqual(r.pairs, 1);
  assert.deepStrictEqual(r.unpaired, []);
});

test('an open side pairs with its mirror-open side', () => {
  // 44 of OldWorld's 100 look like this; the mirror of `P:X_` is `P:_X`.
  const r = pairPortalMaterials(['P:OWCAVE01_', 'P:_OWCAVE01']);
  assert.strictEqual(r.pairs, 1);
  assert.deepStrictEqual(r.unpaired, []);
});

test('a name with no mirror is reported, with the mirror it wanted', () => {
  const r = pairPortalMaterials(['P:A_B']);
  assert.strictEqual(r.pairs, 0);
  assert.deepStrictEqual(r.unpaired, [{ material: 'P:A_B', wanted: 'P:B_A' }]);
});

test('pairing is case-insensitive, as checkPortalMaterials is', () => {
  const r = pairPortalMaterials(['P:Hall_Cave', 'p:CAVE_HALL']);
  assert.strictEqual(r.pairs, 1);
  assert.deepStrictEqual(r.unpaired, []);
});

test('a malformed name is counted apart and never asked to pair', () => {
  const r = pairPortalMaterials(['P:A_B_C', 'P:_', 'P:NOSEP']);
  assert.strictEqual(r.malformed.length, 3);
  assert.strictEqual(r.pairs, 0);
  assert.deepStrictEqual(r.unpaired, []);
});

test('a symmetric name is its own mirror and counts as a pair', () => {
  const r = pairPortalMaterials(['P:A_A']);
  assert.strictEqual(r.selfPaired, 1);
  assert.strictEqual(r.pairs, 1);
  assert.deepStrictEqual(r.unpaired, []);
});

test('a repeated name is one distinct portal, and its repeats are counted', () => {
  const r = pairPortalMaterials(['P:A_B', 'P:A_B', 'P:B_A']);
  assert.strictEqual(r.portalMaterials, 3);
  assert.strictEqual(r.distinct, 2);
  assert.strictEqual(r.repeated, 1);
  assert.strictEqual(r.pairs, 1);
  assert.deepStrictEqual(r.unpaired, []);
});
