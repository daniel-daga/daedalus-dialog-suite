import {
  getActionAtPath,
  updateActionAtPath,
  insertActionAfterPath,
  deleteActionAtPath,
  flattenActionPaths,
  collectChoiceActions,
  mapChoiceTargetFunctions
} from '../src/renderer/components/nestedActionUtils';

describe('nestedActionUtils', () => {
  const createModel = () => ([
    {
      type: 'DialogLine',
      speaker: 'self',
      text: 'top',
      id: 'DIA_Test_08_00'
    },
    {
      type: 'ConditionalAction',
      condition: 'Wld_GetDay() == 0',
      thenActions: [
        {
          type: 'DialogLine',
          speaker: 'other',
          text: 'then',
          id: 'DIA_Test_15_01'
        }
      ],
      elseActions: [
        {
          type: 'DialogLine',
          speaker: 'self',
          text: 'else',
          id: 'DIA_Test_08_02'
        }
      ]
    }
  ]) as any[];

  test('gets nested actions by path', () => {
    const actions = createModel();

    expect(getActionAtPath(actions, [1])?.type).toBe('ConditionalAction');
    expect(getActionAtPath(actions, [1, 'then', 0])?.text).toBe('then');
    expect(getActionAtPath(actions, [1, 'else', 0])?.text).toBe('else');
  });

  test('updates nested branch actions without mutating siblings', () => {
    const actions = createModel();
    const updated = updateActionAtPath(actions, [1, 'then', 0], {
      ...actions[1].thenActions[0],
      text: 'updated then'
    });

    expect(updated).not.toBe(actions);
    expect(updated[1]).not.toBe(actions[1]);
    expect(updated[1].thenActions[0].text).toBe('updated then');
    expect(updated[1].elseActions[0].text).toBe('else');
    expect(actions[1].thenActions[0].text).toBe('then');
  });

  test('updateActionAtPath ignores out-of-range indices (no append/corruption)', () => {
    const actions = createModel();
    const ghost = {
      type: 'DialogLine',
      speaker: 'self',
      text: 'ghost',
      id: 'DIA_Test_08_99'
    } as any;

    // index === length previously appended, corrupting the list. This is the
    // stale-path unmount-flush vector (0.1): a debounce firing at index==length.
    const atLength = updateActionAtPath(actions, [actions.length], ghost);
    expect(atLength).toBe(actions);
    expect(atLength).toHaveLength(2);

    // Any out-of-range index is a no-op returning the original array.
    const beyond = updateActionAtPath(actions, [99], ghost);
    expect(beyond).toBe(actions);
    expect(beyond).toHaveLength(2);
  });

  test('inserts new actions after nested branch paths', () => {
    const actions = createModel();
    const inserted = insertActionAfterPath(actions, [1, 'then', 0], {
      type: 'DialogLine',
      speaker: 'self',
      text: 'after then',
      id: 'DIA_Test_08_03'
    } as any);

    expect(inserted[1].thenActions).toHaveLength(2);
    expect(inserted[1].thenActions[1].text).toBe('after then');
  });

  test('deletes nested actions by path', () => {
    const actions = createModel();
    const deleted = deleteActionAtPath(actions, [1, 'else', 0]);

    expect(deleted[1].elseActions).toHaveLength(0);
    expect(deleted[1].thenActions).toHaveLength(1);
  });

  test('flattens nested action paths in visible order', () => {
    const actions = createModel();
    expect(flattenActionPaths(actions)).toEqual([
      [0],
      [1],
      [1, 'then', 0],
      [1, 'else', 0]
    ]);
  });

  const createChoiceModel = () => ([
    { type: 'Choice', text: 'top choice', targetFunction: 'DIA_Test_Top' },
    {
      type: 'ConditionalAction',
      condition: 'MIS_Quest == LOG_RUNNING',
      thenActions: [
        { type: 'Choice', text: 'nested then', targetFunction: 'DIA_Test_Then' },
        {
          type: 'ConditionalAction',
          condition: 'Npc_HasItems(other, ItMi_Gold) > 0',
          thenActions: [
            { type: 'Choice', text: 'deep', targetFunction: 'DIA_Test_Deep' }
          ],
          elseActions: []
        }
      ],
      elseActions: [
        { type: 'Choice', text: 'nested else', targetFunction: 'DIA_Test_Else' },
        { type: 'DialogLine', speaker: 'self', text: 'line', id: 'DIA_Test_08_00' }
      ]
    }
  ]) as any[];

  test('collectChoiceActions finds choices nested in conditional branches', () => {
    const targets = collectChoiceActions(createChoiceModel()).map((c: any) => c.targetFunction);
    expect(targets).toEqual(['DIA_Test_Top', 'DIA_Test_Then', 'DIA_Test_Deep', 'DIA_Test_Else']);
  });

  test('mapChoiceTargetFunctions rewrites nested targets without mutating input', () => {
    const actions = createChoiceModel();
    const rename = (target: string) =>
      target === 'DIA_Test_Deep' ? 'DIA_Renamed_Deep' : undefined;

    const { actions: updated, changed } = mapChoiceTargetFunctions(actions, rename);

    expect(changed).toBe(true);
    expect((updated[1] as any).thenActions[1].thenActions[0].targetFunction).toBe('DIA_Renamed_Deep');
    // original untouched
    expect((actions[1] as any).thenActions[1].thenActions[0].targetFunction).toBe('DIA_Test_Deep');
    // untouched subtrees keep reference identity
    expect((updated[1] as any).elseActions).toBe((actions[1] as any).elseActions);
  });

  test('mapChoiceTargetFunctions reports unchanged when no target matches', () => {
    const actions = createChoiceModel();
    const { actions: updated, changed } = mapChoiceTargetFunctions(actions, () => undefined);

    expect(changed).toBe(false);
    expect(updated).toBe(actions);
  });
});
