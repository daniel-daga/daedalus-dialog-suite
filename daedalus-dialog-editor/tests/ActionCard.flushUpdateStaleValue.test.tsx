/**
 * Regression test for item 0.2: the stale-closure write in ActionCard.flushUpdate.
 *
 * The four select-type renderers (SetVariable, RemoveInventoryItems, Pickpocket,
 * StartOtherRoutine) call `handleUpdate(newValue)` then `flushUpdate()` in the
 * SAME tick. `flushUpdate` checked dirtiness via refs but wrote the
 * closure-captured `path`/`localAction` — still the PRE-change value at that
 * point (setLocalAction is async). So the store received the old value, and the
 * debounce timer flushUpdate cleared never committed the real one.
 * The fix writes via refs, mirroring the debounce timer body and unmount flush.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ActionCard from '../src/renderer/components/ActionCard';
import type { DialogAction } from '../src/renderer/types/global';
import type { ActionPath } from '../src/renderer/components/nestedActionUtils';

// Inject a renderer that replicates the select renderers' exact call pattern:
// handleUpdate(...) immediately followed by flushUpdate() in one event handler.
jest.mock('../src/renderer/components/actionRenderers', () => {
  const actual = jest.requireActual('../src/renderer/components/actionRenderers');
  return {
    ...actual,
    getRendererForAction: () =>
      function SelectStyleRenderer(props: {
        action: DialogAction & { operator?: string };
        handleUpdate: (a: DialogAction) => void;
        flushUpdate: () => void;
      }) {
        return (
          <button
            data-testid="select-change"
            onClick={() => {
              props.handleUpdate({ ...props.action, operator: '+=' });
              props.flushUpdate();
            }}
          >
            change op
          </button>
        );
      },
  };
});

describe('ActionCard.flushUpdate same-tick select commit (0.2)', () => {
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
      totalActions: 3,
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
    return render(<ActionCard {...(props as never)} />);
  }

  test('flushUpdate commits the new select value, not the stale closure value', () => {
    const action = {
      type: 'SetVariableAction',
      variableName: 'X',
      operator: '=',
      value: 1,
      id: 'action_x',
    } as unknown as DialogAction;
    const updateActionAtPath = jest.fn();
    renderCard([0], action, updateActionAtPath);

    fireEvent.click(screen.getByTestId('select-change'));

    expect(updateActionAtPath).toHaveBeenCalledTimes(1);
    expect(updateActionAtPath).toHaveBeenCalledWith([0], expect.objectContaining({ operator: '+=' }));

    // flushUpdate cleared the debounce timer — advancing time must not
    // double-write or resurrect the pre-change value.
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(updateActionAtPath).toHaveBeenCalledTimes(1);
  });
});
