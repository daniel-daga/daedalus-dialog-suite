const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');

test('parses supported if/else action blocks into structured conditional actions', () => {
  const source = `
  func void DIA_Test_Info()
  {
    if (Wld_GetDay() == 0)
    {
      AI_Output (self, other, "DIA_Test_00"); //Heute
    }
    else
    {
      B_GiveInvItems (self, other, ItFo_Fishsoup, 1);
      if (Npc_KnowsInfo (other, DIA_Other))
      {
        AI_Output (self, other, "DIA_Test_01"); //Nested
      };
    };
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;

  assert.ok(func, 'Function should be parsed');
  assert.equal(func.actions.length, 1, 'Top-level actions should contain one conditional block');

  const conditional = func.actions[0];
  assert.equal(conditional.type, 'ConditionalAction');
  assert.equal(conditional.condition, 'Wld_GetDay() == 0');
  assert.equal(conditional.thenActions.length, 1);
  assert.equal(conditional.thenActions[0].type, 'DialogLine');
  assert.equal(conditional.elseActions.length, 2);
  assert.equal(conditional.elseActions[0].type, 'GiveInventoryItems');
  assert.equal(conditional.elseActions[1].type, 'ConditionalAction');

  const nested = conditional.elseActions[1];
  assert.equal(nested.condition, 'Npc_KnowsInfo (other, DIA_Other)');
  assert.equal(nested.thenActions.length, 1);
  assert.equal(nested.elseActions.length, 0);
});

test('generates structured conditional actions back to valid if/else source', () => {
  const source = `
  func void DIA_Test_Info()
  {
    if (Wld_GetDay() == 0)
    {
      AI_Output (self, other, "DIA_Test_00"); //Heute
    }
    else
    {
      B_GiveInvItems (self, other, ItFo_Fishsoup, 1);
    };
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  const generated = generator.generateFunction(func);

  assert.ok(generated.includes('if (Wld_GetDay() == 0)'), 'Generated code should include the if condition');
  assert.ok(generated.includes('else'), 'Generated code should include the else branch');
  assert.ok(generated.includes('B_GiveInvItems'), 'Generated code should include nested branch actions');

  const reparsed = parseSemanticModel(generated);
  const reparsedConditional = reparsed.functions.DIA_Test_Info.actions[0];
  assert.equal(reparsedConditional.type, 'ConditionalAction', 'Generated code should roundtrip back into structured action');
  assert.equal(reparsedConditional.elseActions.length, 1);
});

test('falls back to raw actions for else-if statements', () => {
  const source = `
  func void DIA_Test_Info()
  {
    if (Wld_GetDay() == 0)
    {
      AI_Output (self, other, "DIA_Test_00");
    }
    else if (Wld_GetDay() == 1)
    {
      AI_Output (self, other, "DIA_Test_01");
    };
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;

  assert.ok(func, 'Function should be parsed');
  assert.equal(func.actions.length, 1, 'Unsupported else-if should still preserve a single action');
  assert.equal(func.actions[0].type, 'Action');
  assert.ok(func.actions[0].action.includes('else if'), 'Fallback action should keep the original else-if text');
});

test('does not emit an extra closing brace when else branch is empty', () => {
  const source = `
  func void DIA_Test_Info()
  {
    if (Wld_GetDay() == 0)
    {
      AI_Output (self, other, "DIA_Test_00"); //Heute
    };
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  const generated = generator.generateFunction(func);

  assert.ok(generated.includes('if (Wld_GetDay() == 0)'), 'Generated code should include the if condition');
  assert.ok(generated.includes('\n\t};\n'), 'Generated code should close the if block once');
  assert.ok(!generated.includes('\n\t}\n\t};\n'), 'Generated code should not emit a second closing brace when else is empty');
});
