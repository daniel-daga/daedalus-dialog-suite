/**
 * Quest steps (#322): the recogniser that folds vanilla quest lines into one
 * step, the builders that write them, and the edits a step card makes.
 *
 * Recognition runs on real parser output — vanilla Gothic 2 idioms and the
 * Farim example the parser ships — so it is tested against what the editor
 * actually receives, not a hand-built action list.
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  recognizeQuestSteps,
  buildQuestStepActions,
  setQuestStepTopic,
  setQuestStepText,
  setQuestStepXp,
  type QuestStep
} from '../src/renderer/quest/domain/questSteps';
import type { DialogAction } from '../src/renderer/types/global';

/** Same child-process parse as simulatorParserIntegration.test.ts. */
function parseFunctions(source: string): Record<string, DialogAction[]> {
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
      const out = {};
      for (const [name, fn] of Object.entries(visitor.semanticModel.functions)) out[name] = fn.actions;
      process.stdout.write(JSON.stringify(out));
    });
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    input: source,
    encoding: 'latin1',
    maxBuffer: 16 * 1024 * 1024
  });
  return JSON.parse(output);
}

const VANILLA = `
func void DIA_Lobart_Start_Info()
{
	AI_Output (self, other, "DIA_Lobart_Start_05_00"); //Get me the turnips.
	MIS_Lobart_Rueben = LOG_RUNNING;
	Log_CreateTopic (TOPIC_Lobart_Rueben, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_Lobart_Rueben, LOG_RUNNING);
	B_LogEntry (TOPIC_Lobart_Rueben, "Lobart wants his turnips.");
	AI_StopProcessInfos (self);
};

func void DIA_Lobart_Done_Info()
{
	AI_Output (other, self, "DIA_Lobart_Done_15_00"); //Here are your turnips.
	MIS_Lobart_Rueben = LOG_SUCCESS;
	B_GivePlayerXP (XP_LobartHolRueben);
};

func void DIA_Lobart_Fail_Info()
{
	Log_SetTopicStatus (TOPIC_Lobart_Rueben, LOG_FAILED);
	MIS_Lobart_Rueben = LOG_FAILED;
	B_LogEntry (TOPIC_Lobart_Rueben, "The turnips rotted.");
};

func void DIA_Lobart_Drop_Info()
{
	MIS_Lobart_Rueben = LOG_OBSOLETE;
	Log_SetTopicStatus (TOPIC_Lobart_Rueben, LOG_OBSOLETE);
};

func void DIA_Split_Info()
{
	Log_CreateTopic (TOPIC_A, LOG_MISSION);
	AI_Output (self, other, "DIA_Split_05_00"); //Between.
	Log_SetTopicStatus (TOPIC_A, LOG_RUNNING);
};

func void DIA_TwoQuests_Info()
{
	Log_CreateTopic (TOPIC_A, LOG_MISSION);
	Log_CreateTopic (TOPIC_B, LOG_MISSION);
};

func void DIA_StrayXp_Info()
{
	Log_CreateTopic (TOPIC_A, LOG_MISSION);
	B_GivePlayerXP (100);
};

func void DIA_NoQuest_Info()
{
	B_GivePlayerXP (100);
	MIS_Counter = 3;
};
`;

const FARIM = path.resolve(__dirname, '..', '..', 'daedalus-parser', 'examples', 'DIA_Farmim.d');

let fns: Record<string, DialogAction[]>;
let farim: Record<string, DialogAction[]>;

beforeAll(() => {
  fns = parseFunctions(VANILLA);
  farim = parseFunctions(fs.readFileSync(FARIM, 'latin1'));
});

const shape = (steps: QuestStep[]) =>
  steps.map(({ kind, topic, start, end }) => ({ kind, topic, start, end }));

describe('recognizeQuestSteps on vanilla scripts', () => {
  it('folds a vanilla quest start, in vanilla order, into one step', () => {
    const steps = recognizeQuestSteps(fns.DIA_Lobart_Start_Info);
    expect(shape(steps)).toEqual([{ kind: 'start', topic: 'TOPIC_Lobart_Rueben', start: 1, end: 5 }]);
    expect(steps[0].text).toBe('Lobart wants his turnips.');
    expect(steps[0].misVariable).toBe('MIS_Lobart_Rueben');
  });

  it('reads a success with XP and no diary lines, deriving the topic from MIS_', () => {
    const steps = recognizeQuestSteps(fns.DIA_Lobart_Done_Info);
    expect(shape(steps)).toEqual([{ kind: 'complete', topic: 'TOPIC_Lobart_Rueben', start: 1, end: 3 }]);
    expect(steps[0].xp).toBe('XP_LobartHolRueben');
    expect(steps[0].indices.status).toBeUndefined();
  });

  it('reads fail and cancel with the status and MIS_ lines in either order', () => {
    const fail = recognizeQuestSteps(fns.DIA_Lobart_Fail_Info);
    expect(shape(fail)).toEqual([{ kind: 'fail', topic: 'TOPIC_Lobart_Rueben', start: 0, end: 3 }]);
    expect(fail[0].text).toBe('The turnips rotted.');

    expect(shape(recognizeQuestSteps(fns.DIA_Lobart_Drop_Info)))
      .toEqual([{ kind: 'cancel', topic: 'TOPIC_Lobart_Rueben', start: 0, end: 2 }]);
  });

  it('keeps a run broken by an unrelated line as two steps', () => {
    expect(shape(recognizeQuestSteps(fns.DIA_Split_Info))).toEqual([
      { kind: 'start', topic: 'TOPIC_A', start: 0, end: 1 },
      { kind: 'start', topic: 'TOPIC_A', start: 2, end: 3 }
    ]);
  });

  it('does not merge two quests created back to back', () => {
    expect(shape(recognizeQuestSteps(fns.DIA_TwoQuests_Info))).toEqual([
      { kind: 'start', topic: 'TOPIC_A', start: 0, end: 1 },
      { kind: 'start', topic: 'TOPIC_B', start: 1, end: 2 }
    ]);
  });

  it('leaves XP raw unless it follows a quest ending', () => {
    expect(shape(recognizeQuestSteps(fns.DIA_StrayXp_Info)))
      .toEqual([{ kind: 'start', topic: 'TOPIC_A', start: 0, end: 1 }]);
    expect(recognizeQuestSteps(fns.DIA_NoQuest_Info)).toEqual([]);
  });

  it('reads the Farim example: a start followed by a second entry, and a note', () => {
    expect(shape(recognizeQuestSteps(farim.DIA_Farim_Hallo_Verletzung))).toEqual([
      { kind: 'start', topic: 'TOPIC_SaveBeppo', start: 11, end: 14 },
      { kind: 'entry', topic: 'TOPIC_SaveBeppo', start: 14, end: 15 }
    ]);
    // Log_CreateTopic (TOPIC_Diebesgilde, LOG_NOTE) + status + an entry
    // spelled Topic_Diebesgilde: one note, the casing drift tolerated.
    const wahrheit = recognizeQuestSteps(farim.DIA_Farim_Hallo_Wahrheit);
    expect(wahrheit.map((s) => s.kind)).toEqual(['start', 'note']);
    expect(wahrheit[1].end - wahrheit[1].start).toBe(3);
  });
});

describe('buildQuestStepActions', () => {
  it('writes the vanilla start lines and reads them back as the same step', () => {
    const actions = buildQuestStepActions({ kind: 'start', topic: 'TOPIC_Sheep', text: 'Find the sheep.' });
    expect(actions.map((a) => a.type)).toEqual(['CreateTopic', 'LogSetTopicStatus', 'LogEntry', 'SetVariableAction']);
    expect(actions[3]).toMatchObject({ variableName: 'MIS_Sheep', operator: '=', value: 'LOG_RUNNING' });
    expect(shape(recognizeQuestSteps(actions))).toEqual([{ kind: 'start', topic: 'TOPIC_Sheep', start: 0, end: 4 }]);
  });

  it('writes a completion with optional XP, keeping status and MIS_ in step', () => {
    const plain = buildQuestStepActions({ kind: 'complete', topic: 'TOPIC_Sheep' });
    expect(plain).toEqual([
      { type: 'SetVariableAction', variableName: 'MIS_Sheep', operator: '=', value: 'LOG_SUCCESS' },
      { type: 'LogSetTopicStatus', topic: 'TOPIC_Sheep', status: 'LOG_SUCCESS' }
    ]);
    const withXp = buildQuestStepActions({ kind: 'complete', topic: 'TOPIC_Sheep', text: 'Done.', xp: 'XP_Sheep' });
    const [step] = recognizeQuestSteps(withXp);
    expect(step).toMatchObject({ kind: 'complete', start: 0, end: 4, text: 'Done.', xp: 'XP_Sheep' });
  });

  it('writes a note without a MIS_ variable', () => {
    const note = buildQuestStepActions({ kind: 'note', topic: 'TOPIC_Trader', text: 'Farim sells fish.' });
    expect(note.map((a) => a.type)).toEqual(['CreateTopic', 'LogEntry']);
    expect(note[0]).toMatchObject({ topicType: 'LOG_NOTE' });
    expect(recognizeQuestSteps(note)[0]).toMatchObject({ kind: 'note', end: 2 });
  });

  it('reads back fail, cancel and entry', () => {
    for (const kind of ['fail', 'cancel', 'entry'] as const) {
      const actions = buildQuestStepActions({ kind, topic: 'TOPIC_Sheep', text: 'x' });
      expect(shape(recognizeQuestSteps(actions)))
        .toEqual([{ kind, topic: 'TOPIC_Sheep', start: 0, end: actions.length }]);
    }
  });
});

describe('quest step edits', () => {
  const withContext = (step: DialogAction[]) => [
    { type: 'DialogLine', speaker: 'self', text: 'Before', id: 'L1' } as DialogAction,
    ...step,
    { type: 'DialogLine', speaker: 'self', text: 'After', id: 'L2' } as DialogAction
  ];

  it('renames the topic and its MIS_ variable across every line of the step', () => {
    const actions = withContext(buildQuestStepActions({ kind: 'start', topic: 'TOPIC_Sheep', text: 't' }));
    const [step] = recognizeQuestSteps(actions);
    const next = setQuestStepTopic(actions, step, 'TOPIC_Goats');
    expect(next[0]).toBe(actions[0]);
    expect(next[5]).toBe(actions[5]);
    expect(shape(recognizeQuestSteps(next))).toEqual([{ kind: 'start', topic: 'TOPIC_Goats', start: 1, end: 5 }]);
    expect(recognizeQuestSteps(next)[0].misVariable).toBe('MIS_Goats');
  });

  it('edits the entry text, adding the entry line when the step had none', () => {
    const actions = withContext(buildQuestStepActions({ kind: 'complete', topic: 'TOPIC_Sheep' }));
    const [step] = recognizeQuestSteps(actions);
    const added = setQuestStepText(actions, step, 'All sheep home.');
    const [after] = recognizeQuestSteps(added);
    expect(after).toMatchObject({ kind: 'complete', start: 1, end: 4, text: 'All sheep home.' });

    const edited = setQuestStepText(added, after, 'Changed.');
    expect(edited.length).toBe(added.length);
    expect(recognizeQuestSteps(edited)[0].text).toBe('Changed.');
  });

  it('toggles XP on a completion without touching neighbouring lines', () => {
    const actions = withContext(buildQuestStepActions({ kind: 'complete', topic: 'TOPIC_Sheep' }));
    const [step] = recognizeQuestSteps(actions);
    const on = setQuestStepXp(actions, step, 'XP_Sheep');
    expect(on[3]).toEqual({ type: 'GivePlayerXPAction', xpAmount: 'XP_Sheep' });
    expect(on[4]).toBe(actions[3]);

    const [withXp] = recognizeQuestSteps(on);
    const changed = setQuestStepXp(on, withXp, '150');
    expect(recognizeQuestSteps(changed)[0].xp).toBe('150');

    const off = setQuestStepXp(on, withXp, null);
    expect(off).toEqual(actions);
  });
});
