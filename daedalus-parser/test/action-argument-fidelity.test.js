// Argument fidelity round-trips for recognized action calls.
//
// Covers fix-01 steps 1 (P4 arity fallback + N8) and 3 (P3 numeric fidelity):
// a recognized call must regenerate token-equal to its source, numeric
// arguments that are identifiers/expressions (or literal zeros) must survive,
// and a recognized call with the wrong argument count must fall back to a
// verbatim generic action instead of being dropped or coerced.
//
// The table is intentionally structured so the P5/N1 quoting cases (string vs
// identifier arguments) can be appended by a follow-up agent: add rows with a
// `source` and, where useful, an `assert` callback.

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const DaedalusParser = require('../src/core/parser');
const { SemanticModelBuilderVisitor } = require('../dist/semantic/semantic-visitor');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');

const parser = DaedalusParser.create();

function tokenTexts(source) {
  const result = parser.parse(source);
  assert.equal(result.hasErrors, false, `source should parse cleanly: ${source}`);
  const tokens = [];
  const walk = (node) => {
    if (node.childCount === 0) {
      tokens.push(node.text);
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  };
  walk(result.rootNode);
  return tokens;
}

function buildModel(source) {
  const result = parser.parse(source);
  assert.equal(result.hasErrors, false, 'Should parse without errors');
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(result.rootNode);
  visitor.pass2_analyzeAndLink(result.rootNode);
  return visitor.semanticModel;
}

function wrapInInfoFunction(body) {
  return `func void DIA_T_Info()\n{\n\t${body}\n};\n`;
}

// Each case: a single action statement placed in an info function body.
// `assert` (optional) receives the parsed action for structural checks.
const cases = [
  {
    name: 'CreateInvItems preserves a constant amount argument',
    body: 'CreateInvItems (self, ItMi_Gold, Gold_Amount);',
    assert: (action) => {
      assert.equal(action.type, 'CreateInventoryItems');
      assert.equal(action.quantity, 'Gold_Amount');
    }
  },
  {
    name: 'B_GiveInvItems preserves a literal zero amount',
    body: 'B_GiveInvItems (self, other, ItMi_Gold, 0);',
    assert: (action) => {
      assert.equal(action.type, 'GiveInventoryItems');
      assert.strictEqual(action.quantity, 0);
    }
  },
  {
    name: 'Npc_SetRefuseTalk preserves a constant seconds argument',
    body: 'Npc_SetRefuseTalk (self, RefuseSeconds);',
    assert: (action) => {
      assert.equal(action.type, 'SetRefuseTalkAction');
      assert.equal(action.seconds, 'RefuseSeconds');
    }
  },
  {
    name: 'B_Kapitelwechsel preserves a constant chapter and a negative literal is numeric',
    body: 'B_Kapitelwechsel (KAPITEL_NR, NEWWORLD);',
    assert: (action) => {
      assert.equal(action.type, 'ChapterTransitionAction');
      assert.equal(action.chapter, 'KAPITEL_NR');
    }
  },
  {
    name: 'Npc_RemoveInvItem (2 args) parses structurally and round-trips',
    body: 'Npc_RemoveInvItem (self, ItMi_Gold);',
    assert: (action) => {
      assert.equal(action.type, 'RemoveInventoryItemsAction');
      assert.equal(action.removeQuantity, undefined);
    }
  },
  {
    name: 'Npc_RemoveInvItems (3 args) parses structurally and round-trips',
    body: 'Npc_RemoveInvItems (self, ItMi_Gold, 5);',
    assert: (action) => {
      assert.equal(action.type, 'RemoveInventoryItemsAction');
      assert.equal(action.removeQuantity, '5');
    }
  },
  {
    name: 'Npc_RemoveInvItems with wrong arity (2 args) falls back to a generic action',
    body: 'Npc_RemoveInvItems (self, ItMi_Gold);',
    assert: (action) => {
      assert.equal(action.type, 'Action');
    }
  },
  {
    name: 'AI_Output with wrong arity (2 args) falls back to a generic action',
    body: 'AI_Output (self, other);',
    assert: (action) => {
      assert.equal(action.type, 'Action');
    }
  }
];

for (const testCase of cases) {
  test(`argument fidelity: ${testCase.name}`, () => {
    const source = wrapInInfoFunction(testCase.body);
    const model = buildModel(source);

    const func = model.functions['DIA_T_Info'];
    assert.ok(func, 'info function should exist');
    assert.equal(func.actions.length, 1, 'exactly one action should be recorded (never dropped)');

    if (testCase.assert) {
      testCase.assert(func.actions[0]);
    }

    const generator = new SemanticCodeGenerator({
      includeComments: true,
      sectionHeaders: false,
      preserveSourceStyle: true
    });
    const generated = generator.generateSemanticModel(model);

    assert.deepEqual(
      tokenTexts(generated),
      tokenTexts(source),
      `generated output should be token-equal to source.\n--- source ---\n${source}\n--- generated ---\n${generated}`
    );
  });
}
