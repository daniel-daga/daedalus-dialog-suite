const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');

test('condition function with else falls back to raw Action', () => {
  const source = `
  func int DIA_Test_Cond()
  {
    if (Npc_KnowsInfo(other, DIA_Test))
    {
      return TRUE;
    }
    else
    {
      AI_Output(self, other, "DIA_Test_01");
    };
  };

  instance DIA_Test(C_INFO)
  {
    condition = DIA_Test_Cond;
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Cond;
  assert.ok(func, 'Function should be parsed');

  assert.equal(func.conditions.length, 0, 'Should not keep parsed conditions');
  assert.ok(func.actions.length > 0, 'Should preserve raw actions');
  assert.equal(func.actions[0].constructor.name, 'Action', 'Should store raw Action');
  assert.ok(func.actions[0].action.includes('if (Npc_KnowsInfo(other, DIA_Test))'), 'Action should contain full if statement');

  const generated = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false }).generateFunction(func);
  assert.ok(generated.includes('else'), 'Generated raw function should preserve else branch');
  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.errors?.length || 0, 0, 'Generated raw function should parse without syntax errors');
});

// Note: this previously asserted raw-Action fallback, but only because the
// function preceded its instance and condition mode was never entered (review
// finding F7). Instance-first ordering already produced structured conditions;
// both orders now behave identically: unsupported calls inside the if condition
// become generic Condition entries whose raw text roundtrips unchanged.
test('condition function with unsupported call keeps it as a generic condition', () => {
  const source = `
  func int DIA_Test_Cond()
  {
    if (Npc_KnowsInfo(other, DIA_Test) && AI_Output(self, other, "DIA_Test_01"))
    {
      return TRUE;
    };
  };

  instance DIA_Test(C_INFO)
  {
    condition = DIA_Test_Cond;
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Cond;
  assert.ok(func, 'Function should be parsed');

  assert.equal(func.conditions.length, 2, 'Both operands should be captured as conditions');
  assert.equal(func.conditions[0].constructor.name, 'NpcKnowsInfoCondition');
  assert.equal(func.conditions[1].constructor.name, 'Condition', 'Unsupported call should become a generic condition');
  assert.ok(func.conditions[1].condition.includes('AI_Output(self, other, "DIA_Test_01")'));
  assert.equal(func.actions.length, 0, 'No raw actions should be produced');

  const generated = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false }).generateFunction(func);
  assert.ok(generated.includes('AI_Output(self, other, "DIA_Test_01")'), 'Generated condition should preserve the call text');
});

test('condition function with a top-level statement call falls back to raw Action', () => {
  const source = `
  instance DIA_Raw(C_INFO)
  {
    condition = DIA_Raw_Cond;
  };

  func int DIA_Raw_Cond()
  {
    B_SomeSideEffect(self);
    if (Npc_KnowsInfo(other, DIA_Test))
    {
      return TRUE;
    };
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Raw_Cond;
  assert.ok(func, 'Function should be parsed');

  assert.equal(func.conditions.length, 0, 'Raw mode should clear parsed conditions');
  assert.ok(func.actions.length > 0, 'Should preserve raw actions');
  assert.equal(func.actions[0].constructor.name, 'Action', 'Should store raw Action');
  assert.ok(func.actions[0].action.includes('B_SomeSideEffect(self);'), 'Raw action should contain the statement call');
});

test('condition function with supported expressions parses conditions', () => {
  const source = `
  instance DIA_Test(C_INFO)
  {
    condition = DIA_Test_Cond;
  };

  func int DIA_Test_Cond()
  {
    if (Npc_KnowsInfo(other, DIA_Test) && MIS_Test == TRUE)
    {
      return TRUE;
    };
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Cond;
  assert.ok(func, 'Function should be parsed');

  assert.ok(func.conditions.length > 0, 'Should keep parsed conditions');
  assert.equal(func.actions.length, 0, 'Should not preserve raw actions');
});

test('condition function with top-level return fallback preserves the whole body in source order (P2)', () => {
  const source = `
  instance DIA_Test(C_INFO)
  {
    condition = DIA_Test_Cond;
  };

  func int DIA_Test_Cond()
  {
    if (Npc_KnowsInfo(other, DIA_Test))
    {
      return TRUE;
    };
    return FALSE;
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Cond;
  assert.ok(func, 'Function should be parsed');
  assert.equal(func.conditions.length, 0, 'Should preserve raw when explicit top-level return exists');

  // P2: the `if` block consumed into conditions before the trigger must NOT be
  // dropped — both the if-block and the trailing return survive, in source order.
  assert.equal(func.actions.length, 2, 'Should preserve both the if block and the trailing return');
  assert.ok(func.actions[0].action.includes('if (Npc_KnowsInfo(other, DIA_Test))'), 'First action is the if block');
  assert.ok(func.actions[0].action.includes('return TRUE;'), 'If block keeps its true path');
  assert.equal(func.actions[1].action.trim(), 'return FALSE;', 'Second action is the trailing return');

  const generated = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false }).generateFunction(func);
  const ifIndex = generated.indexOf('if (Npc_KnowsInfo(other, DIA_Test))');
  const falseIndex = generated.indexOf('return FALSE;');
  assert.ok(ifIndex >= 0, 'Generated function should preserve the if block');
  assert.ok(falseIndex >= 0, 'Generated function should preserve the explicit false return');
  assert.ok(ifIndex < falseIndex, 'The if block must precede the trailing return');

  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.errors?.length || 0, 0, 'Generated raw function should parse without syntax errors');
});

test('condition function preserves an interleaved body with no duplicated statements (P2)', () => {
  const source = `
  instance DIA_Inter(C_INFO)
  {
    condition = DIA_Inter_Cond;
  };

  func int DIA_Inter_Cond()
  {
    if (Npc_KnowsInfo(other, DIA_A))
    {
      return TRUE;
    };
    AI_Output(self, other, "DIA_Inter_01");
    if (Npc_KnowsInfo(other, DIA_B))
    {
      return TRUE;
    };
    return FALSE;
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Inter_Cond;
  assert.ok(func, 'Function should be parsed');
  assert.equal(func.conditions.length, 0, 'Raw mode should clear structured conditions');

  // All four top-level statements survive exactly once, in source order.
  assert.equal(func.actions.length, 4, 'All four top-level statements preserved with no duplicates');
  assert.ok(func.actions[0].action.includes('DIA_A'), 'First statement is the DIA_A if block');
  assert.equal(func.actions[1].action.trim(), 'AI_Output(self, other, "DIA_Inter_01");', 'Second statement is the AI_Output');
  assert.ok(func.actions[2].action.includes('DIA_B'), 'Third statement is the DIA_B if block');
  assert.equal(func.actions[3].action.trim(), 'return FALSE;', 'Fourth statement is the trailing return');

  const generated = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false }).generateFunction(func);
  // No statement should appear twice.
  const outputMatches = generated.match(/AI_Output\(self, other, "DIA_Inter_01"\);/g) || [];
  assert.equal(outputMatches.length, 1, 'The AI_Output statement must not be duplicated');

  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.errors?.length || 0, 0, 'Generated raw function should parse without syntax errors');
});

test('legacy if/else-if condition fallback does not introduce extra closing braces', () => {
  const source = `
  instance DIA_Hubert_TinteAmt(C_INFO)
  {
    condition = DIA_Hubert_TinteAmt_Condition;
  };

  func int DIA_Hubert_TinteAmt_Condition ()
  {
    if (Npc_KnowsInfo (other, DIA_Matthias_Tinte))
    && (Kapitel == 1)
    {
      return TRUE;
    }

    else if (Kapitel == 2)
    {
      AI_Output (other, self, "DIA_Hubert_TinteAmt_02_01");
      AI_Output (self, other, "DIA_Hubert_TinteAmt_01_00");
    };
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Hubert_TinteAmt_Condition;
  assert.ok(func, 'Function should be parsed');
  assert.equal(func.conditions.length, 0, 'Should fall back to raw mode due to side effects');
  assert.ok(func.actions.length > 0, 'Should preserve raw statement');

  const generated = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false }).generateFunction(func);
  assert.ok(
    !generated.includes('};\n};\n};') && !generated.includes('};\r\n};\r\n};'),
    'Generated condition function should not contain triple closing braces'
  );

  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.errors?.length || 0, 0, 'Generated output should be syntactically valid');
});

test('condition function with local var declaration falls back to raw preservation', () => {
  const source = `
  func int DIA_Test_VarCond()
  {
    var int stateTime;
    stateTime = Npc_GetStateTime(self);
    if (stateTime > 5)
    {
      return TRUE;
    };
  };

  instance DIA_TestVar(C_INFO)
  {
    condition = DIA_Test_VarCond;
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_VarCond;
  assert.ok(func, 'Function should be parsed');
  assert.equal(func.conditions.length, 0, 'Raw mode should not keep structured conditions');

  const generated = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false }).generateFunction(func);
  assert.ok(generated.includes('var int stateTime;'), `Local declaration should be preserved. Got:\n${generated}`);
  assert.ok(generated.includes('stateTime = Npc_GetStateTime(self);'), 'Assignment should be preserved');
  assert.ok(generated.includes('if (stateTime > 5)'), 'If statement should be preserved');

  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.errors?.length || 0, 0, 'Generated function should parse without syntax errors');
});
