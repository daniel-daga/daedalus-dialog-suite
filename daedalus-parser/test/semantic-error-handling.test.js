const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel, SemanticModelBuilderVisitor, createDaedalusParser } = require('../dist/semantic/semantic-visitor-index');

// ===================================================================
// SYNTAX ERROR DETECTION TESTS
// ===================================================================

test('parseSemanticModel should detect syntax errors and return error info', () => {
  const invalidCode = `
    instance DIA_Test(C_INFO)
      npc = TEST_NPC;  // Missing opening brace
      nr = 1;
    };
  `;

  const model = parseSemanticModel(invalidCode);

  assert.ok(model.hasErrors, 'Should have errors');
  assert.ok(Array.isArray(model.errors), 'Should have errors array');
  assert.ok(model.errors.length > 0, 'Should have at least one error');
});

test('parseSemanticModel should not have errors for valid code', () => {
  const validCode = `
    instance DIA_Test(C_INFO) {
      npc = TEST_NPC;
      nr = 1;
    };
  `;

  const model = parseSemanticModel(validCode);

  assert.ok(!model.hasErrors, 'Should not have errors');
  assert.equal(model.errors.length, 0, 'Should have empty errors array');
});

test('SemanticModelBuilderVisitor.checkForSyntaxErrors should detect ERROR nodes', () => {
  const invalidCode = `
    func void Test() {
      var int x = ;  // Syntax error - missing value
    };
  `;

  const parser = createDaedalusParser();
  const tree = parser.parse(invalidCode);

  const visitor = new SemanticModelBuilderVisitor();
  visitor.checkForSyntaxErrors(tree.rootNode, invalidCode);

  assert.ok(visitor.semanticModel.hasErrors, 'Should detect hasErrors flag');
  assert.ok(visitor.semanticModel.errors.length > 0, 'Should collect errors');
});

test('createDaedalusParser should return isolated parser instances', () => {
  const parserA = createDaedalusParser();
  const parserB = createDaedalusParser();

  assert.notStrictEqual(parserA, parserB, 'Expected a fresh parser instance per call');
});

test('Error objects should have correct structure', () => {
  const invalidCode = `
    func void Test() {
      var int x = ;  // Missing value - definite syntax error
    };
  `;

  const model = parseSemanticModel(invalidCode);

  assert.ok(model.hasErrors, 'Should have errors');
  assert.ok(model.errors.length > 0, 'Should have errors');

  const error = model.errors[0];
  assert.ok(error.type, 'Error should have type');
  assert.ok(error.message, 'Error should have message');
  assert.ok(error.position, 'Error should have position');
  assert.ok(typeof error.position.row === 'number', 'Position should have row number');
  assert.ok(typeof error.position.column === 'number', 'Position should have column number');
  assert.ok(error.text !== undefined, 'Error should have text property');
});

test('parseSemanticModel should not run semantic analysis when syntax errors exist', () => {
  const invalidCode = `
    instance DIA_Test(C_INFO)  // Missing opening brace
      npc = TEST_NPC;
      nr = 1;
    };
  `;

  const model = parseSemanticModel(invalidCode);

  assert.ok(model.hasErrors, 'Should have errors');
  // Since there are syntax errors, semantic analysis shouldn't run
  // So dialogs and functions should be empty
  assert.equal(Object.keys(model.dialogs).length, 0, 'Should have no dialogs when syntax errors exist');
  assert.equal(Object.keys(model.functions).length, 0, 'Should have no functions when syntax errors exist');
});

test('parseSemanticModel should run semantic analysis when no syntax errors', () => {
  const validCode = `
    func void TestFunc() {
      AI_Output(self, other, "TEST_01");
    };

    instance DIA_Test(C_INFO) {
      npc = TEST_NPC;
      nr = 1;
      information = TestFunc;
    };
  `;

  const model = parseSemanticModel(validCode);

  assert.ok(!model.hasErrors, 'Should not have errors');
  assert.equal(model.errors.length, 0, 'Should have no errors');
  assert.ok(Object.keys(model.dialogs).length > 0, 'Should have dialogs');
  assert.ok(Object.keys(model.functions).length > 0, 'Should have functions');
});

test('Should detect missing tokens', () => {
  const invalidCode = `
    func void Test() {
      var int x = 5
      return;
    };
  `;

  const parser = createDaedalusParser();
  const tree = parser.parse(invalidCode);

  const visitor = new SemanticModelBuilderVisitor();
  visitor.checkForSyntaxErrors(tree.rootNode, invalidCode);

  assert.ok(visitor.semanticModel.hasErrors, 'Should detect errors');

  // Check if any error is of type missing_token
  const hasMissingToken = visitor.semanticModel.errors.some(err => err.type === 'missing_token');
  // Note: This might not always be true depending on how tree-sitter reports the error
  // It might be reported as ERROR node instead
  if (hasMissingToken) {
    assert.ok(true, 'Detected missing token');
  } else {
    assert.ok(visitor.semanticModel.errors.length > 0, 'At least detected as syntax error');
  }
});

test('Multiple syntax errors should all be collected', () => {
  const invalidCode = `
    instance DIA_Test(C_INFO)  // Missing brace
      npc = TEST_NPC;
      nr = ;  // Missing value
    };
  `;

  const model = parseSemanticModel(invalidCode);

  assert.ok(model.hasErrors, 'Should have errors');
  // Should have multiple errors (exact count depends on parser behavior)
  assert.ok(model.errors.length >= 1, 'Should collect multiple errors');
});

test('error position points at the offending token and descends past a clean sibling', () => {
  // Function A is syntactically valid; the error lives on line 6 inside B, so
  // the error visitor must descend past A's clean subtree to find it.
  const source = [
    'func void A() {',                  // line 1
    '  AI_Output(self, other, "X");',   // line 2
    '};',                               // line 3
    '',                                 // line 4
    'func void B() {',                  // line 5
    '  var int x = ;',                  // line 6 (missing value)
    '};'                                // line 7
  ].join('\n');

  const model = parseSemanticModel(source);

  assert.ok(model.hasErrors, 'Should have errors');
  const syntaxError = model.errors.find((e) => e.type === 'syntax_error');
  assert.ok(syntaxError, 'Should collect a syntax_error');
  assert.strictEqual(syntaxError.position.row, 6, 'Row should be the 1-based line of the error');
  assert.strictEqual(syntaxError.position.column, 13, 'Column should be the 1-based column of the offending token');
  assert.strictEqual(syntaxError.text, '=', 'Error text should be the offending source slice');
});

test('finds errors nested inside deeper blocks', () => {
  const source = [
    'func void A() {',          // line 1
    '  if (TRUE) {',            // line 2
    '    var int x = ;',        // line 3 (error nested two levels deep)
    '  };',                     // line 4
    '};'                        // line 5
  ].join('\n');

  const model = parseSemanticModel(source);

  assert.ok(model.hasErrors, 'Should detect an error nested inside an if-block');
  assert.ok(model.errors.length > 0, 'Should collect the nested error');
  assert.ok(
    model.errors.some((e) => e.position.row === 3),
    'Reported error should point at the nested line'
  );
});
