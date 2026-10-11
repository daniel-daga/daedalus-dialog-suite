/**
 * Quest conditions (#323): the recogniser that reads a vanilla `MIS_` check as
 * "Quest X is …", and the builder that writes one back.
 *
 * Recognition runs on real parser output, and the builder's output is turned
 * into code by the parser's own codegen, so both ends are what the editor
 * actually receives and saves.
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import {
  recognizeQuestCondition,
  buildQuestCondition,
  questConditionScript,
  QUEST_CONDITION_STATES
} from '../src/renderer/quest/domain/questConditions';
import type { DialogCondition } from '../src/renderer/types/global';

function runParser(script: string, input: string): string {
  return execFileSync(process.execPath, ['-e', script], { input, encoding: 'latin1' });
}

/** The conditions of each function, as the parser hands them to the editor. */
function parseConditions(source: string): Record<string, DialogCondition[]> {
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
      for (const [name, fn] of Object.entries(visitor.semanticModel.functions)) out[name] = fn.conditions;
      process.stdout.write(JSON.stringify(out));
    });
  `;
  return JSON.parse(runParser(script, source));
}

/** What the save path writes for a condition object. */
function generate(condition: DialogCondition): string {
  const modelPath = require.resolve('daedalus-parser/semantic-model');
  const script = `
    let src = '';
    process.stdin.on('data', (d) => { src += d; });
    process.stdin.on('end', () => {
      const { deserializeCondition } = require(${JSON.stringify(modelPath)});
      process.stdout.write(deserializeCondition(JSON.parse(src)).generateCode({}));
    });
  `;
  return runParser(script, JSON.stringify(condition));
}

// Only a dialog's condition function has its checks extracted.
const condition = (expr: string) => `
instance DIA_Test (C_INFO)
{
	npc = BAU_950_Lobart;
	condition = DIA_Test_Condition;
};

func int DIA_Test_Condition()
{
	if (${expr})
	{
		return TRUE;
	};
};
`;

const parsedOne = (expr: string): DialogCondition => {
  const conditions = parseConditions(condition(expr)).DIA_Test_Condition;
  expect(conditions).toHaveLength(1);
  return conditions[0];
};

describe('recognizeQuestCondition', () => {
  test.each([
    ['MIS_Lobart_Rueben == LOG_RUNNING', 'running'],
    ['MIS_Lobart_Rueben == LOG_SUCCESS', 'success'],
    ['MIS_Lobart_Rueben == LOG_FAILED', 'failed'],
    ['MIS_Lobart_Rueben == LOG_OBSOLETE', 'obsolete'],
    ['MIS_Lobart_Rueben == FALSE', 'not_started'],
    ['MIS_Lobart_Rueben == 0', 'not_started'],
    ['!MIS_Lobart_Rueben', 'not_started'],
    ['MIS_Lobart_Rueben != LOG_RUNNING', 'not_running']
  ])('reads %s as %s', (expr, state) => {
    expect(recognizeQuestCondition(parsedOne(expr))).toEqual({ misVariable: 'MIS_Lobart_Rueben', state });
  });

  test.each([
    // Not a MIS_ variable: a LOG_ value alone does not make it a quest.
    'Lobart_Rueben == LOG_RUNNING',
    // A number other than 0 may be a counter, not a lifecycle state.
    'MIS_Lobart_Rueben == 2',
    // "Not completed" and friends have no plain-language form yet.
    'MIS_Lobart_Rueben != LOG_SUCCESS',
    'MIS_Lobart_Rueben > LOG_RUNNING',
    // "Is started" is not one of the states.
    'MIS_Lobart_Rueben',
    'Npc_KnowsInfo (other, DIA_Lobart_Start)'
  ])('leaves %s as it is', (expr) => {
    expect(recognizeQuestCondition(parsedOne(expr))).toBeNull();
  });

  test('a fresh quest condition with no quest picked yet is still one', () => {
    expect(recognizeQuestCondition(buildQuestCondition('', 'success'))).toEqual({ misVariable: '', state: 'success' });
  });
});

describe('buildQuestCondition', () => {
  test.each(QUEST_CONDITION_STATES.map((s) => [s]))('%s writes the vanilla check and reads back as itself', (state) => {
    const built = buildQuestCondition('MIS_Lobart_Rueben', state);
    const code = generate(built);
    expect(code).toBe(questConditionScript({ misVariable: 'MIS_Lobart_Rueben', state }));
    expect(recognizeQuestCondition(parsedOne(code))).toEqual({ misVariable: 'MIS_Lobart_Rueben', state });
  });

  test('scripts are the vanilla forms', () => {
    const script = (state: (typeof QUEST_CONDITION_STATES)[number]) =>
      questConditionScript({ misVariable: 'MIS_X', state });
    expect(QUEST_CONDITION_STATES.map(script)).toEqual([
      'MIS_X == LOG_RUNNING',
      'MIS_X == LOG_SUCCESS',
      'MIS_X == LOG_FAILED',
      'MIS_X == LOG_OBSOLETE',
      'MIS_X == FALSE',
      'MIS_X != LOG_RUNNING'
    ]);
  });
});
