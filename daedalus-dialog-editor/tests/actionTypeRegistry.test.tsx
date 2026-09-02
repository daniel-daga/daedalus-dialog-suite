/**
 * One action-type registry (2026-07 review, 3.2): the card label, the
 * add-action menu and the card icon all read `ACTION_TYPE_REGISTRY`, so no
 * two sites can disagree on a label again.
 */
import React from 'react';
import { describe, test, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { ACTION_TYPE_REGISTRY, ADDABLE_ACTION_TYPES } from '../src/renderer/components/actionTypeRegistry';
import { getActionTypeLabel } from '../src/renderer/components/actionRenderers';
import ActionTypeMenu from '../src/renderer/components/common/ActionTypeMenu';
import type { ActionTypeId } from '../src/renderer/components/actionTypes';

const TYPE_FIELD_BY_ID: Record<ActionTypeId, string> = {
  dialogLine: 'DialogLine',
  choice: 'Choice',
  logEntry: 'LogEntry',
  createTopic: 'CreateTopic',
  logSetTopicStatus: 'LogSetTopicStatus',
  createInventoryItems: 'CreateInventoryItems',
  giveInventoryItems: 'GiveInventoryItems',
  attackAction: 'AttackAction',
  setAttitudeAction: 'SetAttitudeAction',
  chapterTransition: 'ChapterTransitionAction',
  exchangeRoutine: 'ExchangeRoutineAction',
  setVariableAction: 'SetVariableAction',
  stopProcessInfosAction: 'StopProcessInfosAction',
  playAniAction: 'PlayAniAction',
  setRefuseTalkAction: 'SetRefuseTalkAction',
  clearChoicesAction: 'ClearChoicesAction',
  givePlayerXPAction: 'GivePlayerXPAction',
  pickpocketAction: 'PickpocketAction',
  startOtherRoutineAction: 'StartOtherRoutineAction',
  teachAction: 'TeachAction',
  giveTradeInventoryAction: 'GiveTradeInventoryAction',
  removeInventoryItemsAction: 'RemoveInventoryItemsAction',
  insertNpcAction: 'InsertNpcAction',
  heroFollowsAction: 'HeroFollowsAction',
  conditionalAction: 'ConditionalAction',
  commentAction: 'CommentAction',
  customAction: 'Action'
};

function renderOpenMenu() {
  render(
    <ActionTypeMenu anchorEl={document.body} onClose={jest.fn()} onSelect={jest.fn()} />
  );
  return screen.getAllByRole('menuitem');
}

describe('actionTypeRegistry', () => {
  test('no two sites disagree on a label', () => {
    const items = renderOpenMenu();
    const menuLabels = items.map((item) => item.textContent);

    for (const id of ADDABLE_ACTION_TYPES) {
      const registryLabel = ACTION_TYPE_REGISTRY[id].label;
      // The card tooltip (getActionTypeLabel) and the registry agree.
      expect(getActionTypeLabel({ type: TYPE_FIELD_BY_ID[id] })).toBe(registryLabel);
      // The add-action menu and the registry agree.
      expect(menuLabels).toContain(registryLabel);
    }
  });

  test('the menu offers exactly the addable registry entries, in registry order', () => {
    const items = renderOpenMenu();
    expect(items.map((item) => item.textContent)).toEqual(
      ADDABLE_ACTION_TYPES.map((id) => ACTION_TYPE_REGISTRY[id].label)
    );
    // Comments are parser-preserved only: never offered, but still labelled.
    expect(ADDABLE_ACTION_TYPES).not.toContain('commentAction');
    expect(getActionTypeLabel({ type: 'CommentAction' })).toBe('Comment');
  });

  test('the menu renders the registry icon for each item', () => {
    const items = renderOpenMenu();
    items.forEach((item, index) => {
      const id = ADDABLE_ACTION_TYPES[index];
      const { container } = render(React.createElement(ACTION_TYPE_REGISTRY[id].icon));
      const expected = container.querySelector('svg')?.getAttribute('data-testid');
      expect(expected).toBeTruthy();
      expect(item.querySelector('svg')?.getAttribute('data-testid')).toBe(expected);
    });
  });
});
