import { voiceIdRule } from '../src/renderer/problems/domain/rules/voiceId';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { FileModel } from '../src/renderer/problems/domain/types';
import type { DialogAction, DialogFunction, SemanticModel } from '../src/shared/types';

const line = (id: string, extra: Partial<DialogAction> = {}): DialogAction => ({
  type: 'DialogLine',
  speaker: 'self',
  text: 'hi',
  id,
  ...extra
});

const conditional = (thenActions: DialogAction[]): DialogAction => ({
  type: 'ConditionalAction',
  condition: 'Npc_HasItems',
  thenActions,
  elseActions: []
});

const func = (name: string, actions: DialogAction[]): DialogFunction => ({
  name,
  returnType: 'VOID',
  actions,
  conditions: [],
  calls: []
});

const model = (functions: Record<string, DialogFunction>): SemanticModel => ({
  dialogs: {},
  functions,
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: []
});

const file = (filePath: string, functions: Record<string, DialogFunction>): FileModel => ({
  filePath,
  model: model(functions)
});

const viewOf = (files: FileModel[]) => buildProjectView({ files, knownNpcNames: [] });

describe('voiceIdRule', () => {
  it('flags a well-formed voice id reused across two files once per occurrence', () => {
    const view = viewOf([
      file('a.d', { DIA_A: func('DIA_A', [line('DIA_Alrik_Hi_15_00')]) }),
      file('b.d', { DIA_B: func('DIA_B', [line('DIA_Alrik_Hi_15_00')]) })
    ]);

    const problems = voiceIdRule(view);
    const duplicates = problems.filter((p) => p.rule === 'voice-id-duplicate');
    const malformed = problems.filter((p) => p.rule === 'voice-id-malformed');

    expect(malformed).toHaveLength(0);
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((p) => p.filePath).sort()).toEqual(['a.d', 'b.d']);
    expect(duplicates[0]).toMatchObject({
      rule: 'voice-id-duplicate',
      severity: 'warning'
    });
    expect(duplicates[0].message).toBe(
      'Voice ID "DIA_Alrik_Hi_15_00" is used 2 times across the project.'
    );
    expect(new Set(duplicates.map((p) => p.id))).toEqual(
      new Set([
        'voice-id-duplicate:a.d:DIA_A:DIA_ALRIK_HI_15_00',
        'voice-id-duplicate:b.d:DIA_B:DIA_ALRIK_HI_15_00'
      ])
    );
  });

  it('does not flag a unique well-formed voice id', () => {
    const view = viewOf([file('a.d', { DIA_A: func('DIA_A', [line('DIA_Alrik_Hi_15_00')]) })]);

    expect(voiceIdRule(view)).toEqual([]);
  });

  it('flags a malformed voice id exactly once with no duplicate', () => {
    const view = viewOf([file('a.d', { DIA_A: func('DIA_A', [line('DIA_Alrik_Hi')]) })]);

    const problems = voiceIdRule(view);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      rule: 'voice-id-malformed',
      severity: 'warning',
      filePath: 'a.d',
      functionName: 'DIA_A',
      id: 'voice-id-malformed:a.d:DIA_A:DIA_ALRIK_HI'
    });
    expect(problems[0].message).toBe(
      'Voice ID "DIA_Alrik_Hi" does not match the expected naming pattern (…_<number>_<number>).'
    );
  });

  it('ignores DialogLines whose id is an expression', () => {
    const view = viewOf([
      file('a.d', { DIA_A: func('DIA_A', [line('someVar', { idIsExpression: true })]) }),
      file('b.d', { DIA_B: func('DIA_B', [line('someVar', { idIsExpression: true })]) })
    ]);

    expect(voiceIdRule(view)).toEqual([]);
  });

  it('collects ids nested inside a conditional branch', () => {
    const view = viewOf([
      file('a.d', { DIA_A: func('DIA_A', [line('DIA_Alrik_Hi_15_00')]) }),
      file('b.d', {
        DIA_B: func('DIA_B', [conditional([line('DIA_Alrik_Hi_15_00')])])
      })
    ]);

    const duplicates = voiceIdRule(view).filter((p) => p.rule === 'voice-id-duplicate');

    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((p) => p.filePath).sort()).toEqual(['a.d', 'b.d']);
  });
});
