import { createDialogLineId } from '../src/renderer/components/actionFactory';

describe('createDialogLineId', () => {
  test('uses corpus-style defaults when no existing lines are present', () => {
    const id = createDialogLineId({
      dialogName: 'DIA_TestDialog',
      speaker: 'other',
      actions: []
    });

    expect(id).toBe('DIA_TestDialog_15_00');
  });

  test('reuses existing token for speaker and increments index', () => {
    const actions = [
      { type: 'DialogLine', speaker: 'self', id: 'DIA_TestDialog_08_00' },
      { type: 'DialogLine', speaker: 'other', id: 'DIA_TestDialog_15_01' }
    ];

    const id = createDialogLineId({
      dialogName: 'DIA_TestDialog',
      speaker: 'self',
      actions
    });

    expect(id).toBe('DIA_TestDialog_08_02');
  });

  test('normalizes _Info context names to dialog base names', () => {
    const id = createDialogLineId({
      dialogName: 'DIA_TestDialog_Info',
      speaker: 'other',
      actions: []
    });

    expect(id).toBe('DIA_TestDialog_15_00');
  });

  test('infers speaker token from existing ids even when dialog prefix changed', () => {
    const actions = [
      { type: 'DialogLine', speaker: 'self', id: 'OLD_DIALOG_09_07' },
      { type: 'DialogLine', speaker: 'other', id: 'OLD_DIALOG_15_08' }
    ];

    const id = createDialogLineId({
      dialogName: 'DIA_RenamedDialog',
      speaker: 'self',
      actions
    });

    expect(id).toBe('DIA_RenamedDialog_09_00');
  });
});
