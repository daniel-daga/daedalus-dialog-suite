import {
  getActionAtPath,
  updateActionAtPath,
  insertActionAfterPath,
  deleteActionAtPath,
  flattenActionPaths
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
});
