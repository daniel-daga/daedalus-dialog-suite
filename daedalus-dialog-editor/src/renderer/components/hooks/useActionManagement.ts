import { useCallback } from 'react';
import { generateUniqueChoiceFunctionName, createEmptyFunction } from '../dialogUtils';
import { createAction, createActionAfterIndex, generateActionId } from '../actionFactory';
import type { ActionTypeId } from '../actionTypes';
import type { DialogAction, DialogFunction, DialogLineAction, SemanticModel } from '../../types/global';
import type { FunctionUpdater } from '../dialogTypes';

/**
 * Configuration for action management
 */
export interface ActionManagementConfig {
  setFunction: (funcOrUpdater: FunctionUpdater) => void;
  /** Function to focus a specific action by index */
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  /** Semantic model for generating unique function names */
  semanticModel?: SemanticModel;
  /** Callback to update the semantic model with a new function */
  onUpdateSemanticModel?: (functionName: string, func: DialogFunction) => void;
  /** Context name for dialog/function (used for generating unique names) */
  contextName: string;
}

/**
 * Custom hook for managing dialog actions (add, update, delete operations)
 */
export function useActionManagement(config: ActionManagementConfig) {
  const {
    setFunction,
    focusAction,
    semanticModel,
    onUpdateSemanticModel,
    contextName
  } = config;

  /**
   * Update an action at a specific index
   */
  const updateAction = useCallback((index: number, updatedAction: DialogAction) => {
    setFunction((prev) => {
      if (!prev) return prev;
      const newActions = [...(prev.actions || [])];
      newActions[index] = updatedAction;
      return { ...prev, actions: newActions };
    });
  }, [setFunction]);

  /**
   * Delete an action at a specific index
   */
  const deleteAction = useCallback((index: number) => {
    setFunction((prev) => {
      if (!prev) return prev;
      const newActions = (prev.actions || []).filter((_, i) => i !== index);
      return { ...prev, actions: newActions };
    });
  }, [setFunction]);

  /**
   * Delete an action and focus the previous one
   */
  const deleteActionAndFocusPrev = useCallback((index: number) => {
    setFunction((prev) => {
      if (!prev) return prev;
      const newActions = (prev.actions || []).filter((_, i) => i !== index);
      return { ...prev, actions: newActions };
    });

    // Focus the previous action after state update
    const prevIdx = index - 1;
    if (prevIdx >= 0) {
      setTimeout(() => focusAction(prevIdx), 0);
    }
  }, [setFunction, focusAction]);

  /**
   * Add a dialog line after a specific index
   * By default toggles the speaker (self/other), unless toggleSpeaker is false
   */
  const addDialogLineAfter = useCallback((index: number, toggleSpeaker: boolean = true) => {
    setFunction((prev) => {
      if (!prev) return prev;
      const actions = prev.actions || [];

      const currentAction = actions[index];
      const newSpeaker = toggleSpeaker
        ? (currentAction?.type === 'DialogLine' && currentAction.speaker === 'self' ? 'other' : 'self')
        : (currentAction?.type === 'DialogLine' ? currentAction.speaker : 'self');
      const newAction: DialogLineAction = {
        type: 'DialogLine',
        speaker: newSpeaker,
        text: '',
        id: generateActionId()
      };

      const newActions = [...actions];
      newActions.splice(index + 1, 0, newAction);
      return { ...prev, actions: newActions };
    });

    // Focus the new action after state update with smooth scroll
    setTimeout(() => focusAction(index + 1, true), 0);
  }, [setFunction, focusAction]);

  /**
   * Add an action after a specific index
   * Handles choice creation with automatic target function generation
   */
  const addActionAfter = useCallback((index: number, actionType: ActionTypeId) => {
    // Handle choice creation specially to generate target function
    if (actionType === 'choice' && semanticModel) {
      const newFunctionName = generateUniqueChoiceFunctionName(contextName, semanticModel);
      const newFunction = createEmptyFunction(newFunctionName);

      // Add the new function to semantic model
      if (onUpdateSemanticModel) {
        onUpdateSemanticModel(newFunctionName, newFunction);
      }

      // Now add the choice action using factory
      setFunction((prev) => {
        if (!prev) return prev;

        const newAction = createAction('choice', { dialogName: contextName }) as DialogAction;
        if ('targetFunction' in newAction) {
          newAction.targetFunction = newFunctionName;
        }

        const newActions = [...(prev.actions || [])];
        newActions.splice(index + 1, 0, newAction);
        return { ...prev, actions: newActions };
      });

      setTimeout(() => focusAction(index + 1, true), 0);
      return;
    }

    // Use factory for all other action types
    setFunction((prev) => {
      if (!prev) return prev;
      const actions = prev.actions || [];

      const newAction = createActionAfterIndex(
        actionType,
        index,
        actions,
        contextName
      ) as DialogAction;

      const newActions = [...actions];
      newActions.splice(index + 1, 0, newAction);
      return { ...prev, actions: newActions };
    });

    // Focus the new action after state update with smooth scroll
    setTimeout(() => focusAction(index + 1, true), 0);
  }, [setFunction, focusAction, semanticModel, onUpdateSemanticModel, contextName]);

  return {
    updateAction,
    deleteAction,
    deleteActionAndFocusPrev,
    addDialogLineAfter,
    addActionAfter
  };
}
