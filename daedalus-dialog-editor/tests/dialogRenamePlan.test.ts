/**
 * The rules of a dialog rename, in one place (`planDialogRename`).
 *
 * They were written twice — once in `fileStore.renameDialog`, which performs the
 * rename, and once in `ThreeColumnLayout`, which previews it and pre-checks the
 * name — and the two already disagreed: the store matched the dialog-name prefix
 * case-insensitively and the preview did not, so for a function named
 * `dia_test_Info` under dialog `DIA_Test` the review panel listed no functions
 * while the rename renamed one.
 */

import { describe, it, expect } from '@jest/globals';
import { planDialogRename } from '../src/renderer/components/dialogUtils';
import type { SemanticModel } from '../src/renderer/types/global';

const fn = (name: string): any => ({ name, returnType: 'VOID', actions: [], conditions: [], calls: [] });

const model = (over: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {
    DIA_Test: {
      name: 'DIA_Test',
      parent: 'C_INFO',
      properties: { npc: 'NPC1', information: 'DIA_Test_Info', condition: 'DIA_Test_Condition' }
    }
  },
  functions: {
    DIA_Test_Info: fn('DIA_Test_Info'),
    DIA_Test_Condition: fn('DIA_Test_Condition'),
    DIA_Other_Info: fn('DIA_Other_Info')
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: [],
  ...over
});

describe('planDialogRename', () => {
  it('renames the dialog-owned functions that follow its name, and nothing else', () => {
    const plan = planDialogRename(model(), 'DIA_Test', 'DIA_New');
    expect(plan.error).toBeNull();
    expect(plan.functions).toEqual([
      { oldName: 'DIA_Test_Info', newName: 'DIA_New_Info' },
      { oldName: 'DIA_Test_Condition', newName: 'DIA_New_Condition' }
    ]);
  });

  it('matches the dialog-name prefix case-insensitively, as the store does', () => {
    const plan = planDialogRename(
      model({
        dialogs: {
          DIA_Test: {
            name: 'DIA_Test',
            parent: 'C_INFO',
            properties: { npc: 'NPC1', information: 'dia_test_Info' }
          }
        },
        functions: { dia_test_Info: fn('dia_test_Info') }
      }),
      'DIA_Test',
      'DIA_New'
    );
    expect(plan.functions).toEqual([{ oldName: 'dia_test_Info', newName: 'DIA_New_Info' }]);
  });

  it('refuses a dialog name that is taken, in any case', () => {
    const plan = planDialogRename(
      model({
        dialogs: {
          DIA_Test: { name: 'DIA_Test', parent: 'C_INFO', properties: { information: 'DIA_Test_Info' } },
          dia_taken: { name: 'dia_taken', parent: 'C_INFO', properties: {} }
        } as any
      }),
      'DIA_Test',
      'DIA_Taken'
    );
    expect(plan.error).toMatch(/already exists/);
  });

  it('refuses a derived function name that is taken, which the dialog name alone cannot show', () => {
    // The rename dialog only checks the dialog's own new name; the functions
    // it derives can still collide, and that refusal used to arrive as a throw
    // from the store with nothing on screen.
    const plan = planDialogRename(
      model({ functions: { DIA_Test_Info: fn('DIA_Test_Info'), DIA_New_Info: fn('DIA_New_Info') } }),
      'DIA_Test',
      'DIA_New'
    );
    expect(plan.error).toMatch(/DIA_New_Info/);
  });

  it('refuses a dialog that is not in the model', () => {
    expect(planDialogRename(model(), 'DIA_Missing', 'DIA_New').error).toMatch(/not in this file/);
  });

  it('plans no function renames when cascading is off', () => {
    expect(planDialogRename(model(), 'DIA_Test', 'DIA_New', false).functions).toEqual([]);
  });
});
