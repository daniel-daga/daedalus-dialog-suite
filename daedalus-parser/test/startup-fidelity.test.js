const { test } = require('node:test');
const assert = require('node:assert');
const { createParser } = require('./helpers');
const {
  parseSemanticModel,
  SemanticCodeGenerator,
  InsertNpcAction
} = require('../dist/semantic/semantic-visitor-index');

// Slice B of "Insert NPC from the World surface" (level-editor.md §16.19,
// slice 16): a Startup.d-shaped file — mixed-case FUNC VOID, a chapter
// assignment, PlayVideo, a commented-out spawn, tab indent, trailing comments
// — must parse clean so an appended Wld_InsertNpc can be regenerated at all.
//
// Byte identity is deliberately NOT asserted: it does not hold. Regeneration
// drops blank lines, moves a trailing `// comment` onto its own line and
// rewrites `Wld_InsertNpc (X,"WP")` as `Wld_InsertNpc (X, "WP")`. That is
// why the write in slice C is a text-level splice, not a regenerate — the
// plan records the measurement.
const startupSource = [
  '// Startup und Init Funktionen der Level-zen-files',
  '',
  'FUNC VOID STARTUP_NewWorld()',
  '{\t',
  '\t// ------ StartUps der Unter-Parts ------ ',
  '\tSTARTUP_NewWorld_Part_City_01();',
  '\tSTARTUP_NewWorld_Part_Farm_01();',
  '\tWld_InsertNpc (PC_Hero,"START");\t\t\t//Held',
  '\t//Wld_InsertNpc (NONE_100_Xardas,"XARDAS");',
  '\t// ------ INTRO - muss ganz am Ende der Startup stehen ------',
  '\tKapitel = 1; //Joly: Kann hier stehen bleiben!',
  '\tPlayVideo ("INTRO.BIK");',
  '',
  '\t//-----Addon Talent Goldhacken---------',
  '\tHero_HackChance = 10;',
  '};',
  'FUNC VOID INIT_NewWorld()',
  '{',
  '\tB_InitGuildAttitudes();',
  '};',
  ''
].join('\n');

function generate(model) {
  return new SemanticCodeGenerator({
    includeComments: true,
    sectionHeaders: false,
    preserveSourceStyle: true
  }).generateSemanticModel(model);
}

test('a Startup.d-shaped file parses clean', () => {
  const tree = createParser().parse(startupSource);
  assert.equal(tree.rootNode.hasError, false, 'tree-sitter reports no error node');

  const model = parseSemanticModel(startupSource);
  assert.equal(model.hasErrors, false);
  assert.equal(model.errors?.length ?? 0, 0);
  assert.ok(model.functions.STARTUP_NewWorld, 'STARTUP_NewWorld is a function of the model');
  assert.ok(model.functions.INIT_NewWorld, 'INIT_NewWorld is a function of the model');

  const spawns = model.functions.STARTUP_NewWorld.actions.filter((a) => a instanceof InsertNpcAction);
  assert.equal(spawns.length, 1, 'the commented-out spawn is not an InsertNpcAction');
  assert.equal(spawns[0].npcInstance, 'PC_Hero');
  assert.equal(spawns[0].spawnPoint, 'START');
});

test('an appended Wld_InsertNpc regenerates as the last statement of STARTUP_<world>, and every original statement survives', () => {
  const model = parseSemanticModel(startupSource);
  model.functions.STARTUP_NewWorld.actions.push(new InsertNpcAction('BAU_900_Lobart', 'NW_FARM1_LOBART'));

  const generated = generate(model);
  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.hasErrors, false, 'the regenerated file parses clean');

  const startup = generated.slice(
    generated.indexOf('FUNC VOID STARTUP_NewWorld'),
    generated.indexOf('FUNC VOID INIT_NewWorld')
  );
  const lines = startup.trimEnd().split('\n');
  assert.equal(lines[lines.length - 1], '};');
  assert.equal(lines[lines.length - 2], '\tWld_InsertNpc (BAU_900_Lobart, "NW_FARM1_LOBART");');

  for (const statement of [
    'STARTUP_NewWorld_Part_City_01();',
    'STARTUP_NewWorld_Part_Farm_01();',
    'Wld_InsertNpc (PC_Hero, "START");',
    '//Wld_InsertNpc (NONE_100_Xardas,"XARDAS");',
    'Kapitel = 1;',
    'PlayVideo ("INTRO.BIK");',
    'Hero_HackChance = 10;'
  ]) {
    assert.ok(startup.includes(statement), `regenerated STARTUP_NewWorld keeps ${statement}`);
  }
  assert.ok(generated.includes('B_InitGuildAttitudes();'), 'INIT_NewWorld is untouched');
  assert.equal(
    reparsed.functions.INIT_NewWorld.actions.filter((a) => a instanceof InsertNpcAction).length,
    0
  );
});
