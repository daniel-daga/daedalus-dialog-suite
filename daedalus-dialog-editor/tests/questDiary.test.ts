/**
 * The quest page as the diary (#324): every entry and state change of one
 * quest, in story order, and the implicit-quest upgrade that adds `MIS_X`.
 *
 * Runs on real parser output, like questSteps.test.ts, so the diary is read
 * from what the editor actually receives.
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import {
  buildQuestDiary,
  implicitQuestSource,
  withQuestStateAssignments,
  type QuestDiaryItem
} from '../src/renderer/quest/domain/questDiary';
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
      process.stdout.write(JSON.stringify({ dialogs: m.dialogs, functions: m.functions, constants: m.constants, variables: m.variables }));
    });
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], {
    input: source,
    encoding: 'latin1',
    maxBuffer: 16 * 1024 * 1024
  }));
}

// Declared out of story order on purpose: the completion first, the start last,
// and the follow-up hint (alphabetically first) before the hint it follows.
const SHEEP = `
instance DIA_Bauer_Done (C_INFO)
{
	npc = BAU_900_Bauer;
	condition = DIA_Bauer_Done_Condition;
	information = DIA_Bauer_Done_Info;
};
func int DIA_Bauer_Done_Condition ()
{
	if (MIS_Schafe == LOG_RUNNING)
	{
		return TRUE;
	};
};
func void DIA_Bauer_Done_Info ()
{
	B_LogEntry (TOPIC_Schafe, "Ich habe die Schafe gefunden.");
	MIS_Schafe = LOG_SUCCESS;
	Log_SetTopicStatus (TOPIC_Schafe, LOG_SUCCESS);
	B_GivePlayerXP (XP_Schafe);
};

instance DIA_Hirte_Again (C_INFO)
{
	npc = BAU_901_Hirte;
	condition = DIA_Hirte_Again_Condition;
	information = DIA_Hirte_Again_Info;
};
func int DIA_Hirte_Again_Condition ()
{
	if (Npc_KnowsInfo (other, DIA_Hirte_Hint))
	{
		return TRUE;
	};
};
func void DIA_Hirte_Again_Info ()
{
	B_LogEntry (TOPIC_Schafe, "Der Wald liegt hinter der Bruecke.");
};

instance DIA_Hirte_Hint (C_INFO)
{
	npc = BAU_901_Hirte;
	condition = DIA_Hirte_Hint_Condition;
	information = DIA_Hirte_Hint_Info;
};
func int DIA_Hirte_Hint_Condition ()
{
	if (MIS_Schafe == LOG_RUNNING)
	{
		return TRUE;
	};
};
func void DIA_Hirte_Hint_Info ()
{
	B_LogEntry (TOPIC_Schafe, "Der Hirte hat sie im Wald gesehen.");
};

instance DIA_Bauer_Start (C_INFO)
{
	npc = BAU_900_Bauer;
	condition = DIA_Bauer_Start_Condition;
	information = DIA_Bauer_Start_Info;
};
func int DIA_Bauer_Start_Condition ()
{
	return TRUE;
};
func void DIA_Bauer_Start_Info ()
{
	MIS_Schafe = LOG_RUNNING;
	Log_CreateTopic (TOPIC_Schafe, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_Schafe, LOG_RUNNING);
	B_LogEntry (TOPIC_Schafe, "Der Bauer vermisst seine Schafe.");
};
`;

// An implicit quest: diary lines only, no MIS_ variable anywhere.
const IMPLICIT = `
instance DIA_Smith_Start (C_INFO)
{
	npc = VLK_400_Smith;
	condition = DIA_Smith_Start_Condition;
	information = DIA_Smith_Start_Info;
};
func int DIA_Smith_Start_Condition ()
{
	return TRUE;
};
func void DIA_Smith_Start_Info ()
{
	Log_CreateTopic (TOPIC_Sword, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_Sword, LOG_RUNNING);
	B_LogEntry (TOPIC_Sword, "The smith needs ore.");
};

instance DIA_Smith_Done (C_INFO)
{
	npc = VLK_400_Smith;
	condition = DIA_Smith_Done_Condition;
	information = DIA_Smith_Done_Info;
};
func int DIA_Smith_Done_Condition ()
{
	if (Npc_KnowsInfo (other, DIA_Smith_Start))
	{
		return TRUE;
	};
};
func void DIA_Smith_Done_Info ()
{
	if (Npc_HasItems (other, ItMi_Nugget) >= 5)
	{
		Log_SetTopicStatus (TOPIC_Sword, LOG_SUCCESS);
		B_LogEntry (TOPIC_Sword, "I brought the ore.");
	}
	else
	{
		Log_SetTopicStatus (TOPIC_Sword, LOG_FAILED);
	};
};
`;

const shape = (items: QuestDiaryItem[]) =>
  items.map((item) => [item.dialogName ?? item.functionName, item.kind === 'entry' ? item.text : item.state]);

describe('buildQuestDiary', () => {
  let sheep: SemanticModel;
  beforeAll(() => { sheep = parseModel(SHEEP); });

  it('lists entries and state changes in story order, not declaration order', () => {
    expect(shape(buildQuestDiary(sheep, 'TOPIC_Schafe'))).toEqual([
      ['DIA_Bauer_Start', 'running'],
      ['DIA_Bauer_Start', 'Der Bauer vermisst seine Schafe.'],
      ['DIA_Hirte_Hint', 'Der Hirte hat sie im Wald gesehen.'],
      ['DIA_Hirte_Again', 'Der Wald liegt hinter der Bruecke.'],
      ['DIA_Bauer_Done', 'Ich habe die Schafe gefunden.'],
      ['DIA_Bauer_Done', 'success']
    ]);
  });

  it('shows the topic status and MIS_ assignment of one step as one state change', () => {
    const states = buildQuestDiary(sheep, 'TOPIC_Schafe').filter((item) => item.kind === 'state');
    expect(states.map((item) => item.state)).toEqual(['running', 'success']);
  });

  it('says where each item is written, so it can be edited and jumped to', () => {
    const entry = buildQuestDiary(sheep, 'TOPIC_Schafe')[1];
    expect(entry).toMatchObject({
      kind: 'entry',
      functionName: 'DIA_Bauer_Start_Info',
      dialogName: 'DIA_Bauer_Start',
      npc: 'BAU_900_Bauer',
      path: [3],
      editable: true
    });
    const action = sheep.functions.DIA_Bauer_Start_Info.actions[3] as { text?: string };
    expect(action.text).toBe(entry.text);
  });

  it('reads lines inside an if/else, with a path into the branch', () => {
    const items = buildQuestDiary(parseModel(IMPLICIT), 'TOPIC_Sword');
    expect(shape(items)).toEqual([
      ['DIA_Smith_Start', 'running'],
      ['DIA_Smith_Start', 'The smith needs ore.'],
      ['DIA_Smith_Done', 'success'],
      ['DIA_Smith_Done', 'I brought the ore.'],
      ['DIA_Smith_Done', 'failed']
    ]);
    expect(items[3].path).toEqual([0, 'then', 1]);
    expect(items[4].path).toEqual([0, 'else', 0]);
  });

  it('is empty for a quest nothing writes', () => {
    expect(buildQuestDiary(sheep, 'TOPIC_Unknown')).toEqual([]);
  });
});

describe('implicitQuestSource', () => {
  it('names the dialog that starts the quest', () => {
    const model = parseModel(IMPLICIT);
    expect(implicitQuestSource(buildQuestDiary(model, 'TOPIC_Sword'))).toBe('DIA_Smith_Start');
  });
});

describe('withQuestStateAssignments', () => {
  let model: SemanticModel;
  beforeAll(() => { model = parseModel(IMPLICIT); });

  const lines = (actions: readonly DialogAction[]): string[] => actions.map((action) => {
    const a = action as unknown as Record<string, unknown>;
    if (a.type === 'ConditionalAction') {
      return `if [${lines(a.thenActions as DialogAction[]).join('; ')}] else [${lines(a.elseActions as DialogAction[]).join('; ')}]`;
    }
    if (a.type === 'SetVariableAction') return `${a.variableName} ${a.operator} ${a.value}`;
    return String(a.type);
  });

  it('sets MIS_ to the state each topic status line writes, right after it', () => {
    const start = withQuestStateAssignments(model.functions.DIA_Smith_Start_Info.actions, 'TOPIC_Sword');
    expect(lines(start!)).toEqual(['CreateTopic', 'LogSetTopicStatus', 'MIS_Sword = LOG_RUNNING', 'LogEntry']);

    const done = withQuestStateAssignments(model.functions.DIA_Smith_Done_Info.actions, 'TOPIC_Sword');
    expect(lines(done!)).toEqual([
      'if [LogSetTopicStatus; MIS_Sword = LOG_SUCCESS; LogEntry] else [LogSetTopicStatus; MIS_Sword = LOG_FAILED]'
    ]);
  });

  it('leaves a list that already sets the state alone', () => {
    const sheep = parseModel(SHEEP);
    expect(withQuestStateAssignments(sheep.functions.DIA_Bauer_Start_Info.actions, 'TOPIC_Schafe')).toBeNull();
    expect(withQuestStateAssignments(sheep.functions.DIA_Hirte_Hint_Info.actions, 'TOPIC_Schafe')).toBeNull();
  });

  it('starts the quest after a lone Log_CreateTopic, but never for a note', () => {
    const lone = [{ type: 'CreateTopic', topic: 'TOPIC_Sword', topicType: 'LOG_MISSION' }] as DialogAction[];
    expect(lines(withQuestStateAssignments(lone, 'TOPIC_Sword')!)).toEqual(['CreateTopic', 'MIS_Sword = LOG_RUNNING']);
    const note = [{ type: 'CreateTopic', topic: 'TOPIC_Sword', topicType: 'LOG_NOTE' }] as DialogAction[];
    expect(withQuestStateAssignments(note, 'TOPIC_Sword')).toBeNull();
  });
});
