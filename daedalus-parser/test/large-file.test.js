const { test, describe } = require('node:test');
const { strict: assert } = require('node:assert');
const DaedalusParser = require('../src/core/parser');
const fs = require('fs');
const path = require('path');

describe('Daedalus Parser - Real Files', () => {
  let parser;

  test('setup', () => {
    parser = new DaedalusParser();
  });

  test('should parse DIA_AlchemistWald_99004.d', () => {
    const filePath = path.resolve(__dirname, '../../DIA_AlchemistWald_99004.d');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.length > 0, 'File content should not be empty');

    const result = parser.parse(source);
    
    if (result.hasErrors) {
        console.error('Parse errors:', JSON.stringify(result.errors, null, 2));
    }
    
    assert.equal(result.hasErrors, false, 'Should parse DIA_AlchemistWald_99004.d without errors');
  });
});
