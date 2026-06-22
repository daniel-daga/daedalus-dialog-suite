/**
 * Issue #183 items 1–2 for the "Give Inventory Item" action:
 *   1. A swap button flips Giver <-> Receiver (and stays out of the Tab order so
 *      the in-row Tab navigation from item 3 is unaffected).
 *   2. Adding the action pre-fills the Item from an "NPC has item"
 *      (NpcHasItemsCondition) condition in the same dialog instance.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import GiveInventoryItemsRenderer from '../src/renderer/components/actionRenderers/GiveInventoryItemsRenderer';
import { createAction } from '../src/renderer/components/actionFactory';
import type { GiveInventoryItemsAction, SemanticModel } from '../src/renderer/types/global';

function renderRenderer(action: GiveInventoryItemsAction) {
  const handleUpdate = jest.fn();
  render(
    <GiveInventoryItemsRenderer
      action={action}
      path={[0] as never}
      index={0}
      totalActions={1}
      npcName="TestNPC"
      handleUpdate={handleUpdate}
      handleDelete={jest.fn()}
      flushUpdate={jest.fn()}
      handleKeyDown={jest.fn()}
      mainFieldRef={{ current: null }}
      semanticModel={undefined}
    />
  );
  return handleUpdate;
}

describe('Give Inventory Item: swap Giver <-> Receiver (issue #183 item 1)', () => {
  test('clicking the swap button swaps giver and receiver', () => {
    const handleUpdate = renderRenderer({
      type: 'GiveInventoryItems',
      giver: 'self',
      receiver: 'other',
      item: 'ItMi_Gold',
      quantity: 1,
    });

    fireEvent.click(screen.getByLabelText('Swap giver and receiver'));

    expect(handleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ giver: 'other', receiver: 'self', item: 'ItMi_Gold', quantity: 1 })
    );
  });

  test('the swap button is excluded from the Tab order', () => {
    renderRenderer({
      type: 'GiveInventoryItems',
      giver: 'self',
      receiver: 'other',
      item: '',
      quantity: 1,
    });

    expect(screen.getByLabelText('Swap giver and receiver')).toHaveAttribute('tabindex', '-1');
  });
});

function modelWithCondition(conditions: unknown[]): SemanticModel {
  return {
    dialogs: {
      DIA_X: {
        name: 'DIA_X',
        parent: 'C_INFO',
        properties: { condition: 'DIA_X_Condition', information: 'DIA_X_Info' },
      },
    },
    functions: {
      DIA_X_Condition: {
        name: 'DIA_X_Condition',
        returnType: 'INT',
        actions: [],
        conditions,
        calls: [],
      },
    },
    hasErrors: false,
    errors: [],
  } as unknown as SemanticModel;
}

describe('Give Inventory Item: pre-fill Item from condition (issue #183 item 2)', () => {
  test('seeds the Item from an NpcHasItemsCondition in the same dialog instance', () => {
    const semanticModel = modelWithCondition([
      { type: 'NpcHasItemsCondition', npc: 'other', item: 'ItMi_Stuff' },
    ]);

    const action = createAction('giveInventoryItems', {
      dialogName: 'DIA_X',
      semanticModel,
    }) as GiveInventoryItemsAction;

    expect(action.item).toBe('ItMi_Stuff');
    // Giver/receiver keep their template defaults — only the Item is seeded.
    expect(action.giver).toBe('self');
  });

  test('falls back to the default Item when the dialog has no such condition', () => {
    const semanticModel = modelWithCondition([
      { type: 'NpcKnowsInfoCondition', npc: 'self', info: 'DIA_Other' },
    ]);

    const action = createAction('giveInventoryItems', {
      dialogName: 'DIA_X',
      semanticModel,
    }) as GiveInventoryItemsAction;

    expect(action.item).toBe('ItMi_Gold');
  });

  test('falls back to the default Item when there is no dialog context', () => {
    const action = createAction('giveInventoryItems') as GiveInventoryItemsAction;
    expect(action.item).toBe('ItMi_Gold');
  });
});
