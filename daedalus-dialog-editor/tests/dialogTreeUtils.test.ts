/**
 * #486: the collapsed "can this dialog be expanded" test looked at top-level
 * actions only, while the traversal underneath walks into branches. A dialog
 * whose choices all sit inside an `if`/`else` — the normal conditional shape —
 * therefore had no expander, and its choices were unreachable from the tree.
 */

import { describe, test, expect } from '@jest/globals';
import { flattenDialogs } from '../src/renderer/components/dialogTreeUtils';

const choice = (targetFunction: string) => ({ type: 'Choice', dialogRef: 'DIA_B', targetFunction });

const flatten = (actions: any[]) =>
  flattenDialogs(
    ['DIA_A'],
    { DIA_A: { name: 'DIA_A', parent: 'C_INFO', properties: { npc: 'NPC1', information: 'DIA_A_Info' } } } as any,
    { DIA_A_Info: { name: 'DIA_A_Info', returnType: 'VOID', actions, conditions: [], calls: [] } } as any,
    new Set(),
    new Set(),
    () => null
  );

describe('flattenDialogs', () => {
  test('a choice nested in an if/else still gives the collapsed dialog an expander', () => {
    const [row] = flatten([
      { type: 'DialogLine', text: 'Hallo', speaker: 'other' },
      {
        type: 'ConditionalAction',
        condition: { type: 'NpcKnowsInfoCondition', dialogRef: 'DIA_X', npc: 'NPC1' },
        thenActions: [choice('DIA_B_Open_Info')],
        elseActions: []
      }
    ]);

    expect(row).toMatchObject({ type: 'dialog', dialogName: 'DIA_A', hasChildren: true });
  });

  test('a dialog with no choices at all has no expander', () => {
    const [row] = flatten([{ type: 'DialogLine', text: 'Hallo', speaker: 'other' }]);

    expect(row).toMatchObject({ type: 'dialog', dialogName: 'DIA_A', hasChildren: false });
  });
});
