const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const DaedalusParser = require('../src/core/parser');
const { SemanticModelBuilderVisitor } = require('../dist/semantic/semantic-visitor-index');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');
const { deserializeSemanticModel } = require('../dist/semantic/semantic-model');
const { tokenStream, compareTokenStreams } = require('../scripts/roundtrip-corpus');

// Tier 3 of the fidelity gate (#514). The editor's real path is save *after an
// edit*, and the corpus run only ever re-saves a file nobody touched — the
// slice 2/4/5 defects (a dropped preserved body, a lost clause) survive it.
//
// Each case edits the parsed model the way the editor does, saves it the way
// the editor does (serialize → deserialize → generate, the hop across the IPC
// boundary), and requires the result to be the source with that one edit —
// compared as token streams, so formatting may move but no token may appear,
// vanish or change. The expected text is written here, not recorded from the
// generator, so a generator that drops the edit, or any statement around it,
// fails. Add a case per edit family; never promote one by pasting generated
// output in.

const corpusDir = path.join(__dirname, 'fixtures', 'corpus');

function buildModel(filePath) {
  const parsed = DaedalusParser.create().parseFile(filePath);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(parsed.rootNode);
  visitor.pass2_analyzeAndLink(parsed.rootNode);
  return visitor.semanticModel;
}

const EDITS = [
  {
    // DialogLine.text is the subtitle written back as a `//` comment, so this
    // is the one edit family whose output is not a token of the call itself.
    name: "a dialog line's subtitle",
    fixture: 'case-drift.d',
    edit: (model) => {
      const line = model.functions.DIA_Case_Info.actions[0];
      assert.equal(line.type, 'DialogLine');
      line.text = 'Ein neuer Satz';
    },
    expected: (source) => source.replace(
      'AI_Output (self, other, "DIA_Case_15_00");',
      'AI_Output (self, other, "DIA_Case_15_00"); //Ein neuer Satz'
    )
  },
  {
    // A typed action's text field: the model keeps the argument unquoted and
    // the generator writes the string literal back.
    name: 'a typed action argument',
    fixture: 'quoting.d',
    edit: (model) => {
      const insert = model.functions.B_QuotingCases.actions.find((action) => action.type === 'InsertNpcAction');
      assert.ok(insert, 'quoting.d must parse its Wld_InsertNpc action');
      insert.spawnPoint = 'WP_INTRO_2';
    },
    expected: (source) => source.replace('"WP_INTRO"', '"WP_INTRO_2"')
  },
  {
    // Add Condition in the dialog's Conditions panel (ConditionEditor).
    name: 'a condition added to a guard',
    fixture: 'case-drift.d',
    edit: (model) => {
      // What CONDITION_REGISTRY's "NPC Knows Dialog" default writes.
      model.functions.DIA_Case_Condition.conditions.push({
        type: 'NpcKnowsInfoCondition',
        npc: 'other',
        dialogRef: 'DIA_Case'
      });
    },
    expected: (source) => source.replace(
      'func int DIA_Case_Condition()\n{\n\treturn TRUE;\n};',
      'func int DIA_Case_Condition()\n{\n\tif (Npc_KnowsInfo (other, DIA_Case))\n\t{\n\t\treturn TRUE;\n\t};\n};'
    )
  },
  {
    // A C_INFO property set in the dialog details panel.
    name: 'a dialog property',
    fixture: 'case-drift.d',
    edit: (model) => {
      model.dialogs.dia_case.properties.nr = 2;
    },
    expected: (source) => source.replace('nr = 1;', 'nr = 2;')
  }
];

const generator = new SemanticCodeGenerator({
  includeComments: true,
  sectionHeaders: false,
  preserveSourceStyle: true
});

for (const editCase of EDITS) {
  test(`Tier 3: ${editCase.name} survives a save`, () => {
    const filePath = path.join(corpusDir, editCase.fixture);
    const source = fs.readFileSync(filePath, 'utf8');
    const expected = editCase.expected(source);
    assert.notEqual(expected, source, `${editCase.name}: the case must edit the source it compares against`);

    const model = buildModel(filePath);
    editCase.edit(model);
    // The save path: the model crosses IPC as plain JSON and is rebuilt.
    const saved = generator.generateSemanticModel(deserializeSemanticModel(JSON.parse(JSON.stringify(model))));

    const expectedTree = DaedalusParser.create().parse(expected);
    const savedTree = DaedalusParser.create().parse(saved);
    assert.equal(expectedTree.hasErrors, false, `${editCase.name}: the expected text must parse`);
    assert.equal(savedTree.hasErrors, false, `${editCase.name}: the saved text must parse`);

    const comparison = compareTokenStreams(tokenStream(expectedTree.rootNode), tokenStream(savedTree.rootNode));
    assert.equal(
      comparison.drift,
      false,
      `${editCase.name}: the save must be the source with that edit — diverge at token ${comparison.divergenceIndex}\n`
        + `expected: ${JSON.stringify(comparison.sourceContext)}\n`
        + `saved:    ${JSON.stringify(comparison.generatedContext)}`
    );
  });
}
