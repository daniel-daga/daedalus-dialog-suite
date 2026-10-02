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
const { deserializeSemanticModel } = require('../dist/semantic/semantic-model');
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
    name: 'Npc_SetRefuseTalk with a missing seconds argument stays raw',
    body: 'Npc_SetRefuseTalk (self);',
    assert: (action) => {
      assert.equal(action.type, 'Action');
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
  },
  {
    name: 'AI_Output with an extra argument falls back to a generic action',
    body: 'AI_Output (self, other, "DIALOG_ID", EXTRA);',
    assert: (action) => {
      assert.equal(action.type, 'Action');
    }
  },
  {
    name: 'Info_AddChoice with an extra argument falls back to a generic action',
    body: 'Info_AddChoice (DIA_Test, "Choice", DIA_Test_Choice, EXTRA);',
    assert: (action) => {
      assert.equal(action.type, 'Action');
    }
  },
  // P5: identifier routine argument must not be turned into a string literal.
  {
    name: 'Npc_ExchangeRoutine preserves an identifier routine argument (P5)',
    body: 'Npc_ExchangeRoutine (self, Routine_Var);',
    assert: (action) => {
      assert.equal(action.type, 'ExchangeRoutineAction');
      assert.equal(action.routine, 'Routine_Var');
      assert.equal(action.routineIsExpression, true);
    }
  },
  // P5: a real string-literal routine argument keeps its quotes.
  {
    name: 'AI_PlayAni preserves a string-literal animation argument (P5)',
    body: 'AI_PlayAni (self, "T_STAND_2_SIT");',
    assert: (action) => {
      assert.equal(action.type, 'PlayAniAction');
      assert.equal(action.animationName, 'T_STAND_2_SIT');
      assert.ok(!action.animationNameIsExpression);
    }
  },
  // N1: a string-literal topic must regenerate as a valid, quoted argument.
  {
    name: 'Log_CreateTopic preserves a string-literal topic and reparses cleanly (N1)',
    body: 'Log_CreateTopic ("My Topic", LOG_MISSION);',
    assert: (action) => {
      assert.equal(action.type, 'CreateTopic');
      assert.equal(action.topic, '"My Topic"');
      assert.equal(action.topicType, 'LOG_MISSION');
    }
  },
  // N2: an identifier text argument must not be force-quoted.
  {
    name: 'B_LogEntry preserves an identifier text argument (N2)',
    body: 'B_LogEntry (TOPIC_Foo, TextConstant);',
    assert: (action) => {
      assert.equal(action.type, 'LogEntry');
      assert.equal(action.text, 'TextConstant');
      assert.equal(action.textIsExpression, true);
    }
  },
  // N7: an identifier id argument for AI_Output must survive without quotes.
  {
    name: 'AI_Output preserves an identifier id argument (N7)',
    body: 'AI_Output (self, other, DIALOG_ID_CONST);',
    assert: (action) => {
      assert.equal(action.type, 'DialogLine');
      assert.equal(action.id, 'DIALOG_ID_CONST');
      assert.equal(action.idIsExpression, true);
    }
  }
];

test('multiline string literal bytes survive repeated generation', () => {
  const bodies = [
    'Info_AddChoice (DIA_Test, "First\nSecond", DIA_Test_Choice);',
    'B_LogEntry (TOPIC_Test, "First\nSecond");',
    'AI_Output (self, other, "First\nSecond");',
    'Npc_ExchangeRoutine (self, "First\nSecond");',
    'AI_PlayAni (self, "First\nSecond");',
    'Custom_Action ("First\nSecond");',
    'if (TRUE) { Info_AddChoice (DIA_Test, "First\nSecond", DIA_Test_Choice); };'
  ];

  for (const body of bodies) {
    const original = wrapInInfoFunction(body);
    let current = original;
    for (let cycle = 0; cycle < 3; cycle++) {
      const model = buildModel(current);
      const generated = new SemanticCodeGenerator({
        includeComments: true,
        sectionHeaders: false,
        preserveSourceStyle: true
      }).generateSemanticModel(model);
      assert.deepEqual(
        tokenTexts(generated),
        tokenTexts(original),
        `string token changed on cycle ${cycle + 1}:\n${generated}`
      );
      current = generated;
    }
  }
});

test('typed actions with embedded comments stay verbatim across generation', () => {
  const source = wrapInInfoFunction(
    'CreateInvItems (self, /* preserve this comment */ ItMi_Gold, 1);'
  );
  const model = buildModel(source);
  const action = model.functions.DIA_T_Info.actions[0];
  assert.equal(action.type, 'CreateInventoryItems');
  assert.equal(action.sourceText, 'CreateInvItems (self, /* preserve this comment */ ItMi_Gold, 1)');
  const generated = new SemanticCodeGenerator({
    includeComments: true,
    sectionHeaders: false,
    preserveSourceStyle: true
  }).generateSemanticModel(model);
  assert.deepEqual(tokenTexts(generated), tokenTexts(source));
  assert.match(generated, /preserve this comment/);
});

test('embedded action comments survive semantic-model hydration', () => {
  const source = wrapInInfoFunction(
    'CreateInvItems (self, /* preserve after IPC */ ItMi_Gold, 1);'
  );
  const hydrated = deserializeSemanticModel(JSON.parse(JSON.stringify(buildModel(source))));
  const generated = new SemanticCodeGenerator({
    includeComments: true,
    sectionHeaders: false,
    preserveSourceStyle: true
  }).generateSemanticModel(hydrated);
  assert.deepEqual(tokenTexts(generated), tokenTexts(source));
  assert.match(generated, /preserve after IPC/);
});

test('commented actions retain edits and comments across hydration and repeated generation', () => {
  const bodies = [
    'CreateInvItems (self, /* item note */ ItMi_Gold, /* amount note */ 1);',
    'CreateInvItems (self, ItMi_Gold, // amount note\n1);',
    'CreateInvItems (self, ItMi_Gold, Amount /* expression note */ + 1);'
  ];
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  for (const body of bodies) {
    const original = buildModel(wrapInInfoFunction(body));
    for (const model of [original, deserializeSemanticModel(JSON.parse(JSON.stringify(original)))]) {
      const action = model.functions.DIA_T_Info.actions[0];
      model.functions.DIA_T_Info.actions[0] = { ...action, item: 'ItFo_Apple', quantity: 5 };
      let current = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
      for (let cycle = 0; cycle < 3; cycle++) {
        const generated = generator.generateSemanticModel(current);
        assert.doesNotMatch(generated, /ItMi_Gold/);
        for (const comment of body.match(/\/\*[^]*?\*\/|\/\/[^\n]*/g)) {
          assert.ok(generated.includes(comment), generated);
        }
        current = buildModel(generated);
        const edited = current.functions.DIA_T_Info.actions[0];
        assert.equal(edited.item, 'ItFo_Apple');
        assert.equal(edited.quantity, 5);
        current = deserializeSemanticModel(JSON.parse(JSON.stringify(current)));
      }
    }
  }
});

test('commented actions use the same generation path in then, else and nested branches', () => {
  const call = 'CreateInvItems (self, /* nested note */ ItMi_Gold, 1);';
  const bodies = [
    `if (A) { ${call} };`,
    `if (A) { Run(); } else { ${call} };`,
    `if (A) { if (B) { ${call} }; };`
  ];
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  for (const body of bodies) {
    let model = buildModel(wrapInInfoFunction(body));
    for (let cycle = 0; cycle < 3; cycle++) {
      model = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
      const generated = generator.generateSemanticModel(model);
      assert.ok(generated.includes('/* nested note */'), generated);
      assert.deepEqual(tokenTexts(generated), tokenTexts(wrapInInfoFunction(body)));
      model = buildModel(generated);
    }
  }
});

test('AI_Output keeps embedded comments and current subtitle, speaker and id', () => {
  const source = wrapInInfoFunction('AI_Output (self, /* voice note */ other, "DIA_T_01"); //Hallo');
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  const original = buildModel(source);
  for (const candidate of [original, deserializeSemanticModel(JSON.parse(JSON.stringify(original)))]) {
    assert.deepEqual(tokenTexts(generator.generateSemanticModel(candidate)), tokenTexts(source));
    const model = deserializeSemanticModel(JSON.parse(JSON.stringify(candidate)));
    Object.assign(model.functions.DIA_T_Info.actions[0], {
      speaker: 'hero', id: 'DIA_T_02', text: 'Neu\nzweite Zeile'
    });
    const generated = generator.generateSemanticModel(model);
    assert.ok(generated.includes('/* voice note */'), generated);
    assert.ok(generated.includes('//Neu\n\t//zweite Zeile'), generated);
    const line = buildModel(generated).functions.DIA_T_Info.actions[0];
    assert.equal(line.speaker, 'hero');
    assert.equal(line.id, 'DIA_T_02');
    const withoutComments = new SemanticCodeGenerator({ includeComments: false }).generateSemanticModel(model);
    assert.doesNotMatch(withoutComments, /voice note|Neu|zweite Zeile/);
    assert.equal(buildModel(withoutComments).functions.DIA_T_Info.actions[0].id, 'DIA_T_02');
  }
});

test('commented choice edits respect literal commas, parentheses, comment markers and backslashes', () => {
  const source = wrapInInfoFunction('Info_AddChoice (DIA_T, /* choice note */ "old, (text) //", OldTarget);');
  let model = buildModel(source);
  const text = 'new, (text) /* literal */ C:\\';
  Object.assign(model.functions.DIA_T_Info.actions[0], { text, targetFunction: 'NewTarget' });
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  for (let cycle = 0; cycle < 3; cycle++) {
    model = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
    const generated = generator.generateSemanticModel(model);
    assert.ok(generated.includes('/* choice note */'), generated);
    model = buildModel(generated);
    assert.equal(model.functions.DIA_T_Info.actions[0].text, text);
    assert.equal(model.functions.DIA_T_Info.actions[0].targetFunction, 'NewTarget');
  }
});

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

test('commented decimal edits survive hydration and repeated generation in every branch', () => {
  const edits = [
    { body: 'CreateInvItems (self, /* decimal note */ ItMi_Gold, 1.01);',
      type: 'CreateInventoryItems', field: 'quantity', value: 1.1 },
    { body: 'CreateInvItems (self, /* decimal note */ ItMi_Gold, -1.001);',
      type: 'CreateInventoryItems', field: 'quantity', value: '-1.1' },
    { body: 'Info_AddChoice (DIA_T, /* decimal note */ GetChoiceText(0.09), DIA_Target);',
      type: 'Choice', field: 'text', value: 'GetChoiceText(0.9)' },
    { body: 'Info_AddChoice (DIA_T, GetChoiceText(/* decimal note */ 1.01), DIA_Target);',
      type: 'Choice', field: 'text', value: 'GetChoiceText(1.1)' },
    { body: 'B_TeachCustom (self, /* decimal note */ GetAmount(0.009));',
      type: 'TeachAction', field: 'teachArgs', value: ['self', 'GetAmount(0.9)'] }
  ];
  const branches = [
    (body) => body,
    (body) => `if (A) { ${body} };`,
    (body) => `if (A) { Run(); } else { ${body} };`,
    (body) => `if (A) { if (B) { ${body} }; };`
  ];
  const findAction = (actions, type) => {
    for (const action of actions) {
      if (action.type === type) return action;
      if (action.type === 'ConditionalAction') {
        const nested = findAction([...action.thenActions, ...action.elseActions], type);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });

  for (const edit of edits) {
    for (const branch of branches) {
      const original = buildModel(wrapInInfoFunction(branch(edit.body)));
      const action = findAction(original.functions.DIA_T_Info.actions, edit.type);
      assert.ok(action, edit.body);
      action[edit.field] = edit.value;
      for (const candidate of [original, deserializeSemanticModel(JSON.parse(JSON.stringify(original)))]) {
        let current = candidate;
        for (let cycle = 0; cycle < 3; cycle++) {
          const generated = generator.generateSemanticModel(current);
          assert.ok(generated.includes('/* decimal note */'), generated);
          current = buildModel(generated);
          const edited = findAction(current.functions.DIA_T_Info.actions, edit.type);
          const expected = typeof edit.value === 'number' ? String(edit.value) : edit.value;
          assert.deepEqual(edited[edit.field], expected, generated);
          current = deserializeSemanticModel(JSON.parse(JSON.stringify(current)));
        }
      }
    }
  }
});

test('unchanged commented integer spelling survives an adjacent action edit', () => {
  const model = buildModel(wrapInInfoFunction(
    'CreateInvItems (self, /* integer note */ ItMi_Gold, 0001);'
  ));
  model.functions.DIA_T_Info.actions[0].item = 'ItFo_Apple';
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
  const hydrated = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
  const generated = generator.generateSemanticModel(hydrated);
  assert.match(generated, /ItFo_Apple, 0001\);/);
  assert.ok(generated.includes('/* integer note */'), generated);
  assert.equal(buildModel(generated).functions.DIA_T_Info.actions[0].quantity, 1);
});
