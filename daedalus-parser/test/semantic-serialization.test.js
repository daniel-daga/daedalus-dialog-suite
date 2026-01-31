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
      'DIA_Test_Hello_Info': {
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
      'DIA_Test_Hello_Condition': {
        name: 'DIA_Test_Hello_Condition',
        returnType: 'int',
        actions: [],
        conditions: [],
        calls: []
      }
    },
    dialogs: {
      'DIA_Test_Hello': {
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

test('deserializeSemanticModel should handle various action types', () => {
  const plainJson = {
    functions: {
      'Test_Actions': {
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
  const actions = model.functions['Test_Actions'].actions;

  const { CreateTopic, Choice } = require('../dist/semantic/semantic-visitor-index');
  
  assert.ok(actions[0] instanceof CreateTopic);
  assert.equal(actions[0].topic, 'TOPIC_TEST');
  
  assert.ok(actions[1] instanceof Choice);
  assert.equal(actions[1].text, 'Option 1');
});
