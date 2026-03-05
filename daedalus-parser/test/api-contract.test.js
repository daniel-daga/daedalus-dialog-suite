const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const DaedalusParser = require('../src/core/parser');

test('runtime API contract exposes supported parser methods', () => {
  const parser = new DaedalusParser();

  assert.equal(typeof parser.parse, 'function');
  assert.equal(typeof parser.parseFile, 'function');
  assert.equal(typeof parser.validate, 'function');
  assert.equal(typeof parser.extractComments, 'function');
  assert.equal(typeof parser.extractDeclarations, 'function');

  assert.equal(typeof DaedalusParser.create, 'function');
  assert.equal(typeof DaedalusParser.parseSource, 'function');
});

test('runtime API contract does not expose removed legacy dialog helpers', () => {
  const parser = new DaedalusParser();

  assert.equal(typeof parser.interpretDialogs, 'undefined');
  assert.equal(typeof parser.generateDaedalus, 'undefined');
  assert.equal(typeof parser.generateDaedalusSimple, 'undefined');
  assert.equal(typeof parser.parseDialogFile, 'undefined');
  assert.equal(typeof parser.parseDialogSource, 'undefined');
  assert.equal(typeof parser.validateDialogFile, 'undefined');
  assert.equal(typeof parser.validateDialogSource, 'undefined');
});
