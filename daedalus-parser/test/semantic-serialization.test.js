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

test('deserializeSemanticModel preserves action discriminators and does not consume its input', () => {
  const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');
  const json = JSON.parse(JSON.stringify(parseSemanticModel(
    [
      'instance D(C_INFO) { condition = C; };',
      'func void F() { AI_StopProcessInfos(self); };',
      'func int C() { if (Npc_IsDead(other)) { return TRUE; }; };'
    ].join('\n')
  )));
  const before = JSON.stringify(json);

  const first = deserializeSemanticModel(json);
  const second = deserializeSemanticModel(json);

  assert.equal(json.functions.F.actions[0].type, 'StopProcessInfosAction');
  assert.equal(json.functions.C.conditions[0].type, 'NpcIsDeadCondition');
  assert.equal(JSON.stringify(json), before, 'hydration must leave the input unchanged');
  assert.equal(
    new SemanticCodeGenerator().generateSemanticModel(first),
    new SemanticCodeGenerator().generateSemanticModel(second),
    'repeated hydration of the same input must generate equivalent source'
  );
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

test('deserializeSemanticModel keeps a negated NpcKnowsInfoCondition from the editor through code generation', () => {
  const { SemanticCodeGenerator } = require('../dist/codegen/generator');

  // The editor's NOT switch sends `negated: true` on the plain condition:
  // "the NPC was met elsewhere, but not in Hallo1".
  const plainJson = {
    functions: {
      DIA_Albert_Hallo3_Condition: {
        name: 'DIA_Albert_Hallo3_Condition',
        returnType: 'int',
        actions: [],
        conditions: [
          { type: 'NpcKnowsInfoCondition', npc: 'other', dialogRef: 'DIA_Albert_Hallo2' },
          { type: 'NpcKnowsInfoCondition', npc: 'other', dialogRef: 'DIA_Albert_Hallo1', negated: true }
        ],
        calls: []
      }
    },
    dialogs: {
      DIA_Albert_Hallo3: {
        name: 'DIA_Albert_Hallo3',
        parent: 'C_INFO',
        properties: {
          npc: 'VLK_99107_Albert',
          nr: 3,
          condition: { name: 'DIA_Albert_Hallo3_Condition', returnType: 'int' },
          information: 'DIA_Albert_Hallo3_Info'
        }
      }
    }
  };

  const code = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false })
    .generateSemanticModel(deserializeSemanticModel(plainJson));

  assert.ok(code.includes('!Npc_KnowsInfo(other, DIA_Albert_Hallo1)'), `negated condition lost, got:\n${code}`);
  assert.ok(/[^!]Npc_KnowsInfo\(other, DIA_Albert_Hallo2\)/.test(code), `plain condition changed, got:\n${code}`);
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
          { type: 'RemoveInventoryItemsAction', removeFunctionName: 'Npc_RemoveInvItem', removeNpc: 'self', removeItem: 'ItMi_Gold' },
          // the editor's plain-JSON B_UseItem (#304)
          { type: 'UseItemAction', target: 'other', item: 'ItMi_Joint' }
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
  assert.ok(emitted.includes('B_UseItem (other, ItMi_Joint);'), 'emits B_UseItem from plain JSON');
});

test('deserializeSemanticModel reconstructs classes, prototypes and trailing comments', () => {
  const { SemanticCodeGenerator } = require('../dist/codegen/generator');
  const { GlobalClass, GlobalPrototype } = require('../dist/semantic/semantic-visitor-index');

  const plainJson = {
    functions: {},
    dialogs: {},
    declarationOrder: [
      { type: 'class', name: 'C_MyRecord' },
      { type: 'prototype', name: 'Mst_Default' }
    ],
    classes: {
      C_MyRecord: { name: 'C_MyRecord', sourceText: 'class C_MyRecord\n{\n\tvar int data;\n};' }
    },
    prototypes: {
      Mst_Default: { name: 'Mst_Default', parent: 'C_MyRecord', sourceText: 'prototype Mst_Default (C_MyRecord)\n{\n\tdata = 0;\n};' }
    },
    trailingComments: ['// end of file']
  };

  const model = deserializeSemanticModel(JSON.parse(JSON.stringify(plainJson)));
  assert.ok(model.classes.C_MyRecord instanceof GlobalClass, 'class rehydrates as GlobalClass');
  assert.ok(model.prototypes.Mst_Default instanceof GlobalPrototype, 'prototype rehydrates as GlobalPrototype');
  assert.equal(model.prototypes.Mst_Default.parent, 'C_MyRecord');
  assert.deepEqual(model.trailingComments, ['// end of file']);

  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false, preserveSourceStyle: true });
  const generated = generator.generateSemanticModel(model);
  assert.ok(generated.includes('class C_MyRecord'), 'class regenerates from sourceText');
  assert.ok(generated.includes('prototype Mst_Default (C_MyRecord)'), 'prototype regenerates from sourceText');
  assert.ok(generated.trimEnd().endsWith('// end of file'), 'trailing comment regenerates last');
});

test('deserializeSemanticModel reconstructs CommentAction and dialog property comments', () => {
  const { SemanticCodeGenerator } = require('../dist/codegen/generator');
  const { CommentAction } = require('../dist/semantic/semantic-visitor-index');

  const plainJson = {
    functions: {
      DIA_Test_Info: {
        name: 'DIA_Test_Info',
        returnType: 'void',
        actions: [
          { type: 'CommentAction', text: '// standalone note' },
          { speaker: 'self', listener: 'other', text: 'DIA_Test_15_00', id: 'DIA_Test_15_00' }
        ],
        conditions: [],
        calls: []
      }
    },
    dialogs: {
      DIA_Test: {
        name: 'DIA_Test',
        parent: 'C_INFO',
        properties: { npc: 'Some_NPC', nr: 1 },
        propertyLeadingComments: { nr: ['// choose slot'] },
        propertyTrailingComments: { npc: '// the speaker' },
        trailingBodyComments: ['// end of body'],
        actions: []
      }
    }
  };

  const model = deserializeSemanticModel(JSON.parse(JSON.stringify(plainJson)));
  const { actions } = model.functions.DIA_Test_Info;
  assert.ok(actions[0] instanceof CommentAction, 'CommentAction rehydrates');
  assert.equal(actions[0].text, '// standalone note');

  const dialog = model.dialogs.DIA_Test;
  assert.deepEqual(dialog.propertyLeadingComments.nr, ['// choose slot']);
  assert.equal(dialog.propertyTrailingComments.npc, '// the speaker');
  assert.deepEqual(dialog.trailingBodyComments, ['// end of body']);

  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false, preserveSourceStyle: true });
  const generated = generator.generateSemanticModel(model);
  assert.ok(generated.includes('// standalone note'), 'CommentAction regenerates (no semicolon)');
  assert.ok(!generated.includes('// standalone note;'), 'CommentAction has no trailing semicolon');
  assert.ok(generated.includes('// choose slot'), 'property leading comment regenerates');
  assert.ok(generated.includes('// the speaker'), 'property trailing comment regenerates');
  assert.ok(generated.includes('// end of body'), 'body trailing comment regenerates');
});

test('a dialog ships its body once, in the function dictionary (#443)', () => {
  const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');
  const source = [
    'instance DIA_One(C_INFO) { npc = SOME_NPC; nr = 1; condition = DIA_One_Condition; information = DIA_One_Info; };',
    'func int DIA_One_Condition() { return TRUE; };',
    'func void DIA_One_Info() {',
    '  AI_Output(other, self, "DIA_One_Line_00");',
    '  AI_StopProcessInfos(self);',
    '};'
  ].join('\n');

  const model = parseSemanticModel(source);
  const payload = JSON.stringify(model);
  const dialog = JSON.parse(payload).dialogs.DIA_One;

  assert.equal(dialog.properties.information, 'DIA_One_Info', 'the information reference is written as the name it is');
  assert.equal(dialog.properties.condition, 'DIA_One_Condition', 'the condition reference is written as the name it is');
  assert.equal(
    Object.prototype.hasOwnProperty.call(dialog, 'actions'), false,
    'the dialog does not ship a second copy of its information body'
  );
  assert.equal(
    JSON.stringify(dialog).includes('DIA_One_Line_00'), false,
    'no line of the information body rides inside the dialog'
  );
  assert.equal(JSON.parse(payload).functions.DIA_One_Info.actions.length, 2, 'the function dictionary still owns the body');

  const hydrated = deserializeSemanticModel(JSON.parse(payload));
  assert.strictEqual(
    hydrated.dialogs.DIA_One.actions, hydrated.functions.DIA_One_Info.actions,
    'the hydrated dialog is a live view of the function again'
  );
  assert.equal(
    new SemanticCodeGenerator().generateSemanticModel(hydrated),
    new SemanticCodeGenerator().generateSemanticModel(model),
    'generation is unchanged by the payload shape'
  );
});

test('a dialog whose information function is in another file ships no zero-action snapshot (#443)', () => {
  const { parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');
  const dialogFile = parseSemanticModel(
    'instance DIA_Cross(C_INFO) { npc = SOME_NPC; nr = 1; information = DIA_Cross_Info; };'
  );
  const dialog = JSON.parse(JSON.stringify(dialogFile)).dialogs.DIA_Cross;

  assert.equal(dialog.properties.information, 'DIA_Cross_Info', 'an unresolved reference stays a name');
  assert.equal(
    Object.prototype.hasOwnProperty.call(dialog, 'actions'), false,
    'an unresolved reference is not a 0-action snapshot'
  );

  // The same dialog once the owning file is in the model: the reference resolves
  // and the dialog is a view of the function, not a copy of it.
  const hydrated = deserializeSemanticModel({
    functions: {
      DIA_Cross_Info: {
        name: 'DIA_Cross_Info',
        returnType: 'void',
        actions: [{ speaker: 'other', text: 'Hi!', id: 'DIA_Cross_15_00' }, { type: 'StopProcessInfosAction' }],
        conditions: []
      }
    },
    dialogs: { DIA_Cross: dialog }
  });
  assert.equal(hydrated.dialogs.DIA_Cross.actions.length, 2);
  assert.strictEqual(hydrated.dialogs.DIA_Cross.actions, hydrated.functions.DIA_Cross_Info.actions);
});

test('a dialog payload written before the body was deduplicated still hydrates (#443)', () => {
  const infoFunction = {
    name: 'DIA_Legacy_Info',
    returnType: 'void',
    actions: [
      { speaker: 'other', text: 'Hi!', id: 'DIA_Legacy_15_00' },
      { type: 'StopProcessInfosAction' }
    ],
    conditions: []
  };
  const model = deserializeSemanticModel({
    functions: { DIA_Legacy_Info: infoFunction },
    dialogs: {
      DIA_Legacy: {
        name: 'DIA_Legacy',
        parent: 'C_INFO',
        properties: { npc: 'SOME_NPC', nr: 1, information: { name: 'DIA_Legacy_Info', returnType: 'void' } },
        // The old payload's duplicate, carrying stale content on purpose.
        actions: [{ speaker: 'other', text: 'Stale', id: 'DIA_Legacy_15_01' }]
      }
    }
  });

  assert.strictEqual(model.dialogs.DIA_Legacy.actions, model.functions.DIA_Legacy_Info.actions);
  assert.equal(model.dialogs.DIA_Legacy.actions.length, 2, 'the function dictionary stays authoritative');
});

test('a hero line that already carries its type keeps its listener when it is hydrated (#528)', () => {
  // The type is present, so class-transformer constructs DialogLine from it and
  // the constructor fills the missing listener from an undefined speaker — the
  // pass that runs after plainToInstance then sees one already there.
  const plainJson = {
    functions: {
      DIA_Typed_Hero_Info: {
        name: 'DIA_Typed_Hero_Info',
        returnType: 'void',
        actions: [{ type: 'DialogLine', speaker: 'other', text: 'Hallo!', id: 'DIA_Test_Hero_01' }],
        conditions: [],
        calls: []
      }
    },
    dialogs: {}
  };

  const { actions } = deserializeSemanticModel(plainJson).functions.DIA_Typed_Hero_Info;

  assert.ok(actions[0] instanceof DialogLine);
  assert.equal(actions[0].listener, 'self', 'the hero line must not come back as (other, other)');
});

test('deserializeSemanticModel types typeless function actions in deserializeAction, including nested ones (#528)', () => {
  const { ConditionalAction, StopProcessInfosAction, PlayAniAction, SetRefuseTalkAction } = require('../dist/semantic/semantic-visitor-index');

  const plainJson = {
    functions: {
      DIA_Typeless_Info: {
        name: 'DIA_Typeless_Info',
        returnType: 'void',
        actions: [
          // Legacy IPC payload: no `type` on any action.
          { speaker: 'other', text: 'Hi!', id: 'DIA_Typeless_15_00' },
          // Only discriminated by being a lone `target` key.
          { target: 'self' },
          {
            condition: 'HAS_GOLD',
            thenActions: [{ target: 'self', animationName: 'T_STAND_2_SIT' }],
            elseActions: [{ target: 'self', seconds: 300 }]
          }
        ],
        conditions: [],
        calls: []
      }
    },
    dialogs: {}
  };

  const { actions } = deserializeSemanticModel(plainJson).functions.DIA_Typeless_Info;

  assert.ok(actions[0] instanceof DialogLine);
  assert.equal(actions[0].listener, 'self', 'ensureActionType normalises the hero-line listener');

  assert.ok(actions[1] instanceof StopProcessInfosAction, 'a lone target is a StopProcessInfosAction');

  assert.ok(actions[2] instanceof ConditionalAction);
  assert.ok(actions[2].thenActions[0] instanceof PlayAniAction, 'nested then-actions are typed by the recursion');
  assert.ok(actions[2].elseActions[0] instanceof SetRefuseTalkAction, 'nested else-actions are typed by the recursion');
});
