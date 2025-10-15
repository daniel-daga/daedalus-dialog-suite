const { test, describe } = require('node:test');
const { strict: assert } = require('node:assert');
const DaedalusParser = require('../src/parser');
const fs = require('fs');

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
    const validSource = 'instance Test (Base) { name = "test"; };';
    const invalidSource = 'instance Test Base) { name = "test"; };'; // missing opening paren

    const validResult = parser.validate(validSource);
    const invalidResult = parser.validate(invalidSource);

    assert.equal(validResult.isValid, true, 'Valid source should pass validation');
    assert.equal(invalidResult.isValid, false, 'Invalid source should fail validation');
    assert.ok(invalidResult.errors.length > 0, 'Should report errors for invalid syntax');
  });

  test('should parse example files', () => {
    const exampleFiles = [
      'examples/DEV_2130_Szmyk.d',
      'examples/DIA_DEV_2130_Szmyk.d'
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
    const source = 'instance Test (Base) { name = "test"; };';
    const result = parser.parse(source);

    assert.ok(typeof result.parseTime === 'number', 'Should report parse time');
    assert.ok(typeof result.throughput === 'number', 'Should report throughput');
    assert.ok(result.sourceLength === source.length, 'Should report source length');
  });

  test('should parse const variable declarations', () => {
    const source = `const int MAX_VALUE = 100;
const string PLAYER_NAME = "Hero";`;

    const result = parser.parse(source, { includeSource: true });
    assert.equal(result.hasErrors, false, 'Should parse const declarations without errors');

    const declarations = parser.extractDeclarations(result);
    assert.equal(declarations.length, 2, 'Should find 2 const declarations');
    assert.equal(declarations[0].type, 'variable');
    assert.equal(declarations[0].name, 'MAX_VALUE');
    assert.equal(declarations[0].varType, 'int');
    assert.equal(declarations[0].isConst, true);
  });

  test('should parse var variable declarations', () => {
    const source = `var int currentHealth;
var string currentWeapon = "sword";`;

    const result = parser.parse(source, { includeSource: true });
    assert.equal(result.hasErrors, false, 'Should parse var declarations without errors');

    const declarations = parser.extractDeclarations(result);
    assert.equal(declarations.length, 2, 'Should find 2 var declarations');
    assert.equal(declarations[0].type, 'variable');
    assert.equal(declarations[0].name, 'currentHealth');
    assert.equal(declarations[0].varType, 'int');
    assert.equal(declarations[0].isConst, false);
  });

  test('should handle mixed case variable keywords', () => {
    const source = `CONST INT MAX_LEVEL = 50;
VAR STRING player_class = "warrior";
Const Float damage_multiplier = 1.5;`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse mixed case variable keywords');
  });

  test('should parse class declarations', () => {
    const source = `class C_NPC
{
    var int id;
    var string name;
};`;

    const result = parser.parse(source, { includeSource: true });
    assert.equal(result.hasErrors, false, 'Should parse class declarations without errors');

    const declarations = parser.extractDeclarations(result);
    assert.equal(declarations.length, 1, 'Should find 1 class declaration');
    assert.equal(declarations[0].type, 'class');
    assert.equal(declarations[0].name, 'C_NPC');
  });

  test('should parse prototype declarations', () => {
    const source = `prototype NPC_Default(C_NPC)
{
    id = 0;
    name = "";
    var int level;
};`;

    const result = parser.parse(source, { includeSource: true });
    assert.equal(result.hasErrors, false, 'Should parse prototype declarations without errors');

    const declarations = parser.extractDeclarations(result);
    assert.equal(declarations.length, 1, 'Should find 1 prototype declaration');
    assert.equal(declarations[0].type, 'prototype');
    assert.equal(declarations[0].name, 'NPC_Default');
    assert.equal(declarations[0].parent, 'C_NPC');
  });

  test('should handle mixed case class/prototype keywords', () => {
    const source = `CLASS BasicItem
{
    var string description;
};

PROTOTYPE DefaultWeapon(BasicItem)
{
    description = "A basic weapon";
};

Prototype SpecialWeapon(BasicItem)
{
    description = "A special weapon";
};`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse mixed case class/prototype keywords');
  });

  test('should parse unary expressions', () => {
    const source = `func int TestUnary()
{
    var int value = 10;
    var int result = -value;
    var int positive = +result;
    return result;
};`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse unary expressions without errors');
  });

  test('should parse logical unary expressions', () => {
    const source = `func int TestLogical()
{
    var int flag = 1;
    if (!flag)
    {
        return 0;
    };
    return 1;
};`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse logical unary expressions without errors');
  });

  test('should parse bitwise unary expressions', () => {
    const source = `func int TestBitwise()
{
    var int value = 42;
    var int inverted = ~value;
    return inverted;
};`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse bitwise unary expressions without errors');
  });

  test('should parse array access expressions', () => {
    const source = `func int TestArrayAccess()
{
    var int array[10];
    var int firstElement = array[0];
    var int lastElement = array[9];
    return firstElement;
};`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse array access expressions without errors');
  });

  test('should parse member access expressions', () => {
    const source = `func void TestMemberAccess()
{
    npc.name = "TestNPC";
    var string npcName = other.name;
    self.level = 10;
};`;

    const result = parser.parse(source);
    assert.equal(result.hasErrors, false, 'Should parse member access expressions without errors');
  });
});
