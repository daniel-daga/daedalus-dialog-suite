import { choiceNoClearChoicesRule } from '../src/renderer/problems/domain/rules/choiceNoClearChoices';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { FileModel } from '../src/renderer/problems/domain/types';
import type { DialogAction, DialogFunction, SemanticModel } from '../src/shared/types';

const choice = (targetFunction: string): DialogAction => ({
  type: 'Choice',
  dialogRef: 'DIA_X',
  text: 'opt',
  targetFunction
});

const clearChoices = (): DialogAction => ({
  type: 'ClearChoicesAction',
  dialog: 'DIA_X'
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

const file = (filePath: string, m: SemanticModel): FileModel => ({ filePath, model: m });

const viewOf = (functions: Record<string, DialogFunction>) =>
  buildProjectView({ files: [file('a.d', model(functions))], knownNpcNames: [] });

describe('choiceNoClearChoicesRule', () => {
  it('does not flag when the choice target clears the menu', () => {
    const view = viewOf({
      DIA_X_Info: func('DIA_X_Info', [choice('DIA_X_opt')]),
      DIA_X_opt: func('DIA_X_opt', [clearChoices()])
    });

    expect(choiceNoClearChoicesRule(view)).toEqual([]);
  });

  it('flags a function whose choice chain never clears exactly once', () => {
    const view = viewOf({
      DIA_X_Info: func('DIA_X_Info', [choice('DIA_X_opt')]),
      DIA_X_opt: func('DIA_X_opt', [])
    });

    const problems = choiceNoClearChoicesRule(view);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      rule: 'choice-no-clearchoices',
      severity: 'warning',
      functionName: 'DIA_X_Info',
      filePath: 'a.d',
      id: 'choice-no-clearchoices:a.d:DIA_X_Info'
    });
    expect(problems[0].message).toBe(
      'Function "DIA_X_Info" opens a choice menu (Info_AddChoice) with no Info_ClearChoices in any reachable choice target.'
    );
  });

  it('does not flag when the choice is nested in a conditional and the target clears', () => {
    const view = viewOf({
      DIA_X_Info: func('DIA_X_Info', [conditional([choice('DIA_X_opt')])]),
      DIA_X_opt: func('DIA_X_opt', [clearChoices()])
    });

    expect(choiceNoClearChoicesRule(view)).toEqual([]);
  });

  it('does not flag a function with no choices', () => {
    const view = viewOf({
      DIA_Plain: func('DIA_Plain', [])
    });

    expect(choiceNoClearChoicesRule(view)).toEqual([]);
  });
});
