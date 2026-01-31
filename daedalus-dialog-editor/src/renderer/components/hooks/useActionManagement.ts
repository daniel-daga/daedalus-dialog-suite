import { useCallback } from 'react';
import { generateUniqueChoiceFunctionName, createEmptyFunction } from '../dialogUtils';
import { createAction, createActionAfterIndex, generateActionId } from '../actionFactory';
import type { ActionTypeId } from '../actionTypes';

/**
 * Configuration for action management
 */
export interface ActionManagementConfig {
  /** Function to update the function state */
  setFunction: React.Dispatch<React.SetStateAction<any>>;
  /** Function to focus a specific action by index */
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  /** Semantic model for generating unique function names */
  semanticModel?: any;
  /** Callback to update the semantic model with a new function */
  onUpdateSemanticModel?: (functionName: string, func: any) => void;
  /** Context name for dialog/function (used for generating unique names) */
  contextName: string;
  /** Optional function name key if managing multiple functions */
  functionNameKey?: string;
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
    contextName,
    functionNameKey
  } = config;

  /**
   * Update an action at a specific index
   */
  const updateAction = useCallback((index: number, updatedAction: any) => {
    setFunction((prev: any) => {
      if (!prev) return prev;

      // Handle multi-function case
      if (functionNameKey && typeof prev === 'object' && !Array.isArray(prev.actions)) {
        const func = prev[functionNameKey] || semanticModel?.functions?.[functionNameKey];
        if (!func) return prev;
        const newActions = [...(func.actions || [])];
        newActions[index] = updatedAction;
        return {
          ...prev,
          [functionNameKey]: { ...func, actions: newActions }
        };
      }

      // Handle single function case
      const newActions = [...(prev.actions || [])];
      newActions[index] = updatedAction;
      return { ...prev, actions: newActions };
    });
  }, [setFunction, functionNameKey, semanticModel]);

  /**
   * Delete an action at a specific index
   */
  const deleteAction = useCallback((index: number) => {
    setFunction((prev: any) => {
      if (!prev) return prev;

      // Handle multi-function case
      if (functionNameKey && typeof prev === 'object' && !Array.isArray(prev.actions)) {
        const func = prev[functionNameKey] || semanticModel?.functions?.[functionNameKey];
        if (!func) return prev;
        const newActions = (func.actions || []).filter((_: any, i: number) => i !== index);
        return {
          ...prev,
          [functionNameKey]: { ...func, actions: newActions }
        };
      }

      // Handle single function case
      const newActions = (prev.actions || []).filter((_: any, i: number) => i !== index);
      return { ...prev, actions: newActions };
    });
  }, [setFunction, functionNameKey, semanticModel]);

  /**
   * Delete an action and focus the previous one
   */
  const deleteActionAndFocusPrev = useCallback((index: number) => {
    setFunction((prev: any) => {
      if (!prev) return prev;

      // Handle multi-function case
      if (functionNameKey && typeof prev === 'object' && !Array.isArray(prev.actions)) {
        const func = prev[functionNameKey] || semanticModel?.functions?.[functionNameKey];
        if (!func) return prev;
        const newActions = (func.actions || []).filter((_: any, i: number) => i !== index);
        return {
          ...prev,
          [functionNameKey]: { ...func, actions: newActions }
        };
      }

      // Handle single function case
      const newActions = (prev.actions || []).filter((_: any, i: number) => i !== index);
      return { ...prev, actions: newActions };
    });

    // Focus the previous action after state update
    const prevIdx = index - 1;
    if (prevIdx >= 0) {
      setTimeout(() => focusAction(prevIdx), 0);
    }
  }, [setFunction, focusAction, functionNameKey, semanticModel]);

  /**
   * Add a dialog line after a specific index
   * By default toggles the speaker (self/other), unless toggleSpeaker is false
   */
  const addDialogLineAfter = useCallback((index: number, toggleSpeaker: boolean = true) => {
    setFunction((prev: any) => {
      if (!prev) return prev;

      // Determine current actions array
      let actions: any[];
      if (functionNameKey && typeof prev === 'object' && !Array.isArray(prev.actions)) {
        const func = prev[functionNameKey] || semanticModel?.functions?.[functionNameKey];
        if (!func) return prev;
        actions = func.actions || [];
      } else {
        actions = prev.actions || [];
      }

      const currentAction = actions[index];
      // Toggle speaker: if current is 'self', new is 'other', and vice versa
      // Unless toggleSpeaker is false, then keep the same speaker
      const newSpeaker = toggleSpeaker
        ? (currentAction?.speaker === 'self' ? 'other' : 'self')
        : (currentAction?.speaker || 'self');
      const newAction = {
        speaker: newSpeaker,
        text: '',
        id: generateActionId()
      };

      const newActions = [...actions];
      newActions.splice(index + 1, 0, newAction);

      // Handle multi-function case
      if (functionNameKey && typeof prev === 'object' && !Array.isArray(prev.actions)) {
        const func = prev[functionNameKey] || semanticModel?.functions?.[functionNameKey];
        return {
          ...prev,
          [functionNameKey]: { ...func, actions: newActions }
        };
      }

      // Handle single function case
      return { ...prev, actions: newActions };
    });

    // Focus the new action after state update with smooth scroll
    setTimeout(() => focusAction(index + 1, true), 0);
  }, [setFunction, focusAction, functionNameKey, semanticModel]);

  /**
   * Add an action after a specific index
   * Handles choice creation with automatic target function generation
   */
  const addActionAfter = useCallback((index: number, actionType: string) => {
    // Handle choice creation specially to generate target function
    if (actionType === 'choice' && semanticModel) {
      // Use contextName or functionNameKey as the base for nested choice function names
      const baseName = functionNameKey || contextName;
      const newFunctionName = generateUniqueChoiceFunctionName(baseName, semanticModel);
      const newFunction = createEmptyFunction(newFunctionName);

      // Add the new function to semantic model
      if (onUpdateSemanticModel) {
        onUpdateSemanticModel(newFunctionName, newFunction);
      }

      // Now add the choice action using factory
      setFunction((prev: any) => {
        if (!prev) return prev;

        const newAction = createAction('choice', { dialogName: baseName });
        newAction.targetFunction = newFunctionName;

        // Handle multi-function case
        if (functionNameKey && typeof prev === 'object' && !Array.isArray(prev.actions)) {
          const func = prev[functionNameKey] || semanticModel?.functions?.[functionNameKey];
          if (!func) return prev;
          const newActions = [...(func.actions || [])];
          newActions.splice(index + 1, 0, newAction);
          return {
            ...prev,
            [functionNameKey]: { ...func, actions: newActions }
          };
        }

        // Handle single function case
        const newActions = [...(prev.actions || [])];
        newActions.splice(index + 1, 0, newAction);
        return { ...prev, actions: newActions };
      });

      setTimeout(() => focusAction(index + 1, true), 0);
      return;
    }

    // Use factory for all other action types
    setFunction((prev: any) => {
      if (!prev) return prev;

      // Determine current actions array
      let actions: any[];
      if (functionNameKey && typeof prev === 'object' && !Array.isArray(prev.actions)) {
        const func = prev[functionNameKey] || semanticModel?.functions?.[functionNameKey];
        if (!func) return prev;
        actions = func.actions || [];
      } else {
        actions = prev.actions || [];
      }

      const newAction = createActionAfterIndex(
        actionType as ActionTypeId,
        index,
        actions,
        contextName
      );

      const newActions = [...actions];
      newActions.splice(index + 1, 0, newAction);

      // Handle multi-function case
      if (functionNameKey && typeof prev === 'object' && !Array.isArray(prev.actions)) {
        const func = prev[functionNameKey] || semanticModel?.functions?.[functionNameKey];
        return {
          ...prev,
          [functionNameKey]: { ...func, actions: newActions }
        };
      }

      // Handle single function case
      return { ...prev, actions: newActions };
    });

    // Focus the new action after state update with smooth scroll
    setTimeout(() => focusAction(index + 1, true), 0);
  }, [setFunction, focusAction, semanticModel, onUpdateSemanticModel, contextName, functionNameKey]);

  return {
    updateAction,
    deleteAction,
    deleteActionAndFocusPrev,
    addDialogLineAfter,
    addActionAfter
  };
}
