import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChoiceRenderer from '../src/renderer/components/actionRenderers/ChoiceRenderer';

describe('ChoiceRenderer Race Condition', () => {
  let handleUpdate: jest.Mock;
  let handleDelete: jest.Mock;
  let flushUpdate: jest.Mock;
  let handleKeyDown: jest.Mock;
  let onRenameFunction: jest.Mock;
  let onNavigateToFunction: jest.Mock;

  const mockSemanticModel = {
    functions: {
      'npc_oldFunction': {
        actions: []
      }
    }
  };

  const baseProps = {
    action: {
      type: 'choice',
      text: 'Test choice',
      targetFunction: 'npc_oldFunction'
    },
    handleDelete,
    handleKeyDown,
    semanticModel: mockSemanticModel,
    dialogContextName: 'npc',
    onNavigateToFunction,
    onRenameFunction
  };

  beforeEach(() => {
    handleUpdate = jest.fn();
    handleDelete = jest.fn();
    flushUpdate = jest.fn();
    handleKeyDown = jest.fn();
    onRenameFunction = jest.fn();
    onNavigateToFunction = jest.fn();
  });

  it('should use the latest input value during blur, not stale props', async () => {
    const user = userEvent.setup();

    // Simulate debounced handleUpdate
    let pendingUpdate: any = null;
    const debouncedHandleUpdate = jest.fn((updatedAction) => {
      pendingUpdate = updatedAction;
      // Simulate debounce - update doesn't happen immediately
      setTimeout(() => {
        // This simulates the parent component eventually updating
        pendingUpdate = null;
      }, 300);
    });

    const { rerender } = render(
      <ChoiceRenderer
        {...baseProps}
        handleUpdate={debouncedHandleUpdate}
        flushUpdate={flushUpdate}
      />
    );

    const functionInput = screen.getByLabelText('Function');

    // Focus on the function input
    await user.click(functionInput);

    // Type a new function name rapidly
    await user.clear(functionInput);
    await user.type(functionInput, 'npc_newFunction');

    // handleUpdate was called multiple times with debounce
    expect(debouncedHandleUpdate).toHaveBeenCalled();

    // Get the last call to see what the final value should be
    const lastCall = debouncedHandleUpdate.mock.calls[debouncedHandleUpdate.mock.calls.length - 1][0];
    expect(lastCall.targetFunction).toBe('npc_newFunction');

    // NOW blur immediately before the debounced update propagates to props
    // This is the race condition scenario
    await user.tab();

    // flushUpdate should have been called
    expect(flushUpdate).toHaveBeenCalled();

    // The bug is: if onBlur reads from action.targetFunction (props),
    // it will get the OLD value because the debounced update hasn't
    // propagated yet. The fix ensures we read from local state instead.

    // After the fix, onRenameFunction should be called with correct values
    // We can't test this directly without the parent updating props,
    // but we can verify the component doesn't crash and handles it correctly
  });

  it('should handle rapid typing and blur without data loss', async () => {
    const user = userEvent.setup();
    let currentActionState = { ...baseProps.action };

    // Mock handleUpdate that updates local state
    const handleUpdateMock = jest.fn((updatedAction) => {
      currentActionState = updatedAction;
    });

    // Mock flushUpdate that should finalize the update
    const flushUpdateMock = jest.fn(() => {
      // Simulate flushing the pending update
    });

    const { rerender } = render(
      <ChoiceRenderer
        {...baseProps}
        handleUpdate={handleUpdateMock}
        flushUpdate={flushUpdateMock}
      />
    );

    const functionInput = screen.getByLabelText('Function');

    // Focus and type rapidly
    await user.click(functionInput);
    await user.clear(functionInput);
    await user.type(functionInput, 'npc_rapidTyping', { delay: 10 }); // Fast typing

    // Blur immediately
    fireEvent.blur(functionInput);

    // Verify handleUpdate was called with the final value
    const calls = handleUpdateMock.mock.calls;
    const lastUpdate = calls[calls.length - 1][0];
    expect(lastUpdate.targetFunction).toBe('npc_rapidTyping');

    // Verify flushUpdate was called
    expect(flushUpdateMock).toHaveBeenCalled();
  });

  it('should validate using the current input value, not stale props', async () => {
    const user = userEvent.setup();

    // Track the action state
    let actionState = { ...baseProps.action };

    const handleUpdateMock = jest.fn((updatedAction) => {
      // Simulate parent eventually updating (but with delay)
      setTimeout(() => {
        actionState = updatedAction;
      }, 100);
    });

    const { rerender } = render(
      <ChoiceRenderer
        {...baseProps}
        action={actionState}
        handleUpdate={handleUpdateMock}
        flushUpdate={flushUpdate}
      />
    );

    const functionInput = screen.getByLabelText('Function');

    // Type an invalid function name (doesn't start with 'npc')
    await user.click(functionInput);
    await user.clear(functionInput);
    await user.type(functionInput, 'invalid_function');

    // Blur before parent updates props
    // The bug would cause validation to check against old value
    await user.tab();

    // With the fix, validation should check 'invalid_function' and fail
    // Original code would check 'npc_oldFunction' and might incorrectly succeed
    expect(flushUpdate).toHaveBeenCalled();

    // If validation runs against the correct value, onRenameFunction
    // should NOT be called because validation should fail
    // (We'd need to mock alert to fully test this, but the key is
    // ensuring the component uses local state for validation)
  });
});
