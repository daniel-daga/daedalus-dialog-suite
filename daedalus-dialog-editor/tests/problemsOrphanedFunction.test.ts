import { orphanedFunctionRule } from '../src/renderer/problems/domain/rules/orphanedFunction';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { FileModel } from '../src/renderer/problems/domain/types';
import type { Dialog, DialogFunction, SemanticModel } from '../src/shared/types';

const model = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {},
  functions: {},
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: [],
  ...overrides
});

const fn = (name: string, overrides: Partial<DialogFunction> = {}): DialogFunction => ({
  name,
  returnType: 'INT',
  actions: [],
  conditions: [],
  calls: [],
  ...overrides
});

const dialog = (name: string, properties: Dialog['properties']): Dialog => ({
  name,
  parent: 'C_INFO',
  properties
});

const file = (filePath: string, m: SemanticModel): FileModel => ({ filePath, model: m });

describe('orphanedFunctionRule', () => {
  it('does not flag a function used as a dialog information property', () => {
    const files = [
      file(
        'dialogs.d',
        model({
          dialogs: { DIA_Hello: dialog('DIA_Hello', { information: 'Info_Hello' }) },
          functions: { Info_Hello: fn('Info_Hello') }
        })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(orphanedFunctionRule(view)).toEqual([]);
  });

  it('does not flag a function used as a dialog condition property', () => {
    const files = [
      file(
        'dialogs.d',
        model({
          dialogs: { DIA_Hello: dialog('DIA_Hello', { condition: 'Cond_Hello' }) },
          functions: { Cond_Hello: fn('Cond_Hello') }
        })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(orphanedFunctionRule(view)).toEqual([]);
  });

  it('does not flag a function referenced only as a Choice targetFunction', () => {
    // Info_Menu is anchored by a dialog so only Info_Sub's Choice reference is under test.
    const files = [
      file(
        'dialogs.d',
        model({
          dialogs: { DIA_Menu: dialog('DIA_Menu', { information: 'Info_Menu' }) },
          functions: {
            Info_Menu: fn('Info_Menu', {
              actions: [{ type: 'Choice', dialogRef: 'DIA_Menu', text: 'Go', targetFunction: 'Info_Sub' }]
            }),
            Info_Sub: fn('Info_Sub')
          }
        })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    const problems = orphanedFunctionRule(view);
    expect(problems.map((p) => p.functionName)).not.toContain('Info_Sub');
  });

  it('does not flag a function referenced only via another function calls array', () => {
    // Info_Main is anchored by a dialog so only Helper_Fn's calls reference is under test.
    const files = [
      file(
        'dialogs.d',
        model({
          dialogs: { DIA_Main: dialog('DIA_Main', { information: 'Info_Main' }) },
          functions: {
            Info_Main: fn('Info_Main', { calls: ['Helper_Fn'] }),
            Helper_Fn: fn('Helper_Fn')
          }
        })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    const problems = orphanedFunctionRule(view);
    expect(problems.map((p) => p.functionName)).not.toContain('Helper_Fn');
  });

  it('flags a function referenced by nobody with exactly one warning', () => {
    const files = [
      file('dialogs.d', model({ functions: { Lonely_Fn: fn('Lonely_Fn') } }))
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    const problems = orphanedFunctionRule(view);

    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe('orphaned-function');
    expect(problems[0].severity).toBe('warning');
    expect(problems[0].functionName).toBe('Lonely_Fn');
    expect(problems[0].filePath).toBe('dialogs.d');
    expect(problems[0].message).toContain('Lonely_Fn');
    expect(problems[0].id).toBe('orphaned-function:dialogs.d:Lonely_Fn');
  });

  it('resolves references across files case-insensitively', () => {
    const files = [
      file('defs.d', model({ functions: { Info_Target: fn('Info_Target') } })),
      file(
        'dialogs.d',
        model({ dialogs: { DIA_Ref: dialog('DIA_Ref', { information: 'info_TARGET' }) } })
      )
    ];
    const view = buildProjectView({ files, knownNpcNames: [] });

    expect(orphanedFunctionRule(view)).toEqual([]);
  });
});
