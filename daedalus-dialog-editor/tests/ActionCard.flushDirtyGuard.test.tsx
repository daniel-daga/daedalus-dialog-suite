/**
 * Slice 1 of docs/plans/frontend-interaction-latency.md: flushUpdate,
 * the debounce timer body, and the pending-edit flush registry flusher must
 * all skip the store write when the local action has not actually diverged
 * from the last parent-synced action (shallowEqual(localActionRef.current,
 * actionRef.current)) — the same guard the unmount cleanup already applies.
 *
 * Before the fix, Ctrl+Enter/Tab/Enter unconditionally called
 * updateActionAtPath even when nothing had changed, costing a store write
 * (and the whole downstream cascade) on every navigation keystroke.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionCard from '../src/renderer/components/ActionCard';
import { flushAllPendingEdits } from '../src/renderer/utils/pendingEditFlushRegistry';
import type { DialogAction } from '../src/renderer/types/global';
import type { ActionPath } from '../src/renderer/components/nestedActionUtils';

describe('ActionCard flushUpdate dirty guard (Slice 1)', () => {
  function renderCard(overrides: Partial<Record<string, unknown>> = {}) {
    const action: DialogAction = {
      type: 'DialogLine',
      speaker: 'other',
      text: 'Hello',
      id: 'DIA_Arog_Test_15_00',
    };
    const path: ActionPath = [0];
    const updateActionAtPath = jest.fn();
    const focusActionAtPath = jest.fn();
    const addDialogLineAfterPath = jest.fn();
    const getVisibleActionPaths = () => [[0], [1]] as ActionPath[];

    const props = {
      action,
      path,
      index: 0,
      totalActions: 2,
      npcName: 'Arog',
      updateActionAtPath,
      deleteActionAtPath: jest.fn(),
      focusActionAtPath,
      addDialogLineAfterPath,
      deleteActionAndFocusPrevAtPath: jest.fn(),
      addActionAfterPath: jest.fn(),
      addActionToBranchEnd: jest.fn(),
      moveAction: jest.fn(),
      registerActionRef: jest.fn(),
      getVisibleActionPaths,
      ...overrides,
    };

    const view = render(<ActionCard {...(props as never)} />);
    return { ...view, props, updateActionAtPath, focusActionAtPath, addDialogLineAfterPath };
  }

  test('Ctrl+Enter with no local edit does not call updateActionAtPath, but still opens the action menu', () => {
    const { updateActionAtPath } = renderCard();

    const input = screen.getByLabelText('Text');
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    expect(updateActionAtPath).not.toHaveBeenCalled();
    // Menu opened: the action-type search popover is present.
    expect(screen.getByPlaceholderText('Search actions...')).toBeInTheDocument();
  });

  test('Tab with no local edit does not call updateActionAtPath, but still moves focus', () => {
    const { updateActionAtPath, focusActionAtPath } = renderCard();

    const input = screen.getByLabelText('Text');
    fireEvent.keyDown(input, { key: 'Tab' });

    expect(updateActionAtPath).not.toHaveBeenCalled();
    expect(focusActionAtPath).toHaveBeenCalledTimes(1);
    expect(focusActionAtPath).toHaveBeenCalledWith([1]);
  });

  test('Ctrl+Enter after typing calls updateActionAtPath exactly once with the typed value', () => {
    const { updateActionAtPath } = renderCard();

    const input = screen.getByLabelText('Text');
    fireEvent.change(input, { target: { value: 'Hello world' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    expect(updateActionAtPath).toHaveBeenCalledTimes(1);
    expect(updateActionAtPath).toHaveBeenCalledWith([0], expect.objectContaining({ text: 'Hello world' }));
  });

  test('Enter with typed text flushes the write and adds a new line (unchanged behavior)', () => {
    const { updateActionAtPath, addDialogLineAfterPath } = renderCard();

    const input = screen.getByLabelText('Text');
    fireEvent.change(input, { target: { value: 'Hello world' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(updateActionAtPath).toHaveBeenCalledTimes(1);
    expect(updateActionAtPath).toHaveBeenCalledWith([0], expect.objectContaining({ text: 'Hello world' }));
    expect(addDialogLineAfterPath).toHaveBeenCalledTimes(1);
    expect(addDialogLineAfterPath).toHaveBeenCalledWith([0], true);
  });

  test('debounce timer fires but does not call updateActionAtPath when the pending edit reverted to the synced value', () => {
    jest.useFakeTimers();
    try {
      const { updateActionAtPath } = renderCard();

      const input = screen.getByLabelText('Text');
      // Diverge, then revert to the original text before the timer fires (e.g.
      // typed a character then backspaced it). Each change differs from the
      // previous DOM value, so onChange genuinely fires both times and a fresh
      // timer is (re)armed by the second change. At fire time
      // localActionRef.current is shallowEqual to actionRef.current again.
      fireEvent.change(input, { target: { value: 'Hello!' } });
      fireEvent.change(input, { target: { value: 'Hello' } });

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(updateActionAtPath).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('debounce timer still fires the write when the edit actually changed the text', () => {
    jest.useFakeTimers();
    try {
      const { updateActionAtPath } = renderCard();

      const input = screen.getByLabelText('Text');
      fireEvent.change(input, { target: { value: 'Hello there' } });

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(updateActionAtPath).toHaveBeenCalledTimes(1);
      expect(updateActionAtPath).toHaveBeenCalledWith([0], expect.objectContaining({ text: 'Hello there' }));
    } finally {
      jest.useRealTimers();
    }
  });

  test('pending-edit flush registry no-ops when there is no local edit', () => {
    const { updateActionAtPath } = renderCard();

    act(() => {
      flushAllPendingEdits();
    });

    expect(updateActionAtPath).not.toHaveBeenCalled();
  });

  test('pending-edit flush registry no-ops when the pending edit reverted to the synced value', () => {
    jest.useFakeTimers();
    try {
      const { updateActionAtPath } = renderCard();

      const input = screen.getByLabelText('Text');
      // Timer is live (armed by the second change) but the pending value
      // matches actionRef.current again — the registry flusher must apply
      // the same dirty guard as the natural timer body.
      fireEvent.change(input, { target: { value: 'Hello!' } });
      fireEvent.change(input, { target: { value: 'Hello' } });

      act(() => {
        flushAllPendingEdits();
      });

      expect(updateActionAtPath).not.toHaveBeenCalled();

      // Confirm the timer was actually cleared by the flush (not just
      // coincidentally never armed): advancing past it changes nothing.
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(updateActionAtPath).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('pending-edit flush registry commits exactly once when an edit is pending', () => {
    jest.useFakeTimers();
    try {
      const { updateActionAtPath } = renderCard();

      const input = screen.getByLabelText('Text');
      fireEvent.change(input, { target: { value: 'Hello there' } });

      act(() => {
        flushAllPendingEdits();
      });

      expect(updateActionAtPath).toHaveBeenCalledTimes(1);
      expect(updateActionAtPath).toHaveBeenCalledWith([0], expect.objectContaining({ text: 'Hello there' }));

      // The timer was cleared by the flush; letting it "fire" must not double-write.
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(updateActionAtPath).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
