const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');

test('should parse global constants', () => {
  const source = `
    const string TOPIC_MyQuest = "The Lost Sheep";
    const int MAX_GOLD = 1000;
  `;

  const model = parseSemanticModel(source);

  assert.equal(model.hasErrors, false, 'Should parse without errors');

  // Check constants
  assert.ok(model.constants, 'Model should have constants map');

  const topicConst = model.constants['TOPIC_MyQuest'];
  assert.ok(topicConst, 'Should find TOPIC_MyQuest constant');
  assert.equal(topicConst.name, 'TOPIC_MyQuest');
  assert.equal(topicConst.type, 'string');
  assert.equal(topicConst.value, '"The Lost Sheep"');

  const goldConst = model.constants['MAX_GOLD'];
  assert.ok(goldConst, 'Should find MAX_GOLD constant');
  assert.equal(goldConst.name, 'MAX_GOLD');
  assert.equal(goldConst.type, 'int');
  assert.equal(goldConst.value, 1000);
});

test('should parse global variables', () => {
  const source = `
    var int MIS_MyQuest;
    var string CurrentLevel;
  `;

  const model = parseSemanticModel(source);

  assert.equal(model.hasErrors, false, 'Should parse without errors');

  // Check variables
  assert.ok(model.variables, 'Model should have variables map');

  const questVar = model.variables['MIS_MyQuest'];
  assert.ok(questVar, 'Should find MIS_MyQuest variable');
  assert.equal(questVar.name, 'MIS_MyQuest');
  assert.equal(questVar.type, 'int');

  const levelVar = model.variables['CurrentLevel'];
  assert.ok(levelVar, 'Should find CurrentLevel variable');
  assert.equal(levelVar.name, 'CurrentLevel');
  assert.equal(levelVar.type, 'string');
});

test('should handle mixed global declarations', () => {
    const source = `
      const string TOPIC_Test = "Test Quest";
      var int MIS_Test;

      func void TestFunc() {
        return;
      };
    `;

    const model = parseSemanticModel(source);

    assert.equal(model.hasErrors, false);
    assert.ok(model.constants['TOPIC_Test']);
    assert.ok(model.variables['MIS_Test']);
    assert.ok(model.functions['TestFunc']);
});
