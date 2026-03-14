import { createDialogLineId } from '../src/renderer/components/actionFactory';
import {
  collectAllDialogLineActionsFromModel,
  collectDialogLineActions
} from '../src/renderer/components/nestedActionUtils';

describe('collectAllDialogLineActionsFromModel', () => {
  const makeModel = (functions: Record<string, { actions?: any[] }>) => ({
    functions
  });

  test('collects dialog lines from all functions matching the dialog prefix', () => {
    const model = makeModel({
      DIA_Eder_Info: {
        actions: [
          { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_00', text: 'Hallo' },
          { type: 'DialogLine', speaker: 'self', id: 'DIA_Eder_08_01', text: 'Hi' }
        ]
      },
      DIA_Eder_Choice_1: {
        actions: [
          { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_02', text: 'Was?' }
        ]
      },
      DIA_Eder_Choice_2: {
        actions: [
          { type: 'DialogLine', speaker: 'self', id: 'DIA_Eder_08_03', text: 'Nichts' }
        ]
      },
      DIA_OtherNpc_Info: {
        actions: [
          { type: 'DialogLine', speaker: 'other', id: 'DIA_OtherNpc_15_00', text: 'Unrelated' }
        ]
      }
    });

    const result = collectAllDialogLineActionsFromModel(model, 'DIA_Eder');
    expect(result).toHaveLength(4);
    expect(result.map((a: any) => a.id)).toEqual([
      'DIA_Eder_15_00',
      'DIA_Eder_08_01',
      'DIA_Eder_15_02',
      'DIA_Eder_08_03'
    ]);
  });

  test('strips _Info suffix from dialogName', () => {
    const model = makeModel({
      DIA_Eder_Info: {
        actions: [
          { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_00', text: 'Hallo' }
        ]
      }
    });

    const result = collectAllDialogLineActionsFromModel(model, 'DIA_Eder_Info');
    expect(result).toHaveLength(1);
    expect((result[0] as any).id).toBe('DIA_Eder_15_00');
  });

  test('excludes the specified function', () => {
    const model = makeModel({
      DIA_Eder_Info: {
        actions: [
          { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_00', text: 'Hallo' }
        ]
      },
      DIA_Eder_Choice_1: {
        actions: [
          { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_01', text: 'Was?' }
        ]
      }
    });

    const result = collectAllDialogLineActionsFromModel(model, 'DIA_Eder', 'DIA_Eder_Choice_1');
    expect(result).toHaveLength(1);
    expect((result[0] as any).id).toBe('DIA_Eder_15_00');
  });

  test('returns empty array for empty/undefined dialogName', () => {
    const model = makeModel({
      DIA_Test_Info: { actions: [{ type: 'DialogLine', speaker: 'other', id: 'DIA_Test_15_00', text: '' }] }
    });

    expect(collectAllDialogLineActionsFromModel(model, '')).toEqual([]);
  });

  test('includes dialog lines from nested conditional actions', () => {
    const model = makeModel({
      DIA_Eder_Info: {
        actions: [
          {
            type: 'ConditionalAction',
            condition: 'true',
            thenActions: [
              { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_00', text: 'In then' }
            ],
            elseActions: [
              { type: 'DialogLine', speaker: 'self', id: 'DIA_Eder_08_01', text: 'In else' }
            ]
          }
        ]
      }
    });

    const result = collectAllDialogLineActionsFromModel(model, 'DIA_Eder');
    expect(result).toHaveLength(2);
  });
});

describe('cross-function ID generation avoids duplicates', () => {
  test('new ID in choice function accounts for IDs from sibling functions', () => {
    // Simulate what useActionManagement does: collect from all sibling functions + live actions
    const siblingActions = [
      { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_00', text: 'Main line 1' },
      { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_01', text: 'Main line 2' }
    ];
    const liveActions = [
      { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_02', text: 'Choice 1 line' }
    ];
    const allActions = [...siblingActions, ...liveActions];

    const newId = createDialogLineId({
      dialogName: 'DIA_Eder',
      speaker: 'other',
      actions: allActions
    });

    // Should be 03, not 00 (which would happen if only liveActions were considered)
    expect(newId).toBe('DIA_Eder_15_03');
  });

  test('without cross-function collection, IDs would duplicate', () => {
    // This demonstrates the bug: only using current function's actions
    const liveActions = [
      { type: 'DialogLine', speaker: 'other', id: 'DIA_Eder_15_02', text: 'Choice 1 line' }
    ];

    const newId = createDialogLineId({
      dialogName: 'DIA_Eder',
      speaker: 'other',
      actions: liveActions
    });

    // With only local actions, it would generate 03 which is fine for this function,
    // but if sibling had 03 already, it would be a duplicate
    expect(newId).toBe('DIA_Eder_15_03');
  });
});
