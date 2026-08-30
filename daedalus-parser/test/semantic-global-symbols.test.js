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

test('should parse non-dialog instances into semantic model instances', () => {
  const source = `
    INSTANCE DIA_OldCamp_Test(C_INFO)
    {
      npc = SLD_200_DIEGO;
    };

    INSTANCE SLD_200_DIEGO(C_NPC)
    {
      name = "Diego";
      guild = GIL_NONE;
    };

    INSTANCE ITMI_SWORD(C_ITEM)
    {
      name = "Rusty Sword";
    };

    INSTANCE HUMANS_MDS(C_MDS)
    {
    };
  `;

  const model = parseSemanticModel(source);

  assert.equal(model.hasErrors, false, 'Should parse without errors');

  // Dialog instances remain dialogs
  assert.ok(model.dialogs['DIA_OldCamp_Test'], 'Should parse C_INFO as dialog');

  // Non-C_INFO instances are available for autocomplete resolution
  assert.ok(model.instances, 'Model should have instances map');
  assert.ok(model.instances['SLD_200_DIEGO'], 'Should include NPC instance');
  assert.equal(model.instances['SLD_200_DIEGO'].parent, 'C_NPC');
  assert.equal(model.instances['SLD_200_DIEGO'].displayName, 'Diego');
  assert.ok(model.instances['ITMI_SWORD'], 'Should include item instance');
  assert.equal(model.instances['ITMI_SWORD'].parent, 'C_ITEM');


  assert.ok(model.items, 'Model should have items map');
  assert.ok(model.items['ITMI_SWORD'], 'Should include item instance in items map');
  assert.equal(model.items['ITMI_SWORD'].parent, 'C_ITEM');
  assert.equal(model.items['ITMI_SWORD'].displayName, 'Rusty Sword');
  assert.equal(model.items['SLD_200_DIEGO'], undefined, 'Non-item instances should not be in items map');


  assert.ok(model.npcs, 'Model should have npcs map');
  assert.ok(model.npcs['SLD_200_DIEGO'], 'Should include npc instance in npcs map');
  assert.equal(model.npcs['SLD_200_DIEGO'].parent, 'C_NPC');
  assert.equal(model.npcs['ITMI_SWORD'], undefined, 'Non-npc instances should not be in npcs map');

  assert.ok(model.animations, 'Model should have animations map');
  assert.ok(model.animations['HUMANS_MDS'], 'Should include animation instance in animations map');
  assert.equal(model.animations['HUMANS_MDS'].parent, 'C_MDS');
  assert.equal(model.animations['SLD_200_DIEGO'], undefined, 'Non-animation instances should not be in animations map');
});

test('globals are recorded in declarationOrder with their source text', () => {
  const source = `const int MAX_GOLD = 1000;
var int MIS_Test;

func void TestFunc()
{
	AI_StopProcessInfos(self);
};

instance ItFo_TestApple(C_Item)
{
	name = "Apple";
	value = 5;
};
`;

  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false, 'Should parse without errors');

  assert.deepEqual(model.declarationOrder, [
    { type: 'constant', name: 'MAX_GOLD' },
    { type: 'variable', name: 'MIS_Test' },
    { type: 'function', name: 'TestFunc' },
    { type: 'instance', name: 'ItFo_TestApple' }
  ], 'Order should include globals interleaved with functions');

  assert.equal(model.constants.MAX_GOLD.sourceText, 'const int MAX_GOLD = 1000;');
  assert.equal(model.variables.MIS_Test.sourceText, 'var int MIS_Test;');
  assert.ok(
    model.instances.ItFo_TestApple.sourceText.includes('name = "Apple";'),
    'Instance source text should include its body'
  );
});

// The `id` field is what resolves `Npc_ExchangeRoutine(npc, "X")` to the
// function the engine actually runs, `RTN_X_<id>` (level-editor.md §16.19
// slice 10). Read exactly as `daily_routine` is, and a non-literal id is left
// undefined rather than guessed: a consumer of this has no symbol table to
// resolve a constant against.
test('should parse the C_NPC id field, and only when it is an integer literal', () => {
  const source = `
    const int SOME_ID = 42;

    INSTANCE SLD_200_DIEGO(C_NPC)
    {
      name = "Diego";
      id = 200;
      daily_routine = Rtn_Start_200;
    };

    INSTANCE VLK_500_TEST(C_NPC)
    {
      name = "Test";
      id = SOME_ID;
    };

    INSTANCE BAU_900_NOID(C_NPC)
    {
      name = "No Id";
    };
  `;

  const model = parseSemanticModel(source);

  assert.equal(model.hasErrors, false, 'Should parse without errors');

  assert.equal(model.instances['SLD_200_DIEGO'].npcId, 200, 'Literal id is read');
  assert.equal(
    model.instances['SLD_200_DIEGO'].dailyRoutine,
    'Rtn_Start_200',
    'daily_routine still reads beside it'
  );
  assert.equal(
    model.instances['VLK_500_TEST'].npcId,
    undefined,
    'A constant id is unresolvable here and is left undefined, never guessed'
  );
  assert.equal(
    model.instances['BAU_900_NOID'].npcId,
    undefined,
    'An instance with no id field has none'
  );
});

test('should parse a negative id literal', () => {
  const model = parseSemanticModel(`
    INSTANCE MONSTER_TEMPLATE(C_NPC)
    {
      id = -1;
    };
  `);

  assert.equal(model.instances['MONSTER_TEMPLATE'].npcId, -1);
});
