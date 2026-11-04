const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel, deserializeAction, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');

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

const ELSE_IF_SOURCE = `
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

test('parses else-if into a conditional chain rather than one raw action', () => {
  const model = parseSemanticModel(ELSE_IF_SOURCE);
  const func = model.functions.DIA_Test_Info;

  assert.ok(func, 'Function should be parsed');
  assert.equal(func.actions.length, 1, 'The whole statement is one conditional action');

  const conditional = func.actions[0];
  assert.equal(conditional.type, 'ConditionalAction');
  assert.equal(conditional.condition, 'Wld_GetDay() == 0');
  assert.equal(conditional.elseActions.length, 1, 'The else-if is the lone else action');

  const chained = conditional.elseActions[0];
  assert.equal(chained.type, 'ConditionalAction');
  assert.equal(chained.elseIf, true, 'The lone else action is marked as the else-if');
  assert.equal(chained.condition, 'Wld_GetDay() == 1');
  assert.equal(chained.thenActions.length, 1);
  assert.equal(chained.thenActions[0].type, 'DialogLine');
  assert.equal(conditional.elseIf, undefined, 'Only the chained conditional carries the marker');

  const hydrated = deserializeAction(JSON.parse(JSON.stringify(conditional)));
  assert.equal(hydrated.elseActions[0].elseIf, true, 'The marker survives the editor IPC round trip');
});

test('generates an else-if chain as else if, not else { if }', () => {
  const model = parseSemanticModel(ELSE_IF_SOURCE);
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  const generated = generator.generateFunction(model.functions.DIA_Test_Info);

  assert.ok(generated.includes('else if (Wld_GetDay() == 1)'), 'The chain is written as else if');
  assert.ok(!generated.includes('else\n\t{\n\t\tif'), 'The chain is not nested in an else block');

  const reparsed = parseSemanticModel(generated);
  const chained = reparsed.functions.DIA_Test_Info.actions[0].elseActions[0];
  assert.equal(chained.type, 'ConditionalAction', 'The generated chain reparses structured');
  assert.equal(chained.elseIf, true);
});

test('keeps a conditional nested in an else block as a nested card and round-trips it', () => {
  const source = `
  func void DIA_Test_Info()
  {
    if (Wld_GetDay() == 0)
    {
      AI_Output (self, other, "DIA_Test_00");
    }
    else
    {
      if (Wld_GetDay() == 1)
      {
        AI_Output (self, other, "DIA_Test_01");
      };
    };
  };
  `;

  const model = parseSemanticModel(source);
  const nested = model.functions.DIA_Test_Info.actions[0].elseActions[0];
  assert.equal(nested.type, 'ConditionalAction');
  assert.equal(nested.elseIf, undefined, 'Source written as an else block never gains the marker');

  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  const once = generator.generateFunction(model.functions.DIA_Test_Info);
  assert.ok(once.includes('else\n\t{\n\t\tif (Wld_GetDay() == 1)'), 'It keeps its own nested form');
  assert.ok(!once.includes('else if'), 'It never becomes else if');

  const twice = generator.generateFunction(parseSemanticModel(once).functions.DIA_Test_Info);
  assert.equal(twice, once, 'The nested form round-trips unchanged');
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
