/**
 * Named sub-stages (#325, docs/plans/quest-authoring.md phase 4): a stage is a
 * declared `STAGE_<QuestBase>_<Name>` int, so the inventory is a prefix scan of
 * the declared globals and a write is an ordinary `SetVariableAction`.
 *
 * Runs on real parser output, like questDiary.test.ts, so both the inventory and
 * the write the editor saves are what the editor actually receives.
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import {
  buildQuestStages,
  buildStageWrite,
  declaredStages,
  findDeclaredStage,
  recognizeStageWrite,
  stageNameCollision,
  stageVariableName,
  stageWriteScript,
  type QuestStageWriteKind
} from '../src/renderer/quest/domain/questStages';
import type { DialogAction, SemanticModel } from '../src/renderer/types/global';

function parseModel(source: string): SemanticModel {
  const parserPath = require.resolve('daedalus-parser');
  const visitorPath = require.resolve('daedalus-parser/semantic-visitor');
  const script = `
    let src = '';
    process.stdin.on('data', (d) => { src += d; });
    process.stdin.on('end', () => {
      const DaedalusParser = require(${JSON.stringify(parserPath)});
      const { SemanticModelBuilderVisitor } = require(${JSON.stringify(visitorPath)});
      const result = new DaedalusParser().parse(src);
      const visitor = new SemanticModelBuilderVisitor();
      visitor.pass1_createObjects(result.tree.rootNode);
      visitor.pass2_analyzeAndLink(result.tree.rootNode);
      const m = visitor.semanticModel;
      process.stdout.write(JSON.stringify({
        dialogs: m.dialogs, functions: m.functions, constants: m.constants,
        variables: m.variables, instances: m.instances
      }));
    });
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], {
    input: source,
    encoding: 'latin1',
    maxBuffer: 16 * 1024 * 1024
  }));
}

/** What the editor saves for an action. */
function generate(action: DialogAction): string {
  const modelPath = require.resolve('daedalus-parser/semantic-model');
  const script = `
    let src = '';
    process.stdin.on('data', (d) => { src += d; });
    process.stdin.on('end', () => {
      const { deserializeAction } = require(${JSON.stringify(modelPath)});
      process.stdout.write(deserializeAction(JSON.parse(src)).generateCode({}));
    });
  `;
  return execFileSync(process.execPath, ['-e', script], { input: JSON.stringify(action), encoding: 'latin1' });
}

// Sheep is a counter with a target, Said a flag, Empty is declared but never
// written, Third counts up but nothing compares it.
const SHEEP = `
var int STAGE_VerloreneSchafe_Sheep;
var int STAGE_VerloreneSchafe_Said;
var int STAGE_VerloreneSchafe_Empty;
var int STAGE_VerloreneSchafe_Third;
var int MIS_VerloreneSchafe;
var int MIS_A_B;
var int STAGE_A_B_C;

instance DIA_Bauer (C_INFO)
{
	npc = BAU_900_Bauer;
	condition = DIA_Bauer_Condition;
	information = DIA_Bauer_Info;
};

func void DIA_Bauer_Info()
{
	STAGE_VerloreneSchafe_Said = TRUE;
	STAGE_VerloreneSchafe_Sheep = STAGE_VerloreneSchafe_Sheep + 1;
	MIS_VerloreneSchafe = LOG_RUNNING;
};

func void DIA_Bauer_Count()
{
	if (STAGE_VerloreneSchafe_Sheep >= 3)
	{
		STAGE_VerloreneSchafe_Sheep = STAGE_VerloreneSchafe_Sheep + 1;
		STAGE_VerloreneSchafe_Third = STAGE_VerloreneSchafe_Third + 1;
	};
};

func int DIA_Bauer_Condition()
{
	if (STAGE_VerloreneSchafe_Sheep >= 5)
	{
		return TRUE;
	};
};

instance DIA_Hirt (C_INFO)
{
	npc = BAU_901_Hirt;
	condition = DIA_Hirt_Condition;
};

func int DIA_Hirt_Condition()
{
	if (STAGE_VerloreneSchafe_Sheep == 7)
	{
		return TRUE;
	};
};
`;

const model = parseModel(SHEEP);
const sheepStages = () => buildQuestStages(model, 'TOPIC_VerloreneSchafe');

describe('stage naming and inventory', () => {
  test('a stage is STAGE_<quest base>_<title>, the title sanitised like a quest name', () => {
    expect(stageVariableName('VerloreneSchafe', 'Talked to Greg')).toBe('STAGE_VerloreneSchafe_TalkedToGreg');
    expect(stageVariableName('VerloreneSchafe', 'Schafe zählen')).toBe('STAGE_VerloreneSchafe_SchafeZaehlen');
  });

  test('the inventory is the prefix scan of the declared globals', () => {
    const variables = declaredStages(model).map((stage) => stage.variable);
    expect(variables).toEqual([
      'STAGE_VerloreneSchafe_Sheep',
      'STAGE_VerloreneSchafe_Said',
      'STAGE_VerloreneSchafe_Empty',
      'STAGE_VerloreneSchafe_Third',
      'STAGE_A_B_C'
    ]);
  });

  test('a stage splits on the longest quest base the project declares a MIS_ for', () => {
    const stage = declaredStages(model).find((s) => s.variable === 'STAGE_A_B_C')!;
    expect(stage.questBase).toBe('A_B');
    expect(stage.name).toBe('C');
  });

  test('the quest title comes from its TOPIC_ constant', () => {
    const stage = declaredStages({
      ...model,
      constants: { ...model.constants, TOPIC_A_B: { name: 'TOPIC_A_B', type: 'string', value: 'A Bee' } }
    } as SemanticModel).find((s) => s.variable === 'STAGE_A_B_C')!;
    expect(stage.questTitle).toBe('A Bee');
  });

  test('a name colliding case-insensitively with a declared global is refused', () => {
    expect(stageNameCollision(model, 'stage_verloreneschafe_sheep')).toBe('STAGE_VerloreneSchafe_Sheep');
    expect(stageNameCollision(model, 'STAGE_VerloreneSchafe_Cow')).toBeNull();
  });
});

describe('stage writes', () => {
  const codeOf = (kind: QuestStageWriteKind) => generate(buildStageWrite('STAGE_X_Sheep', kind));

  test('a flag is reached, reset, and a counter counts up in plain Daedalus', () => {
    expect(codeOf('reached')).toBe('STAGE_X_Sheep = TRUE;');
    expect(codeOf('reset')).toBe('STAGE_X_Sheep = FALSE;');
    // No compound assignment in Daedalus.
    expect(codeOf('counts')).toBe('STAGE_X_Sheep = STAGE_X_Sheep + 1;');
  });

  test('the card shows the line it writes', () => {
    expect(stageWriteScript(buildStageWrite('STAGE_X_Sheep', 'counts'))).toBe('STAGE_X_Sheep = STAGE_X_Sheep + 1;');
  });

  test('recognises the three write forms as the parser hands them back', () => {
    const [said, sheep, mis] = model.functions.DIA_Bauer_Info.actions;
    expect(recognizeStageWrite(said)).toEqual({ variable: 'STAGE_VerloreneSchafe_Said', kind: 'reached' });
    expect(recognizeStageWrite(sheep)).toEqual({ variable: 'STAGE_VerloreneSchafe_Sheep', kind: 'counts' });
    // A lifecycle assignment is not a stage write.
    expect(recognizeStageWrite(mis)).toBeNull();
  });

  test('a flag outside the STAGE_ prefix is an ordinary Set Variable', () => {
    // The Value field default alone must not turn a variable into a stage.
    expect(recognizeStageWrite({ type: 'SetVariableAction', variableName: 'B_Greg_Talked', operator: '=', value: 'TRUE' } as DialogAction)).toBeNull();
    // The Set Stage entry's card, before a stage is picked.
    expect(recognizeStageWrite({ type: 'SetVariableAction', variableName: 'STAGE_', operator: '=', value: 'TRUE' } as DialogAction))
      .toEqual({ variable: 'STAGE_', kind: 'reached' });
  });

  test('only a declared stage is a stage; an undeclared STAGE_ name is not', () => {
    expect(findDeclaredStage(model, 'STAGE_VerloreneSchafe_Sheep')?.name).toBe('Sheep');
    expect(findDeclaredStage(model, 'stage_verloreneschafe_sheep')?.name).toBe('Sheep');
    expect(findDeclaredStage(model, 'STAGE_VerloreneSchafe_Cow')).toBeNull();
  });
});

describe('buildQuestStages', () => {
  test('lists the quest’s stages with kind, target, writes and whether they are read', () => {
    const stages = sheepStages();
    expect(stages.map((s) => s.name)).toEqual(['Sheep', 'Said', 'Empty', 'Third']);

    const sheep = stages[0];
    expect(sheep.kind).toBe('counter');
    // The largest N of its `>= N` / `== N` checks, across two dialogs.
    expect(sheep.target).toBe(7);
    expect(sheep.checked).toBe(true);
    expect(sheep.writes.map((w) => [w.kind, w.functionName])).toEqual([
      ['counts', 'DIA_Bauer_Info'],
      ['counts', 'DIA_Bauer_Count']
    ]);

    const said = stages[1];
    expect(said.kind).toBe('flag');
    expect(said.target).toBeNull();
    expect(said.checked).toBe(false);
    expect(said.writes.map((w) => w.kind)).toEqual(['reached']);

    expect(stages[2].writes).toEqual([]);
    expect(stages[3].kind).toBe('counter');
    expect(stages[3].target).toBeNull();
  });

  test('a write says where it is, for the page’s jump', () => {
    const write = sheepStages()[0].writes[0];
    expect(write.dialogName).toBe('DIA_Bauer');
    // The stage line is the second action of the info function.
    expect(write.path).toEqual([1]);
  });

  test('a counter’s target is the largest N of its >= / == checks anywhere', () => {
    const counted = parseModel(`
var int STAGE_VerloreneSchafe_Sheep;
var int MIS_VerloreneSchafe;

instance DIA_Bauer (C_INFO)
{
	npc = BAU_900_Bauer;
	condition = DIA_Bauer_Condition;
	information = DIA_Bauer_Info;
};

func void DIA_Bauer_Info()
{
	STAGE_VerloreneSchafe_Sheep = STAGE_VerloreneSchafe_Sheep + 1;
};

func int DIA_Bauer_Condition()
{
	if (STAGE_VerloreneSchafe_Sheep >= 4)
	{
		return TRUE;
	};
};

instance DIA_Hirt (C_INFO)
{
	npc = BAU_901_Hirt;
	condition = DIA_Hirt_Condition;
};

func int DIA_Hirt_Condition()
{
	if (STAGE_VerloreneSchafe_Sheep == 9)
	{
		return TRUE;
	};
};
`);
    expect(buildQuestStages(counted, 'TOPIC_VerloreneSchafe')[0].target).toBe(9);
  });

  test('another quest’s stages are not this quest’s', () => {
    expect(sheepStages().map((s) => s.name)).not.toContain('C');
  });
});
