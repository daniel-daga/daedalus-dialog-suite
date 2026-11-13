const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel, SemanticModelBuilderVisitor, createDaedalusParser } = require('../dist/semantic/semantic-visitor-index');
const DaedalusParser = require('../src/core/parser');

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

// ===================================================================
// P7: hasErrors guard in the code generator
// ===================================================================

const { SemanticCodeGenerator } = require('../dist/codegen/generator');
const { DialogFunction, DialogLine, deserializeSemanticModel } = require('../dist/semantic/semantic-model');

test('generateSemanticModel throws on a model with parse errors', () => {
  const model = parseSemanticModel(`
    func void Broken() {
      var int x = ;
    };
  `);
  assert.ok(model.hasErrors, 'precondition: model should have errors');

  const generator = new SemanticCodeGenerator();
  assert.throws(
    () => generator.generateSemanticModel(model),
    /parse error/i,
    'should refuse to generate from an errored model'
  );
});

test('generateSemanticModel with allowPartialModel: true generates from an errored model', () => {
  const model = parseSemanticModel(`
    func void Broken() {
      var int x = ;
    };
  `);
  assert.ok(model.hasErrors, 'precondition: model should have errors');

  const generator = new SemanticCodeGenerator({ allowPartialModel: true });
  let output;
  assert.doesNotThrow(() => {
    output = generator.generateSemanticModel(model);
  }, 'should not throw when opted in');
  assert.equal(typeof output, 'string', 'should return a (best-effort) string when opted in');
});

test('generateFunction is unaffected by the hasErrors guard', () => {
  // Hand-built partial models are legitimate for the single-function entry point.
  const generator = new SemanticCodeGenerator();
  const func = new DialogFunction('DIA_Test_Info', 'void');
  func.actions.push(new DialogLine('self', 'Hello', 'DIA_TEST_01'));

  const output = generator.generateFunction(func);
  assert.ok(output.includes('DIA_Test_Info'), 'generateFunction should still emit the function');
});

// ===================================================================
// DUPLICATE FUNCTION DECLARATIONS (#396)
// ===================================================================

test('a function declared twice is flagged, not silently overwritten', () => {
  const model = parseSemanticModel(`
    func void Hlp_GetInstanceID(var C_NPC npc) {};
    func void Hlp_GetInstanceID(var c_npc renamed) {};
  `);

  assert.ok(model.hasErrors, 'a duplicate declaration should set hasErrors');
  const duplicate = model.errors.find(e => e.type === 'duplicate_declaration');
  assert.ok(duplicate, 'a duplicate_declaration error should be recorded');
  assert.match(duplicate.message, /Hlp_GetInstanceID/);
  assert.equal(duplicate.position.row, 3, 'the error should point at the second declaration');
});

test('a duplicate declaration keeps the first declaration in the model', () => {
  const model = parseSemanticModel(`
    func void Hlp_GetInstanceID(var C_NPC npc) {};
    func void Hlp_GetInstanceID(var C_NPC renamed) {};
  `);

  const kept = model.functions.Hlp_GetInstanceID;
  assert.equal(kept.parameters.length, 1);
  assert.equal(kept.parameters[0].type, 'C_NPC');
  assert.equal(model.declarationOrder.filter(d => d.name === 'Hlp_GetInstanceID').length, 1,
    'the duplicate should not be listed in declaration order');
});

test('a function whose name differs only in case is a duplicate', () => {
  const model = parseSemanticModel(`
    func void MyFunc() {};
    func void myfunc() {};
  `);

  assert.ok(model.errors.some(e => e.type === 'duplicate_declaration'),
    'Daedalus names are case-insensitive, so this is a duplicate');
});

test('the code generator refuses to emit a model with a duplicate declaration', () => {
  const model = parseSemanticModel(`
    func void Hlp_GetInstanceID(var C_NPC npc) {};
    func void Hlp_GetInstanceID(var C_NPC npc) {};
  `);

  const generator = new SemanticCodeGenerator();
  assert.throws(() => generator.generateSemanticModel(model), /Refusing to generate/,
    'saving must not drop the second declaration silently');
});

test('different parameter signatures survive generation and JSON hydration (#557)', () => {
  const { deserializeSemanticModel } = require('../dist/semantic/semantic-model');
  const source = [
    '// NPC lookup',
    'FUNC INT Hlp_GetInstanceID(VAR C_NPC npc) { return 1; };',
    '// Item lookup',
    'FUNC INT Hlp_GetInstanceID(VAR C_ITEM item) { return 2; };',
    '// Another arity and case',
    'func int hlp_getinstanceid() { return 3; };'
  ].join('\n');
  const parsed = parseSemanticModel(source);
  assert.ok(!parsed.hasErrors, JSON.stringify(parsed.errors));
  assert.equal(parsed.functions.Hlp_GetInstanceID.parameters[0].type, 'C_NPC');
  const generator = new SemanticCodeGenerator();
  for (const model of [parsed, deserializeSemanticModel(JSON.parse(JSON.stringify(parsed)))]) {
    const output = generator.generateSemanticModel(model);
    assert.equal((output.match(/func int hlp_getinstanceid/gi) || []).length, 3);
    assert.ok(output.includes('// Item lookup\nFUNC INT Hlp_GetInstanceID(VAR C_ITEM item) { return 2; };'));
    for (const value of [1, 2, 3]) {
      assert.equal((output.match(new RegExp(`return ${value};`, 'g')) || []).length, 1);
    }
    assert.ok(!parseSemanticModel(output).hasErrors);
  }
});

test('a repeated overload signature is still rejected (#557)', () => {
  const model = parseSemanticModel([
    'func int Lookup(var C_NPC npc) { return 1; };',
    'func int Lookup(var C_ITEM item) { return 2; };',
    'func void lookup(var c_item renamed) {};'
  ].join('\n'));
  const duplicates = model.errors.filter(e => e.type === 'duplicate_declaration');
  assert.equal(duplicates.length, 1, 'return type and parameter names do not distinguish signatures');
  assert.equal(duplicates[0].position.row, 3);
});

test('array signature identity ignores whitespace, comments and identifier case (#557)', () => {
  for (const size of ['n + 1', 'N /* size */ + 1', 'N // size\n + 1']) {
    const model = parseSemanticModel([
      'func void F(var int a[N+1]) {};',
      `func void f(var int renamed[${size}]) {};`
    ].join('\n'));
    const duplicates = model.errors.filter(e => e.type === 'duplicate_declaration');
    assert.equal(duplicates.length, 1, size);
    assert.equal(duplicates[0].position.row, 2);
  }
  const distinct = parseSemanticModel([
    'func void F(var int a[N+1]) {};',
    'func void F(var int a[N+2]) {};'
  ].join('\n'));
  assert.ok(!distinct.hasErrors, JSON.stringify(distinct.errors));
});

// ===================================================================
// DUPLICATES OF EVERY DECLARATION KIND (#447)
// ===================================================================

const duplicateError = (model, name) => model.errors.find(
  e => e.type === 'duplicate_declaration' && e.text === name
);

test('a dialog declared twice is flagged and the second body is not merged into it (#447)', () => {
  const model = parseSemanticModel([
    'instance DIA_DUP(C_INFO) { nr = 1; important = 1; };',
    'instance DIA_DUP(C_INFO) { nr = 2; };'
  ].join('\n'));

  assert.ok(model.hasErrors, 'a duplicate dialog cannot be saved silently');
  const duplicate = duplicateError(model, 'DIA_DUP');
  assert.ok(duplicate, 'a duplicate_declaration error should name the dialog');
  assert.equal(duplicate.position.row, 2, 'the error should point at the second declaration');

  assert.equal(Object.keys(model.dialogs).length, 1, 'one dialog symbol');
  assert.equal(model.dialogs.DIA_DUP.line, 1, 'the first declaration is kept');
  assert.equal(model.dialogs.DIA_DUP.properties.nr, 1, 'the second body must not be merged in');
  assert.equal(model.declarationOrder.filter(d => d.name === 'DIA_DUP').length, 1,
    'the duplicate should not be listed in declaration order');
});

test('an instance declared twice is flagged and the first declaration is kept (#447)', () => {
  const model = parseSemanticModel([
    'instance DUP_NPC(C_NPC) { name = "First"; };',
    'instance DUP_NPC(C_NPC) { name = "Second"; };'
  ].join('\n'));

  assert.ok(model.hasErrors, 'a duplicate instance cannot be saved silently');
  const duplicate = duplicateError(model, 'DUP_NPC');
  assert.ok(duplicate, 'a duplicate_declaration error should name the instance');
  assert.equal(duplicate.position.row, 2);

  assert.equal(model.instances.DUP_NPC.displayName, 'First', 'the second declaration is not kept');
  assert.strictEqual(model.npcs.DUP_NPC, model.instances.DUP_NPC, 'only one object is indexed');
  assert.equal(model.declarationOrder.filter(d => d.name === 'DUP_NPC').length, 1);
});

test('a class declared twice is flagged and the first declaration is kept (#447)', () => {
  const model = parseSemanticModel([
    'class DUP_CLASS { var int first; };',
    'class DUP_CLASS { var int second; };'
  ].join('\n'));

  assert.ok(model.hasErrors, 'a duplicate class cannot be saved silently');
  const duplicate = duplicateError(model, 'DUP_CLASS');
  assert.ok(duplicate, 'a duplicate_declaration error should name the class');
  assert.equal(duplicate.position.row, 2);

  assert.equal(Object.keys(model.classes).length, 1, 'one class symbol');
  assert.match(model.classes.DUP_CLASS.sourceText, /var int first/, 'the first declaration is kept');
  assert.equal(model.declarationOrder.filter(d => d.name === 'DUP_CLASS').length, 1);
});

test('a prototype declared twice is flagged and the first declaration is kept (#447)', () => {
  const model = parseSemanticModel([
    'prototype DUP_PROTO(C_MyRecord) { data = 1; };',
    'prototype DUP_PROTO(C_MyRecord) { data = 2; };'
  ].join('\n'));

  assert.ok(model.hasErrors, 'a duplicate prototype cannot be saved silently');
  const duplicate = duplicateError(model, 'DUP_PROTO');
  assert.ok(duplicate, 'a duplicate_declaration error should name the prototype');
  assert.equal(duplicate.position.row, 2);

  assert.equal(Object.keys(model.prototypes).length, 1, 'one prototype symbol');
  assert.match(model.prototypes.DUP_PROTO.sourceText, /data = 1;/, 'the first declaration is kept');
  assert.equal(model.declarationOrder.filter(d => d.name === 'DUP_PROTO').length, 1);
});

test('a constant declared twice is flagged and the first value is kept (#447)', () => {
  const model = parseSemanticModel([
    'const int DUP_C = 1;',
    'const int DUP_C = 2;'
  ].join('\n'));

  assert.ok(model.hasErrors, 'a duplicate constant cannot be saved silently');
  const duplicate = duplicateError(model, 'DUP_C');
  assert.ok(duplicate, 'a duplicate_declaration error should name the constant');
  assert.equal(duplicate.position.row, 2);

  assert.equal(Object.keys(model.constants).length, 1, 'one constant symbol');
  assert.equal(model.constants.DUP_C.value, 1, 'the second value must not win');
  assert.equal(model.declarationOrder.filter(d => d.name === 'DUP_C').length, 1,
    'the duplicate line must not be emitted on save');
});

test('a variable declared twice is flagged and the first declaration is kept (#447)', () => {
  const model = parseSemanticModel([
    'var int dup_v;',
    'var int dup_v = 7;'
  ].join('\n'));

  assert.ok(model.hasErrors, 'a duplicate variable cannot be saved silently');
  const duplicate = duplicateError(model, 'dup_v');
  assert.ok(duplicate, 'a duplicate_declaration error should name the variable');
  assert.equal(duplicate.position.row, 2);

  assert.equal(Object.keys(model.variables).length, 1, 'one variable symbol');
  assert.equal(model.variables.dup_v.sourceText, 'var int dup_v;', 'the first declaration is kept');
  assert.equal(model.declarationOrder.filter(d => d.name === 'dup_v').length, 1,
    'the duplicate line must not be emitted on save');
});

test('a name that differs only in case is a duplicate, not two symbols (#447)', () => {
  const model = parseSemanticModel([
    'instance CASE_DUP(C_NPC) { name = "First"; };',
    'instance case_dup(C_NPC) { name = "Second"; };'
  ].join('\n'));

  assert.ok(model.hasErrors, 'Daedalus names are case-insensitive, so this is a duplicate');
  assert.ok(duplicateError(model, 'case_dup'), 'the error names the second spelling');
  assert.equal(Object.keys(model.instances).length, 1, 'one symbol, not a pair every lookup treats as one');
  assert.equal(model.instances.CASE_DUP.displayName, 'First');
});

// ===================================================================
// ERRORS THAT REPORT NOTHING (#447)
// ===================================================================

test('a file that cannot be saved never has an empty error list (#447)', () => {
  // The missing name sits under a zero-width node, so the recursive error walk
  // never reaches it; without a fallback the file is unsaveable and silent.
  const model = parseSemanticModel('func Foo() {};');

  assert.ok(model.hasErrors, 'precondition: the file cannot be saved');
  assert.ok(model.errors.length > 0, 'hasErrors must always come with something to show');
  assert.equal(model.errors[0].position.row, 1, 'the error names the offending line');
  assert.ok(model.errors[0].message, 'the error carries a message');

  const generator = new SemanticCodeGenerator();
  assert.throws(() => generator.generateSemanticModel(model), /1 parse error/,
    'the save error counts the error the user is shown');
});

// #538: the visitors walk the tree recursively, so a file nested deeper than
// the JS stack used to throw `Maximum call stack size exceeded` out of the
// model build — at 1,842 nested ifs, or a 6,251-term expression — though
// tree-sitter parses it cleanly. It is reported as an error with a line now,
// both through parseSemanticModel and through the visitor calls the editor's
// parser worker makes itself.
describe('nesting deeper than the JS stack (#538)', () => {
  const nestedIfs = (depth, inner = 'x = 1;') =>
    `func void f()\n{\n${'if (a) {\n'.repeat(depth)}${inner}\n${'};\n'.repeat(depth)}};\n`;
  const longSum = `func void f()\n{\n\tx = ${'1+'.repeat(20000)}1;\n};\n`;
  // The linking walk still recurses through a condition function's guard.
  const longGuard = 'instance D(C_INFO)\n{\n\tcondition = D_C;\n};\n'
    + `func int D_C()\n{\n\tif (${'a && '.repeat(20000)}a)\n\t{\n\t\treturn TRUE;\n\t};\n};\n`;
  const nestedCalls = (depth) => `func void f()\n{\n\t${'f('.repeat(depth)}1${')'.repeat(depth)};\n};\n`;
  const savesLikeTheEditor = (model) => {
    const hydrated = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
    const generator = new SemanticCodeGenerator();
    assert.equal(generator.generateSemanticModel(hydrated), generator.generateSemanticModel(model));
  };

  const buildLikeTheWorker = (source) => {
    const { tree } = DaedalusParser.parseSource(source);
    const visitor = new SemanticModelBuilderVisitor();
    visitor.checkForSyntaxErrors(tree.rootNode, source);
    if (!visitor.semanticModel.hasErrors) {
      visitor.pass1_createObjects(tree.rootNode);
      visitor.pass2_analyzeAndLink(tree.rootNode);
    }
    return visitor.semanticModel;
  };

  for (const [label, source] of [['5,000 nested ifs', nestedIfs(5000)], ['a 20,000-clause guard', longGuard]]) {
    test(`${label}: an error with a line, not a thrown RangeError`, () => {
      for (const model of [parseSemanticModel(source), buildLikeTheWorker(source)]) {
        assert.equal(model.hasErrors, true);
        const error = model.errors.find(e => e.type === 'nesting_too_deep');
        assert.ok(error, `errors: ${JSON.stringify(model.errors)}`);
        assert.match(error.message, /too deeply nested.*line \d+/i);
        assert.ok(error.position.row > 2, 'points into the body, not at the file start');
      }
    });
  }

  test('a syntax error nested deeper than the JS stack keeps its own line', () => {
    const source = nestedIfs(20000, 'x = ;');
    const model = buildLikeTheWorker(source);
    assert.equal(model.hasErrors, true);
    assert.ok(model.errors.some(e => e.position.row === 20003), JSON.stringify(model.errors.slice(0, 3)));
  });

  test('a file within the limit still builds a model', () => {
    const model = parseSemanticModel(nestedIfs(200));
    assert.equal(model.hasErrors, false);
    assert.equal(model.functions.f.actions[0].type, 'ConditionalAction');
  });

  // The save path hydrates the model (deserializeSemanticModel) and generates
  // from it, and both recurse per conditional: hydration overflowed from ~900
  // nested ifs, below the ~1,840 the build reached. So the build refuses
  // nesting past a fixed bound, and everything under it saves.
  test('the deepest conditional the build accepts hydrates and generates as the save path does', () => {
    const model = parseSemanticModel(nestedIfs(256));
    assert.equal(model.hasErrors, false);
    savesLikeTheEditor(model);
  });

  // #541: the walk no longer descends into an expression, so a long one is
  // no nesting at all and builds; it must save too.
  test('a 20,000-term sum builds and saves', () => {
    const model = parseSemanticModel(longSum);
    assert.equal(model.hasErrors, false);
    savesLikeTheEditor(model);
  });

  // Every call site keeps its arguments' text, so f(f(f(...))) is quadratic:
  // 10,000 levels made a 287 MB model and 20,000 overflowed a string.
  test('the deepest call nesting the build accepts saves', () => {
    const model = parseSemanticModel(nestedCalls(256));
    assert.equal(model.hasErrors, false);
    savesLikeTheEditor(model);
  });

  for (const [label, source, row] of [
    ['one if past the bound', nestedIfs(257), 259],
    ['900 nested ifs', nestedIfs(900), 259],
    ['an else-if chain past the bound', `func void f()\n{\n\tif (a) {}${' else if (a) {}'.repeat(300)};\n};\n`, 3],
    ['one call past the bound', nestedCalls(257), 3],
    ['20,000 nested calls', nestedCalls(20000), 3]
  ]) {
    test(`${label} is refused where it crosses the bound`, () => {
      const model = parseSemanticModel(source);
      const error = model.errors.find(e => e.type === 'nesting_too_deep');
      assert.ok(error, JSON.stringify(model.errors));
      assert.equal(error.position.row, row);
    });
  }

  test('a RangeError that is not a stack overflow is not swallowed', () => {
    const visitor = new SemanticModelBuilderVisitor();
    const { tree } = DaedalusParser.parseSource('func void f() { x = 1; };');
    const node = new Proxy(tree.rootNode, {
      get(target, key) {
        if (key === 'walk') { return () => { throw new RangeError('Invalid array length'); }; }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    assert.throws(() => visitor.pass2_analyzeAndLink(node), /Invalid array length/);
  });
});
