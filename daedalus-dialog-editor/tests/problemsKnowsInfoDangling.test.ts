/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { knowsInfoDanglingRule } from '../src/renderer/problems/domain/rules/knowsInfoDangling';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { FileModel, ProjectView } from '../src/renderer/problems/domain/types';
import type { DialogFunction, SemanticModel } from '../src/shared/types';

const model = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {},
  functions: {},
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: [],
  ...overrides
});

const fn = (name: string, conditions: DialogFunction['conditions']): DialogFunction => ({
  name,
  returnType: 'INT',
  actions: [],
  conditions,
  calls: []
});

const knowsInfo = (dialogRef: string): DialogFunction['conditions'][number] => ({
  type: 'NpcKnowsInfoCondition',
  npc: 'self',
  dialogRef
});

const file = (filePath: string, m: SemanticModel): FileModel => ({ filePath, model: m });

/**
 * Parse with the real parser in a child process (the native tree-sitter
 * binding cannot be loaded into more than one Jest module registry per worker;
 * see simulatorParserIntegration.test.ts).
 */
function parseWithRealParser(source: string): { hasErrors: boolean; model: SemanticModel } {
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
      process.stdout.write(JSON.stringify({ hasErrors: !!result.hasErrors, model: visitor.semanticModel }));
    });
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    input: source,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  return JSON.parse(output);
}

const FIXTURE = path.resolve(
  __dirname, '..', '..', 'daedalus-parser', 'test', 'fixtures', 'corpus', 'condition-idioms.d'
);

const sitesOf = (view: ProjectView): string[] =>
  knowsInfoDanglingRule(view).map((p) =>
    p.locus.kind === 'script' ? `${p.locus.functionName}:${p.locus.line}` : p.locus.kind
  );

/** A file that declares the dialog so `dialogNameKeys` is populated by real aggregation. */
const dialogFile = file(
  'dialogs.d',
  model({ dialogs: { DIA_Alrik_Hello: { name: 'DIA_Alrik_Hello', parent: 'C_INFO', properties: {} } } })
);

describe('knowsInfoDanglingRule', () => {
  it('emits no problem when the dialogRef names an existing dialog', () => {
    const files = [
      dialogFile,
      file('cond.d', model({ functions: { Check: fn('Check', [knowsInfo('DIA_Alrik_Hello')]) } }))
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(knowsInfoDanglingRule(view)).toEqual([]);
  });

  it('emits exactly one error when the dialogRef names a non-existent dialog', () => {
    const files = [
      dialogFile,
      file('cond.d', model({ functions: { Check: fn('Check', [knowsInfo('DIA_Ghost')]) } }))
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    const problems = knowsInfoDanglingRule(view);

    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe('knowsinfo-dangling');
    expect(problems[0].severity).toBe('error');
    expect(problems[0].locus).toEqual({
      kind: 'script',
      filePath: 'cond.d',
      functionName: 'Check'
    });
    expect(problems[0].message).toContain('DIA_Ghost');
  });

  it('matches the dialog case-insensitively', () => {
    const files = [
      dialogFile,
      file('cond.d', model({ functions: { Check: fn('Check', [knowsInfo('dia_alrik_HELLO')]) } }))
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(knowsInfoDanglingRule(view)).toEqual([]);
  });

  it('ignores non-KnowsInfo conditions', () => {
    const files = [
      dialogFile,
      file(
        'cond.d',
        model({
          functions: {
            Check: fn('Check', [{ type: 'VariableCondition', variableName: 'MIS_X', negated: false }])
          }
        })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(knowsInfoDanglingRule(view)).toEqual([]);
  });
});

/**
 * The parser extracts a structured `NpcKnowsInfoCondition` only from a
 * condition function whose whole body is one `if (clauses) { return TRUE; };`.
 * Every other shape keeps the call as text — the raw body of a condition
 * function, an `if` guard in an information function, or a raw `Condition`
 * clause beside the structured ones — and the rule reported none of them
 * (#496).
 */
describe('knowsInfoDanglingRule over real parser output', () => {
  it('finds the call the parser left in a raw condition-function body', () => {
    const parsed = parseWithRealParser(fs.readFileSync(FIXTURE, 'utf8'));
    expect(parsed.hasErrors).toBe(false);
    const view = buildProjectView({
      files: [file('condition-idioms.d', parsed.model)],
      knownNpcNames: []
    });

    expect(sitesOf(view)).toEqual(['DIA_Foo_Condition:4', 'DIA_Baz_Condition:25']);
    expect(parsed.model.functions.DIA_Foo_Condition.conditions).toEqual([]);
  });

  it('stays silent for that body once the dialog is declared', () => {
    const parsed = parseWithRealParser(`${fs.readFileSync(FIXTURE, 'utf8')}
instance DIA_Foo (C_INFO) { npc = PC_Hero; nr = 1; condition = DIA_Foo_Condition; };
`);
    expect(parsed.hasErrors).toBe(false);
    const view = buildProjectView({
      files: [file('condition-idioms.d', parsed.model)],
      knownNpcNames: []
    });

    expect(knowsInfoDanglingRule(view)).toEqual([]);
  });

  it('finds an information-function guard and a raw clause beside structured ones', () => {
    const parsed = parseWithRealParser(`
instance DIA_Probe (C_INFO) { npc = PC_Hero; nr = 1; condition = Cond_Probe; };

func int Cond_Probe ()
{
	if (Npc_HasItems (other, ItWr_Map) && !(Npc_KnowsInfo (other, DIA_CondMissing)))
	{
		return TRUE;
	};
};

func void Info_Talk ()
{
	if (Npc_KnowsInfo (other, DIA_InfoMissing))
	{
		AI_Output (other, self, "DIA_Talk_01_00");
	};
};
`);
    expect(parsed.hasErrors).toBe(false);
    const view = buildProjectView({ files: [file('probe.d', parsed.model)], knownNpcNames: [] });

    const problems = knowsInfoDanglingRule(view);

    expect(problems.map((p) => (p.locus.kind === 'script' ? p.locus.functionName : '')).sort()).toEqual([
      'Cond_Probe',
      'Info_Talk'
    ]);
    const message = problems.map((p) => p.message).join('\n');
    expect(message).toContain('DIA_CondMissing');
    expect(message).toContain('DIA_InfoMissing');
  });
});
