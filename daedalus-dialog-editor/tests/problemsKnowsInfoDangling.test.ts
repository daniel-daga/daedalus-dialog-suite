import { knowsInfoDanglingRule } from '../src/renderer/problems/domain/rules/knowsInfoDangling';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { FileModel } from '../src/renderer/problems/domain/types';
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
