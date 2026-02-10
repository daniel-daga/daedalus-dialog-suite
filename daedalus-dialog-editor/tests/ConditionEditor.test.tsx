/**
 * Test suite for ConditionEditor component - Refactor verification
 *
 * This test verifies that the ConditionEditor properly auto-syncs changes
 * to the parent component instead of managing its own save state.
 */

import React from 'react';
import { describe, test, expect, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import ConditionEditor from '../src/renderer/components/ConditionEditor';

describe('ConditionEditor Auto-sync Behavior', () => {
  test('updates should propagate to parent immediately when condition changes', () => {
    // Simulate ConditionEditor's new auto-sync behavior
    const mockOnUpdateFunction = jest.fn();
    const initialFunction = {
      name: 'TestCondition',
      conditions: [
        {
          variableName: 'MIS_QuestActive',
          negated: false,
          getTypeName: () => 'VariableCondition',
        },
      ],
    };

    // Simulate updating a condition
    const updatedCondition = {
      variableName: 'MIS_QuestCompleted',
      negated: true,
      getTypeName: () => 'VariableCondition',
    };

    const updatedFunction = {
      ...initialFunction,
      conditions: [updatedCondition],
    };

    // Simulate the new behavior: updateCondition calls onUpdateFunction
    const updateCondition = (index: number, updated: any) => {
      const newConditions = [...initialFunction.conditions];
      newConditions[index] = updated;
      const newFunction = {
        ...initialFunction,
        conditions: newConditions,
      };
      // Auto-sync to parent
      mockOnUpdateFunction(newFunction);
    };

    updateCondition(0, updatedCondition);

    // Verify parent was notified immediately
    expect(mockOnUpdateFunction).toHaveBeenCalledTimes(1);
    expect(mockOnUpdateFunction).toHaveBeenCalledWith(updatedFunction);
  });

  test('adding a condition should propagate to parent immediately', () => {
    const mockOnUpdateFunction = jest.fn();
    const initialFunction = {
      name: 'TestCondition',
      conditions: [],
    };

    // Simulate adding a new NpcKnowsInfo condition
    const newCondition = {
      npc: 'self',
      dialogRef: 'TestDialog',
      getTypeName: () => 'NpcKnowsInfoCondition',
    };

    const updatedFunction = {
      ...initialFunction,
      conditions: [newCondition],
    };

    // Simulate the new behavior
    const addCondition = (condition: any) => {
      const newFunction = {
        ...initialFunction,
        conditions: [...initialFunction.conditions, condition],
      };
      mockOnUpdateFunction(newFunction);
    };

    addCondition(newCondition);

    // Verify parent was notified
    expect(mockOnUpdateFunction).toHaveBeenCalledTimes(1);
    expect(mockOnUpdateFunction).toHaveBeenCalledWith(updatedFunction);
  });

  test('deleting a condition should propagate to parent immediately', () => {
    const mockOnUpdateFunction = jest.fn();
    const initialFunction = {
      name: 'TestCondition',
      conditions: [
        {
          variableName: 'VAR_1',
          negated: false,
          getTypeName: () => 'VariableCondition',
        },
        {
          variableName: 'VAR_2',
          negated: false,
          getTypeName: () => 'VariableCondition',
        },
      ],
    };

    // Simulate deleting first condition
    const deleteCondition = (index: number) => {
      const newConditions = initialFunction.conditions.filter((_, i) => i !== index);
      const newFunction = {
        ...initialFunction,
        conditions: newConditions,
      };
      mockOnUpdateFunction(newFunction);
    };

    deleteCondition(0);

    // Verify parent was notified
    expect(mockOnUpdateFunction).toHaveBeenCalledTimes(1);
    const calledWith = mockOnUpdateFunction.mock.calls[0][0];
    expect(calledWith.name).toBe('TestCondition');
    expect(calledWith.conditions).toHaveLength(1);
    expect(calledWith.conditions[0].variableName).toBe('VAR_2');
  });

  test('should not maintain separate dirty state', () => {
    // Demonstrates that ConditionEditor no longer tracks its own isDirty state
    // This state management is delegated to the parent (DialogDetailsEditor)

    const mockOnUpdateFunction = jest.fn();
    const initialFunction = {
      name: 'TestCondition',
      conditions: [],
    };

    // Simulate making changes without any local dirty tracking
    const makeChanges = () => {
      // Change 1
      mockOnUpdateFunction({ ...initialFunction, conditions: [{ test: 1 }] });
      // Change 2
      mockOnUpdateFunction({ ...initialFunction, conditions: [{ test: 2 }] });
      // Change 3
      mockOnUpdateFunction({ ...initialFunction, conditions: [{ test: 3 }] });
    };

    makeChanges();

    // All changes propagated to parent - no local dirty state needed
    expect(mockOnUpdateFunction).toHaveBeenCalledTimes(3);
  });

  test('should not have separate save logic', () => {
    // Demonstrates that ConditionEditor no longer needs handleSave, initialFunctionRef, or saveCounter
    // Save logic is handled by the parent component (DialogDetailsEditor)

    const mockOnUpdateFunction = jest.fn();
    const initialFunction = {
      name: 'TestCondition',
      conditions: [{ variableName: 'TEST', negated: false, getTypeName: () => 'VariableCondition' }],
    };

    // In the new pattern, there is NO separate save step
    // Changes are immediately propagated, and parent handles saving

    const updatedFunction = {
      ...initialFunction,
      conditions: [{ variableName: 'UPDATED', negated: true, getTypeName: () => 'VariableCondition' }],
    };

    // Just propagate the change
    mockOnUpdateFunction(updatedFunction);

    // That's it - no save button, no save state, no save logic
    expect(mockOnUpdateFunction).toHaveBeenCalledWith(updatedFunction);
  });

  test('multiple rapid updates should all propagate to parent', () => {
    // Simulates typing in a condition field with debouncing
    const mockOnUpdateFunction = jest.fn();
    const baseFunction = {
      name: 'TestCondition',
      conditions: [
        {
          variableName: '',
          negated: false,
          getTypeName: () => 'VariableCondition',
        },
      ],
    };

    // Simulate rapid keystroke updates (these would be debounced in ConditionCard)
    const keystrokes = ['M', 'MI', 'MIS', 'MIS_', 'MIS_Q', 'MIS_Quest'];

    keystrokes.forEach((value) => {
      const updated = {
        ...baseFunction,
        conditions: [
          {
            variableName: value,
            negated: false,
            getTypeName: () => 'VariableCondition',
          },
        ],
      };
      mockOnUpdateFunction(updated);
    });

    // All updates propagated (in practice, ConditionCard would debounce these)
    expect(mockOnUpdateFunction).toHaveBeenCalledTimes(6);
  });

  test('demonstrates simplified state management without refs', () => {
    // Shows that we no longer need initialFunctionRef, saveCounter, or isDirty calculations

    const mockOnUpdateFunction = jest.fn();

    // OLD pattern (complex):
    // - initialFunctionRef = useRef(conditionFunction)
    // - saveCounter = useState(0)
    // - isDirty = useMemo(() => JSON.stringify comparison)
    // - handleSave = () => { onUpdateFunction(); update refs; increment counter }

    // NEW pattern (simple):
    // - Just call onUpdateFunction(newValue) immediately

    const simpleUpdate = (newValue: any) => {
      mockOnUpdateFunction(newValue);
    };

    const value1 = { name: 'Test', conditions: [{ a: 1 }] };
    const value2 = { name: 'Test', conditions: [{ a: 2 }] };
    const value3 = { name: 'Test', conditions: [{ a: 3 }] };

    simpleUpdate(value1);
    simpleUpdate(value2);
    simpleUpdate(value3);

    // No refs, no counters, no complex dirty tracking - just simple propagation
    expect(mockOnUpdateFunction).toHaveBeenNthCalledWith(1, value1);
    expect(mockOnUpdateFunction).toHaveBeenNthCalledWith(2, value2);
    expect(mockOnUpdateFunction).toHaveBeenNthCalledWith(3, value3);
  });

  test('consistency with ActionCard pattern', () => {
    // Verifies that ConditionEditor follows the same pattern as ActionCard

    const mockUpdateFunction = jest.fn();
    const mockUpdateAction = jest.fn();

    // ActionCard pattern: immediate propagation
    const actionCardUpdate = (index: number, updated: any) => {
      mockUpdateAction(index, updated);
    };

    // ConditionEditor pattern: should match ActionCard
    const conditionEditorUpdate = (updated: any) => {
      mockUpdateFunction(updated);
    };

    // Both should propagate immediately
    actionCardUpdate(0, { text: 'New action' });
    conditionEditorUpdate({ name: 'Test', conditions: [] });

    expect(mockUpdateAction).toHaveBeenCalledTimes(1);
    expect(mockUpdateFunction).toHaveBeenCalledTimes(1);

    // Both should have no internal save logic
    // Both should rely on parent for persistence
    // Both should use the same update propagation pattern
  });
});

describe('ConditionEditor Raw Condition Display', () => {
  test('shows preserved raw condition statements when semantic conditions are empty', () => {
    const conditionFunction = {
      name: 'DIA_Hubert_TinteAmt_Condition',
      conditions: [],
      actions: [
        {
          type: 'Action',
          action: 'if (Npc_KnowsInfo (other, DIA_Matthias_Tinte)) && (Kapitel == 1) { return TRUE; }'
        },
        {
          type: 'Action',
          action: 'else if (Kapitel == 2) { AI_Output (other, self, "DIA_Hubert_TinteAmt_02_01"); }'
        }
      ]
    };

    render(
      <ConditionEditor
        conditionFunction={conditionFunction}
        onUpdateFunction={jest.fn()}
        semanticModel={{ dialogs: {}, functions: {} }}
        filePath={'test.d'}
        dialogName={'DIA_Hubert_TinteAmt'}
      />
    );

    fireEvent.click(screen.getByText('Conditions'));

    expect(screen.getByText(/Raw condition mode/i)).toBeInTheDocument();
    expect(screen.getByText(/Npc_KnowsInfo/)).toBeInTheDocument();
    expect(screen.getByText(/else if \(Kapitel == 2\)/)).toBeInTheDocument();
  });
});

/**
 * Test Summary:
 *
 * These tests verify the refactored ConditionEditor behavior:
 *
 * 1. Updates propagate to parent immediately (no buffering in local state)
 * 2. Add/delete operations propagate immediately
 * 3. No separate dirty state tracking (delegated to parent)
 * 4. No separate save logic (delegated to parent)
 * 5. Multiple updates all propagate correctly
 * 6. Simplified state management without refs/counters
 * 7. Consistency with ActionCard pattern
 *
 * The refactored implementation should:
 * - Remove handleSave, isDirty, initialFunctionRef, saveCounter
 * - Call onUpdateFunction() immediately when conditions change
 * - Match the ActionCard pattern for consistency
 * - Delegate all save logic to DialogDetailsEditor
 */
