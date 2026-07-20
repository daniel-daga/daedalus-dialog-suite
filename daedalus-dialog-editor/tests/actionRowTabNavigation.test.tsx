/**
 * Issue #183 follow-up (feature-suggestions Housekeeping item 2): the
 * row-Tab-navigation helper (createRowTabHandlers) is wired into the remaining
 * multi-field action renderers, so Tab walks the fields of a row natively and
 * only the row edges (Tab on the last field / Shift+Tab on the first) fall back
 * to card-to-card navigation.
 *
 * Renderer-level coverage for the representative cases:
 *  - LogEntryRenderer: behavior parity after replacing its hand-rolled handlers
 *  - RemoveInventoryItemsActionRenderer: 4 fields incl. a leading MUI select
 *  - PickpocketActionRenderer: dynamic field count (1 or 3 depending on mode)
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import LogEntryRenderer from '../src/renderer/components/actionRenderers/LogEntryRenderer';
import RemoveInventoryItemsActionRenderer from '../src/renderer/components/actionRenderers/RemoveInventoryItemsActionRenderer';
import PickpocketActionRenderer from '../src/renderer/components/actionRenderers/PickpocketActionRenderer';

function renderWithCardKeyDown(Renderer: React.FC<any>, action: unknown) {
  const handleKeyDown = jest.fn();
  render(
    <Renderer
      action={action as never}
      path={[0] as never}
      index={0}
      totalActions={1}
      npcName="TestNPC"
      handleUpdate={jest.fn()}
      handleDelete={jest.fn()}
      flushUpdate={jest.fn()}
      handleKeyDown={handleKeyDown}
      mainFieldRef={{ current: null }}
      semanticModel={undefined}
    />
  );
  return handleKeyDown;
}

describe('LogEntryRenderer row Tab navigation (parity after refactor to shared helper)', () => {
  const action = { type: 'LogEntry', topic: 'TOPIC_Test', text: 'A log line' };

  test('Tab on Topic stays in the row (card handler not called)', () => {
    const handleKeyDown = renderWithCardKeyDown(LogEntryRenderer, action);
    fireEvent.keyDown(screen.getByLabelText('Topic'), { key: 'Tab' });
    expect(handleKeyDown).not.toHaveBeenCalled();
  });

  test('Tab on Text delegates to card navigation', () => {
    const handleKeyDown = renderWithCardKeyDown(LogEntryRenderer, action);
    fireEvent.keyDown(screen.getByLabelText('Text'), { key: 'Tab' });
    expect(handleKeyDown).toHaveBeenCalled();
  });

  test('Shift+Tab on Topic delegates to card navigation', () => {
    const handleKeyDown = renderWithCardKeyDown(LogEntryRenderer, action);
    fireEvent.keyDown(screen.getByLabelText('Topic'), { key: 'Tab', shiftKey: true });
    expect(handleKeyDown).toHaveBeenCalled();
  });

  test('Shift+Tab on Text stays in the row', () => {
    const handleKeyDown = renderWithCardKeyDown(LogEntryRenderer, action);
    fireEvent.keyDown(screen.getByLabelText('Text'), { key: 'Tab', shiftKey: true });
    expect(handleKeyDown).not.toHaveBeenCalled();
  });
});

describe('RemoveInventoryItemsActionRenderer row Tab navigation', () => {
  const action = {
    type: 'RemoveInventoryItems',
    removeFunctionName: 'Npc_RemoveInvItems',
    removeNpc: 'self',
    removeItem: 'ItMi_Gold',
    removeQuantity: '1',
  };

  test('Tab on the Function select (field 0) stays in the row', () => {
    const handleKeyDown = renderWithCardKeyDown(RemoveInventoryItemsActionRenderer, action);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Function' }), { key: 'Tab' });
    expect(handleKeyDown).not.toHaveBeenCalled();
  });

  test('Tab on Quantity (last field) delegates to card navigation', () => {
    const handleKeyDown = renderWithCardKeyDown(RemoveInventoryItemsActionRenderer, action);
    fireEvent.keyDown(screen.getByLabelText('Quantity'), { key: 'Tab' });
    expect(handleKeyDown).toHaveBeenCalled();
  });

  test('Shift+Tab on the Function select (field 0) delegates to card navigation', () => {
    const handleKeyDown = renderWithCardKeyDown(RemoveInventoryItemsActionRenderer, action);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Function' }), {
      key: 'Tab',
      shiftKey: true,
    });
    expect(handleKeyDown).toHaveBeenCalled();
  });

  test('Shift+Tab on NPC (field 1) stays in the row', () => {
    const handleKeyDown = renderWithCardKeyDown(RemoveInventoryItemsActionRenderer, action);
    fireEvent.keyDown(screen.getByLabelText('NPC'), { key: 'Tab', shiftKey: true });
    expect(handleKeyDown).not.toHaveBeenCalled();
  });
});

describe('PickpocketActionRenderer row Tab navigation (dynamic field count)', () => {
  test('B_Beklauen mode: the single Mode field delegates Tab and Shift+Tab', () => {
    const handleKeyDown = renderWithCardKeyDown(PickpocketActionRenderer, {
      type: 'Pickpocket',
      pickpocketMode: 'B_Beklauen',
    });
    const mode = screen.getByRole('combobox', { name: 'Mode' });
    fireEvent.keyDown(mode, { key: 'Tab' });
    fireEvent.keyDown(mode, { key: 'Tab', shiftKey: true });
    expect(handleKeyDown).toHaveBeenCalledTimes(2);
  });

  test('C_Beklauen mode: Tab on Mode stays in the row', () => {
    const handleKeyDown = renderWithCardKeyDown(PickpocketActionRenderer, {
      type: 'Pickpocket',
      pickpocketMode: 'C_Beklauen',
      minChance: '10',
      maxChance: '90',
    });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Mode' }), { key: 'Tab' });
    expect(handleKeyDown).not.toHaveBeenCalled();
  });

  test('C_Beklauen mode: Tab on Max (last field) delegates, Shift+Tab on Min stays in the row', () => {
    const handleKeyDown = renderWithCardKeyDown(PickpocketActionRenderer, {
      type: 'Pickpocket',
      pickpocketMode: 'C_Beklauen',
      minChance: '10',
      maxChance: '90',
    });
    fireEvent.keyDown(screen.getByLabelText('Min'), { key: 'Tab', shiftKey: true });
    expect(handleKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Max'), { key: 'Tab' });
    expect(handleKeyDown).toHaveBeenCalledTimes(1);
  });

  test('C_Beklauen mode: Shift+Tab on Mode delegates to card navigation', () => {
    const handleKeyDown = renderWithCardKeyDown(PickpocketActionRenderer, {
      type: 'Pickpocket',
      pickpocketMode: 'C_Beklauen',
    });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Mode' }), {
      key: 'Tab',
      shiftKey: true,
    });
    expect(handleKeyDown).toHaveBeenCalled();
  });
});
