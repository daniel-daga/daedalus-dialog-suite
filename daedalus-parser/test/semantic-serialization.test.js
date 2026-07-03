const { test } = require('node:test');
const assert = require('node:assert');
const {
  deserializeSemanticModel,
  Dialog,
  DialogFunction,
  DialogLine
} = require('../dist/semantic/semantic-visitor-index');

test('deserializeSemanticModel should reconstruct full object graph', () => {
  // 1. Create a "serialized" plain object structure (what IPC sends)
  const plainJson = {
    functions: {
      DIA_Test_Hello_Info: {
        name: 'DIA_Test_Hello_Info',
        returnType: 'void',
        actions: [
          {
            speaker: 'other',
            text: 'Hi!',
            id: 'DIA_Test_Hello_15_00'
          }
        ],
        conditions: [],
        calls: []
      },
      DIA_Test_Hello_Condition: {
        name: 'DIA_Test_Hello_Condition',
        returnType: 'int',
        actions: [],
        conditions: [],
        calls: []
      }
    },
    dialogs: {
      DIA_Test_Hello: {
        name: 'DIA_Test_Hello',
        parent: 'C_INFO',
        properties: {
          npc: 'BDT_1013_Bandit_L',
          nr: 1,
          description: 'Hello there',
          // These are the references we expect to be linked
          information: { name: 'DIA_Test_Hello_Info', returnType: 'void' },
          condition: { name: 'DIA_Test_Hello_Condition', returnType: 'int' }
        },
        actions: []
      }
    }
  };

  // 2. Deserialize
  const model = deserializeSemanticModel(plainJson);

  // 3. Assertions

  // Check Functions
  const infoFunc = model.functions['DIA_Test_Hello_Info'];
  assert.ok(infoFunc instanceof DialogFunction, 'Function should be instance of DialogFunction');
  assert.equal(infoFunc.name, 'DIA_Test_Hello_Info');

  // Check Actions inside Function
  const action = infoFunc.actions[0];
  assert.ok(action instanceof DialogLine, 'Action should be instance of DialogLine');
  assert.equal(action.text, 'Hi!');

  // Check Dialog
  const dialog = model.dialogs['DIA_Test_Hello'];
  assert.ok(dialog instanceof Dialog, 'Dialog should be instance of Dialog');
  assert.equal(dialog.properties.npc, 'BDT_1013_Bandit_L');

  // Check Linking (Critical!)
  // The 'information' property should reference the actual DialogFunction object, not the plain object or string
  const linkedInfo = dialog.properties.information;
  assert.ok(linkedInfo instanceof DialogFunction, 'Dialog property should link to DialogFunction instance');
  assert.strictEqual(linkedInfo, infoFunc, 'Dialog property should reference the same function instance in the model');
});

test('deserializeSemanticModel should preserve dialog style metadata for generation', () => {
  const plainJson = {
    declarationOrder: [{ type: 'dialog', name: 'DIA_Test_Hello' }],
    functions: {},
    dialogs: {
      DIA_Test_Hello: {
        name: 'DIA_Test_Hello',
        parent: 'C_INFO',
        keyword: 'Instance',
        spaceBeforeParen: true,
        leadingComments: [
          '// ************************************************************',
          '// \t\t\t\t\tWer bist du?',
          '// ************************************************************'
        ],
        properties: {
          npc: 'TEST_NPC',
          nr: 1,
          description: 'Hello'
        },
        actions: []
      }
    }
  };

  const model = deserializeSemanticModel(plainJson);
  const dialog = model.dialogs['DIA_Test_Hello'];

  assert.equal(dialog.keyword, 'Instance');
  assert.equal(dialog.spaceBeforeParen, true);
  assert.deepEqual(dialog.leadingComments, plainJson.dialogs.DIA_Test_Hello.leadingComments);
});

test('deserializeSemanticModel should handle various action types', () => {
  const plainJson = {
    functions: {
      Test_Actions: {
        name: 'Test_Actions',
        returnType: 'void',
        actions: [
          {
            topic: 'TOPIC_TEST',
            topicType: 'LOG_MISSION'
          },
          {
            dialogRef: 'DIA_Test',
            text: 'Option 1',
            targetFunction: 'DIA_Next'
          }
        ]
      }
    },
    dialogs: {}
  };

  const model = deserializeSemanticModel(plainJson);
  const { actions } = model.functions['Test_Actions'];

  const { CreateTopic, Choice } = require('../dist/semantic/semantic-visitor-index');

  assert.ok(actions[0] instanceof CreateTopic);
  assert.equal(actions[0].topic, 'TOPIC_TEST');

  assert.ok(actions[1] instanceof Choice);
  assert.equal(actions[1].text, 'Option 1');
});

test('deserializeSemanticModel should preserve conditionOperator OR through deserialization and code generation', () => {
  const { SemanticCodeGenerator } = require('../dist/codegen/generator');

  const plainJson = {
    functions: {
      DIA_Test_OR_Condition: {
        name: 'DIA_Test_OR_Condition',
        returnType: 'int',
        actions: [],
        conditions: [
          { type: 'NpcKnowsInfoCondition', npc: 'other', dialogRef: 'DIA_First' },
          { type: 'NpcKnowsInfoCondition', npc: 'other', dialogRef: 'DIA_Second' }
        ],
        conditionOperator: 'OR',
        calls: []
      }
    },
    dialogs: {
      DIA_Test_OR: {
        name: 'DIA_Test_OR',
        parent: 'C_INFO',
        properties: {
          npc: 'TestNpc',
          nr: 1,
          condition: { name: 'DIA_Test_OR_Condition', returnType: 'int' },
          information: 'DIA_Test_OR_Info'
        }
      }
    }
  };

  const model = deserializeSemanticModel(plainJson);

  assert.strictEqual(
    model.functions['DIA_Test_OR_Condition'].conditionOperator,
    'OR',
    'conditionOperator should survive deserialization as OR'
  );

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const code = generator.generateSemanticModel(model);

  assert.ok(
    code.includes('||'),
    `Generated code should use || for OR conditions, got:\n${code}`
  );
  assert.ok(
    !code.includes('&&'),
    `Generated code should not use && for OR conditions, got:\n${code}`
  );
});

test('deserializeSemanticModel should handle global constants and variables', () => {
  const plainJson = {
    functions: {},
    dialogs: {},
    constants: {
      TOPIC_Test: {
        name: 'TOPIC_Test',
        type: 'string',
        value: 'Test Topic'
      }
    },
    variables: {
      MIS_Test: {
        name: 'MIS_Test',
        type: 'int'
      }
    }
  };

  const model = deserializeSemanticModel(plainJson);
  const { GlobalConstant, GlobalVariable } = require('../dist/semantic/semantic-visitor-index');

  assert.ok(model.constants['TOPIC_Test'] instanceof GlobalConstant);
  assert.equal(model.constants['TOPIC_Test'].name, 'TOPIC_Test');
  assert.equal(model.constants['TOPIC_Test'].value, 'Test Topic');

  assert.ok(model.variables['MIS_Test'] instanceof GlobalVariable);
  assert.equal(model.variables['MIS_Test'].name, 'MIS_Test');
  assert.equal(model.variables['MIS_Test'].type, 'int');
});

test('deserializeSemanticModel should preserve function parameters', () => {
  const plainJson = {
    functions: {
      B_Say: {
        name: 'B_Say',
        returnType: 'void',
        parameters: [
          { keyword: 'var', type: 'C_NPC', name: 'slf' },
          { keyword: 'var', type: 'string', name: 'msg' }
        ],
        actions: [],
        conditions: [],
        calls: []
      }
    },
    dialogs: {}
  };

  const model = deserializeSemanticModel(JSON.parse(JSON.stringify(plainJson)));
  const func = model.functions.B_Say;
  assert.ok(func instanceof DialogFunction, 'Should reconstruct DialogFunction');
  assert.deepEqual(func.parameters, [
    { keyword: 'var', type: 'C_NPC', name: 'slf' },
    { keyword: 'var', type: 'string', name: 'msg' }
  ], 'Parameters should survive serialization roundtrip');
});

test('deserializeSemanticModel should preserve global order entries and source text', () => {
  const plainJson = {
    functions: {},
    dialogs: {},
    declarationOrder: [
      { type: 'constant', name: 'MAX_GOLD' },
      { type: 'instance', name: 'ItFo_Apple' }
    ],
    constants: {
      MAX_GOLD: { name: 'MAX_GOLD', type: 'int', value: 1000, sourceText: 'const int MAX_GOLD = 1000;' }
    },
    instances: {
      ItFo_Apple: { name: 'ItFo_Apple', parent: 'C_Item', sourceText: 'instance ItFo_Apple(C_Item)\n{\n\tname = "Apple";\n};' }
    }
  };

  const model = deserializeSemanticModel(JSON.parse(JSON.stringify(plainJson)));
  assert.deepEqual(model.declarationOrder, plainJson.declarationOrder, 'Order entries should pass through');
  assert.equal(model.constants.MAX_GOLD.sourceText, 'const int MAX_GOLD = 1000;');
  assert.ok(model.instances.ItFo_Apple.sourceText.includes('name = "Apple";'));
});

test('deserializeSemanticModel preserves quote-preservation flags through code generation', () => {
  const { SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');
  const plainJson = {
    functions: {
      DIA_Quote_Info: {
        name: 'DIA_Quote_Info',
        returnType: 'void',
        actions: [
          // identifier routine argument (P5) — must stay unquoted
          { type: 'ExchangeRoutineAction', target: 'self', routine: 'Routine_Var', routineIsExpression: true },
          // string-literal animation (P5) — must stay quoted
          { type: 'PlayAniAction', target: 'self', animationName: 'T_STAND_2_SIT' },
          // raw string topic (N1) — emitted verbatim
          { type: 'CreateTopic', topic: '"My Topic"', topicType: 'LOG_MISSION' },
          // identifier text argument (N2)
          { type: 'LogEntry', topic: 'TOPIC_Foo', text: 'TextConstant', textIsExpression: true },
          // identifier id argument (N7)
          { type: 'DialogLine', speaker: 'self', listener: 'other', text: 'DIALOG_ID_CONST', id: 'DIALOG_ID_CONST', idIsExpression: true }
        ],
        conditions: [],
        calls: []
      }
    },
    dialogs: {}
  };

  const model = deserializeSemanticModel(JSON.parse(JSON.stringify(plainJson)));
  const { actions } = model.functions['DIA_Quote_Info'];
  assert.strictEqual(actions[0].routineIsExpression, true);
  assert.strictEqual(actions[3].textIsExpression, true);
  assert.strictEqual(actions[4].idIsExpression, true);

  const generator = new SemanticCodeGenerator();
  const emitted = actions.map((a) => generator.generateAction(a));
  assert.ok(emitted.includes('Npc_ExchangeRoutine (self, Routine_Var);'), 'identifier routine stays unquoted');
  assert.ok(emitted.includes('AI_PlayAni (self, "T_STAND_2_SIT");'), 'string animation stays quoted');
  assert.ok(emitted.some((c) => c.includes('Log_CreateTopic ("My Topic", LOG_MISSION);')), 'raw string topic emitted verbatim');
  assert.ok(emitted.some((c) => c.includes('B_LogEntry (TOPIC_Foo, TextConstant);')), 'identifier text stays unquoted');
  assert.ok(emitted.some((c) => c.includes('AI_Output (self, other, DIALOG_ID_CONST);')), 'identifier id stays unquoted');
});

test('deserializeSemanticModel preserves string-valued numeric arguments through code generation', () => {
  const { SemanticCodeGenerator } = require('../dist/codegen/generator');
  const plainJson = {
    functions: {
      DIA_Num_Info: {
        name: 'DIA_Num_Info',
        returnType: 'void',
        actions: [
          // quantity kept as an identifier string (P3 fidelity)
          { type: 'CreateInventoryItems', target: 'self', item: 'ItMi_Gold', quantity: 'Gold_Amount' },
          // quantity kept as a literal number
          { type: 'CreateInventoryItems', target: 'self', item: 'ItMi_Gold', quantity: 0 },
          // 2-arg remove has no quantity field
          { type: 'RemoveInventoryItemsAction', removeFunctionName: 'Npc_RemoveInvItem', removeNpc: 'self', removeItem: 'ItMi_Gold' }
        ],
        conditions: [],
        calls: []
      }
    },
    dialogs: {}
  };

  const model = deserializeSemanticModel(plainJson);
  const { actions } = model.functions['DIA_Num_Info'];
  assert.strictEqual(actions[0].quantity, 'Gold_Amount', 'string quantity should survive deserialization');
  assert.strictEqual(actions[1].quantity, 0, 'numeric zero quantity should survive deserialization');
  assert.strictEqual(actions[2].removeQuantity, undefined, 'absent removeQuantity should stay absent');

  const generator = new SemanticCodeGenerator();
  const emitted = actions.map((a) => generator.generateAction(a));
  assert.ok(emitted.includes('CreateInvItems (self, ItMi_Gold, Gold_Amount);'), 'emits identifier quantity verbatim');
  assert.ok(emitted.includes('CreateInvItems (self, ItMi_Gold, 0);'), 'emits literal zero quantity');
  assert.ok(emitted.includes('Npc_RemoveInvItem (self, ItMi_Gold);'), 'emits 2-arg remove without quantity');
});
