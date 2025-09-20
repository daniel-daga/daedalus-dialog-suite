const { test, describe } = require('node:test');
const { strict: assert } = require('node:assert');
const DaedalusParser = require('../src/parser');
const fs = require('fs');
const path = require('path');

describe('Daedalus Parser', () => {
  let parser;

  test('setup', () => {
    parser = new DaedalusParser();
    assert.ok(parser, 'Parser should be created');
  });

  test('should parse simple instance declaration', () => {
    const source = `instance Test (Base)
{
  name = "test";
};`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse without errors');
    assert.ok(result.parseTime < 10, 'Should parse quickly');
    assert.equal(result.rootNode.type, 'program');
  });

  test('should parse simple function declaration', () => {
    const source = `func void TestFunction()
{
  return;
};`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse without errors');
    assert.equal(result.rootNode.type, 'program');
  });

  test('should parse function with return type', () => {
    const source = `func int GetValue()
{
  return 42;
};`;

    const result = parser.parse(source, { includeSource: true });
    assert.equal(result.hasErrors, false, 'Should parse without errors');
    assert.ok(result.sourceCode, 'Should include source when requested');

    const declarations = parser.extractDeclarations(result);
    assert.equal(declarations.length, 1);
    assert.equal(declarations[0].type, 'function');
    assert.equal(declarations[0].name, 'GetValue');
    assert.equal(declarations[0].returnType, 'int');
  });

  test('should extract declarations from parsed tree', () => {
    const source = `instance Hero (Npc_Default)
{
  name = "Hero";
  guild = GIL_NONE;
};

func void InitHero()
{
  name = "Test";
};`;

    const result = parser.parse(source, { includeSource: true });
    const declarations = parser.extractDeclarations(result);

    assert.equal(declarations.length, 2);
    assert.equal(declarations[0].type, 'instance');
    assert.equal(declarations[0].name, 'Hero');
    assert.equal(declarations[0].parent, 'Npc_Default');
    assert.equal(declarations[1].type, 'function');
    assert.equal(declarations[1].name, 'InitHero');
  });

  test('should validate syntax correctly', () => {
    const validSource = `instance Test (Base) { name = "test"; };`;
    const invalidSource = `instance Test Base) { name = "test"; };`; // missing opening paren

    const validResult = parser.validate(validSource);
    const invalidResult = parser.validate(invalidSource);

    assert.equal(validResult.isValid, true, 'Valid source should pass validation');
    assert.equal(invalidResult.isValid, false, 'Invalid source should fail validation');
    assert.ok(invalidResult.errors.length > 0, 'Should report errors for invalid syntax');
  });

  test('should parse example files', () => {
    const exampleFiles = [
      'examples/DEV_2130_Szmyk.d',
      'examples/DIA_DEV_2130_Szmyk.d',
      // Note: DIA_Farmim.d has some advanced constructs not yet supported
    ];

    for (const filePath of exampleFiles) {
      if (fs.existsSync(filePath)) {
        const result = parser.parseFile(filePath);
        assert.equal(result.hasErrors, false, `${filePath} should parse without errors`);
        assert.ok(result.parseTime < 100, `${filePath} should parse quickly`);
        assert.ok(result.throughput > 1000, `${filePath} should have good throughput`);

        const declarations = parser.extractDeclarations({ ...result, sourceCode: fs.readFileSync(filePath, 'utf8') });
        assert.ok(declarations.length > 0, `${filePath} should contain declarations`);
      }
    }
  });

  test('should handle comments correctly', () => {
    const source = `// This is a comment
instance Test (Base) // inline comment
{
  /* multi-line
     comment */
  name = "test";
};`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse comments without errors');
  });

  test('should report performance metrics', () => {
    const source = `instance Test (Base) { name = "test"; };`;
    const result = parser.parse(source);

    assert.ok(typeof result.parseTime === 'number', 'Should report parse time');
    assert.ok(typeof result.throughput === 'number', 'Should report throughput');
    assert.ok(result.sourceLength === source.length, 'Should report source length');
  });
});