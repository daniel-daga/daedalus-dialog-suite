/**
 * Regression test for issue #145: the debounced text-sync timer in ActionCard
 * captured `path` lexically. When the card's path shifts while the 300ms
 * debounce is pending (an action inserted above it, e.g. CreateTopic's
 * auto-append, undo, or drag reorder), the late timer wrote the typed text to
 * the OLD path — overwriting a different action ("randomly deletes text").
 * The timer must resolve the path via ref at fire time, like the unmount
 * cleanup already does.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ActionCard from '../src/renderer/components/ActionCard';
import type { DialogAction } from '../src/renderer/types/global';
import type { ActionPath } from '../src/renderer/components/nestedActionUtils';

describe('ActionCard debounced update path staleness', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function renderCard(path: ActionPath, action: DialogAction, updateActionAtPath: jest.Mock) {
    const noop = jest.fn();
    const props = {
      action,
      path,
      index: path[path.length - 1] as number,
      totalActions: 5,
      npcName: 'Arog',
      updateActionAtPath,
      deleteActionAtPath: noop,
      focusActionAtPath: noop,
      addDialogLineAfterPath: noop,
      deleteActionAndFocusPrevAtPath: noop,
      addActionAfterPath: noop,
      addActionToBranchEnd: noop,
      moveAction: noop,
      registerActionRef: jest.fn(),
      getVisibleActionPaths: () => [] as ActionPath[],
    };
    return { props, ...render(<ActionCard {...(props as never)} />) };
  }

  test('pending debounce writes to the CURRENT path after the card shifts', () => {
    const action: DialogAction = {
      type: 'DialogLine',
      speaker: 'other',
      text: '',
      id: 'DIA_Arog_Test_15_02',
    };
    const updateActionAtPath = jest.fn();
    const { props, rerender } = renderCard([2], action, updateActionAtPath);

    // Type while the card sits at path [2]; debounce starts.
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });

    // An action gets inserted above before the debounce fires: same action
    // object, new path [3].
    rerender(<ActionCard {...({ ...props, path: [3], index: 3 } as never)} />);

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(updateActionAtPath).toHaveBeenCalledTimes(1);
    const [calledPath, calledAction] = updateActionAtPath.mock.calls[0];
    expect(calledPath).toEqual([3]);
    expect(calledAction).toMatchObject({ text: 'Hello' });
  });

  test('pending debounce writes the latest typed text, not the keystroke snapshot', () => {
    const action: DialogAction = {
      type: 'DialogLine',
      speaker: 'other',
      text: '',
      id: 'DIA_Arog_Test_15_03',
    };
    const updateActionAtPath = jest.fn();
    renderCard([1], action, updateActionAtPath);

    const input = screen.getByLabelText('Text');
    fireEvent.change(input, { target: { value: 'Hel' } });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: 'Hello world' } });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(updateActionAtPath).toHaveBeenCalledTimes(1);
    expect(updateActionAtPath.mock.calls[0][1]).toMatchObject({ text: 'Hello world' });
  });
});
