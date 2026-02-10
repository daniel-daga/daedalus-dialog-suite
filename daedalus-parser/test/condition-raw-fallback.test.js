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

test('condition function with unsupported call falls back to raw Action', () => {
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

  assert.equal(func.conditions.length, 0, 'Should not keep parsed conditions');
  assert.ok(func.actions.length > 0, 'Should preserve raw actions');
  assert.equal(func.actions[0].constructor.name, 'Action', 'Should store raw Action');
  assert.ok(func.actions[0].action.includes('AI_Output(self, other, "DIA_Test_01")'), 'Action should contain unsupported call');
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

test('condition function with top-level return fallback preserves explicit false path', () => {
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
  assert.ok(func.actions.length > 0, 'Should preserve raw actions');

  const generated = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false }).generateFunction(func);
  assert.ok(generated.includes('return FALSE;'), 'Generated raw function should preserve explicit false return');
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
