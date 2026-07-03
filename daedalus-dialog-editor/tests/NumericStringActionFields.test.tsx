import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CreateInventoryItemsRenderer from '../src/renderer/components/actionRenderers/CreateInventoryItemsRenderer';
import GiveInventoryItemsRenderer from '../src/renderer/components/actionRenderers/GiveInventoryItemsRenderer';
import AttackActionRenderer from '../src/renderer/components/actionRenderers/AttackActionRenderer';
import SetRefuseTalkActionRenderer from '../src/renderer/components/actionRenderers/SetRefuseTalkActionRenderer';
import ChapterTransitionRenderer from '../src/renderer/components/actionRenderers/ChapterTransitionRenderer';
import RemoveInventoryItemsActionRenderer from '../src/renderer/components/actionRenderers/RemoveInventoryItemsActionRenderer';

// Mock VariableAutocomplete to a plain input so the numeric-field tests below
// don't depend on its autocomplete behavior (same pattern as
// SetVariableActionRenderer.test.tsx).
jest.mock('../src/renderer/components/common/VariableAutocomplete', () => {
  return function MockVariableAutocomplete(props: any) {
    return (
      <div data-testid={`autocomplete-${props.label}`}>
        <label>{props.label}</label>
        <input value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      </div>
    );
  };
});

const baseProps = {
  index: 0,
  totalActions: 1,
  npcName: 'TestNPC',
  handleDelete: jest.fn(),
  flushUpdate: jest.fn(),
  handleKeyDown: jest.fn(),
  mainFieldRef: { current: null },
  semanticModel: {} as any
};

describe('Numeric-or-string action field fidelity (parser fix: quantity/damage/seconds/chapter are number | string)', () => {
  describe('CreateInventoryItemsRenderer', () => {
    const action = { type: 'CreateInventoryItems' as const, target: 'hero', item: 'ItMi_Gold', quantity: 'Gold_Amount' };

    test('displays a string quantity without corrupting it', () => {
      render(<CreateInventoryItemsRenderer {...baseProps} action={action} handleUpdate={jest.fn()} />);
      expect(screen.getByLabelText('Quantity')).toHaveValue('Gold_Amount');
    });

    test('displays a literal quantity of 0 as "0", not blank', () => {
      const zeroAction = { ...action, quantity: 0 };
      render(<CreateInventoryItemsRenderer {...baseProps} action={zeroAction} handleUpdate={jest.fn()} />);
      expect(screen.getByLabelText('Quantity')).toHaveValue('0');
    });

    test('round-trips a typed string quantity to the raw identifier (not corrupted to a number)', () => {
      const handleUpdate = jest.fn();
      const emptyAction = { ...action, quantity: '' as unknown as number };
      render(<CreateInventoryItemsRenderer {...baseProps} action={emptyAction} handleUpdate={handleUpdate} />);
      fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: 'Gold_Amount' } });
      expect(handleUpdate).toHaveBeenCalledWith({ ...emptyAction, quantity: 'Gold_Amount' });
    });

    test('keeps a literal 0 as the number 0, not falsy-default 1', () => {
      const handleUpdate = jest.fn();
      const startingAction = { ...action, quantity: '' as unknown as number };
      render(<CreateInventoryItemsRenderer {...baseProps} action={startingAction} handleUpdate={handleUpdate} />);

      fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '0' } });
      expect(handleUpdate).toHaveBeenCalledWith({ ...startingAction, quantity: 0 });
    });
  });

  describe('GiveInventoryItemsRenderer', () => {
    const action = {
      type: 'GiveInventoryItems' as const,
      giver: 'self',
      receiver: 'hero',
      item: 'ItMi_Gold',
      quantity: 'Gold_Amount'
    };

    test('displays a string quantity without corrupting it', () => {
      render(<GiveInventoryItemsRenderer {...baseProps} action={action} handleUpdate={jest.fn()} />);
      expect(screen.getByLabelText('Quantity')).toHaveValue('Gold_Amount');
    });

    test('round-trips a typed string quantity to the raw identifier', () => {
      const handleUpdate = jest.fn();
      const emptyAction = { ...action, quantity: '' as unknown as number };
      render(<GiveInventoryItemsRenderer {...baseProps} action={emptyAction} handleUpdate={handleUpdate} />);
      fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: 'Gold_Amount' } });
      expect(handleUpdate).toHaveBeenCalledWith({ ...emptyAction, quantity: 'Gold_Amount' });
    });

    test('parses a typed integer literal back to a number', () => {
      const handleUpdate = jest.fn();
      const emptyAction = { ...action, quantity: '' as unknown as number };
      render(<GiveInventoryItemsRenderer {...baseProps} action={emptyAction} handleUpdate={handleUpdate} />);
      fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } });
      expect(handleUpdate).toHaveBeenCalledWith({ ...emptyAction, quantity: 5 });
    });
  });

  describe('AttackActionRenderer', () => {
    const action = { type: 'AttackAction' as const, attacker: 'self', target: 'other', attackReason: 'AR_NONE', damage: 'Damage_Var' };

    test('displays a string damage value without corrupting it', () => {
      render(<AttackActionRenderer {...baseProps} action={action} handleUpdate={jest.fn()} />);
      expect(screen.getByLabelText('Damage')).toHaveValue('Damage_Var');
    });

    test('round-trips a typed string damage value to the raw identifier', () => {
      const handleUpdate = jest.fn();
      const emptyAction = { ...action, damage: '' as unknown as number };
      render(<AttackActionRenderer {...baseProps} action={emptyAction} handleUpdate={handleUpdate} />);
      fireEvent.change(screen.getByLabelText('Damage'), { target: { value: 'Damage_Var' } });
      expect(handleUpdate).toHaveBeenCalledWith({ ...emptyAction, damage: 'Damage_Var' });
    });
  });

  describe('SetRefuseTalkActionRenderer', () => {
    const action = { type: 'SetRefuseTalkAction' as const, target: 'self', seconds: 'RefuseSeconds' };

    test('displays a string seconds value without corrupting it', () => {
      render(<SetRefuseTalkActionRenderer {...baseProps} action={action} handleUpdate={jest.fn()} />);
      expect(screen.getByLabelText('Seconds')).toHaveValue('RefuseSeconds');
    });

    test('round-trips a typed string seconds value to the raw identifier', () => {
      const handleUpdate = jest.fn();
      const emptyAction = { ...action, seconds: '' as unknown as number };
      render(<SetRefuseTalkActionRenderer {...baseProps} action={emptyAction} handleUpdate={handleUpdate} />);
      fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: 'RefuseSeconds' } });
      expect(handleUpdate).toHaveBeenCalledWith({ ...emptyAction, seconds: 'RefuseSeconds' });
    });

    test('displays a literal seconds of 0 as "0", not blank', () => {
      const zeroAction = { ...action, seconds: 0 };
      render(<SetRefuseTalkActionRenderer {...baseProps} action={zeroAction} handleUpdate={jest.fn()} />);
      expect(screen.getByLabelText('Seconds')).toHaveValue('0');
    });

    test('keeps a literal 0 as the number 0 when re-typed', () => {
      const handleUpdate = jest.fn();
      const emptyAction = { ...action, seconds: '' as unknown as number };
      render(<SetRefuseTalkActionRenderer {...baseProps} action={emptyAction} handleUpdate={handleUpdate} />);
      fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '0' } });
      expect(handleUpdate).toHaveBeenCalledWith({ ...emptyAction, seconds: 0 });
    });
  });

  describe('ChapterTransitionRenderer', () => {
    const action = { type: 'ChapterTransitionAction' as const, chapter: 'KAPITEL_NR', world: 'NEWWORLD_ZEN' };

    test('displays a string chapter value without corrupting it', () => {
      render(<ChapterTransitionRenderer {...baseProps} action={action} handleUpdate={jest.fn()} />);
      expect(screen.getByLabelText('Chapter')).toHaveValue('KAPITEL_NR');
    });

    test('round-trips a typed string chapter value to the raw identifier', () => {
      const handleUpdate = jest.fn();
      const emptyAction = { ...action, chapter: '' as unknown as number };
      render(<ChapterTransitionRenderer {...baseProps} action={emptyAction} handleUpdate={handleUpdate} />);
      fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: 'KAPITEL_NR' } });
      expect(handleUpdate).toHaveBeenCalledWith({ ...emptyAction, chapter: 'KAPITEL_NR' });
    });
  });

  describe('RemoveInventoryItemsActionRenderer', () => {
    test('renders without crashing when removeQuantity is absent (2-arg Npc_RemoveInvItem form)', () => {
      const action = {
        type: 'RemoveInventoryItemsAction' as const,
        removeFunctionName: 'Npc_RemoveInvItem' as const,
        removeNpc: 'self',
        removeItem: 'ItMi_Gold'
      };
      render(<RemoveInventoryItemsActionRenderer {...baseProps} action={action} handleUpdate={jest.fn()} />);
      expect(screen.getByLabelText('Quantity')).toHaveValue('');
    });
  });
});
