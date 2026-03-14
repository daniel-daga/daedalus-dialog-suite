import { useCallback } from 'react';
import { generateUniqueChoiceFunctionName, createEmptyFunction } from '../dialogUtils';
import { createAction, createActionAfterIndex, createDialogLineId } from '../actionFactory';
import type { ActionTypeId } from '../actionTypes';
import type { DialogAction, DialogFunction, DialogLineAction, SemanticModel } from '../../types/global';
import type { FunctionUpdater } from '../dialogTypes';
import type { ActionBranchKey, ActionPath } from '../nestedActionUtils';
import {
  appendActionToBranch,
  collectDialogLineActions,
  deleteActionAtPath as deleteNestedActionAtPath,
  flattenActionPaths,
  getActionAtPath,
  insertActionAfterPath,
  updateActionAtPath as updateNestedActionAtPath
} from '../nestedActionUtils';

/**
 * Configuration for action management
 */
export interface ActionManagementConfig {
  setFunction: (funcOrUpdater: FunctionUpdater) => void;
  /** Function to focus a specific action by index */
  focusAction: (path: ActionPath, scrollIntoView?: boolean) => void;
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

  const buildDialogLineAction = useCallback((actions: DialogAction[], speaker: 'self' | 'other', text: string = ''): DialogLineAction => ({
    type: 'DialogLine',
    speaker,
    text,
    id: createDialogLineId({
      dialogName: contextName,
      speaker,
      actions: collectDialogLineActions(actions)
    })
  }), [contextName]);

  const updateAction = useCallback((path: ActionPath, updatedAction: DialogAction) => {
    setFunction((prev) => {
      if (!prev) return prev;
      const actions = prev.actions || [];
      const previousAction = getActionAtPath(actions, path);
      let nextAction = updatedAction;

      if (updatedAction.type === 'DialogLine') {
        const currentId = (updatedAction as DialogLineAction).id;
        const speakerChanged = previousAction?.type === 'DialogLine' && previousAction.speaker !== updatedAction.speaker;
        const needsGeneratedId = !currentId || currentId === 'NEW_LINE_ID';

        if (speakerChanged || needsGeneratedId) {
          const actionsWithoutCurrent = collectDialogLineActions(deleteNestedActionAtPath(actions, path));
          const generatedId = createDialogLineId({
            dialogName: contextName,
            speaker: updatedAction.speaker,
            actions: actionsWithoutCurrent
          });
          let id = generatedId;

          // Preserve sequence number when only the speaker changes.
          if (speakerChanged && currentId) {
            const generatedMatch = generatedId.match(/^(.*)_(\d+)_([0-9]+)$/);
            const currentMatch = currentId.match(/^(?:.+)_(\d+)_([0-9]+)$/);

            if (generatedMatch && currentMatch) {
              const candidateWithSameIndex = `${generatedMatch[1]}_${generatedMatch[2]}_${currentMatch[2]}`;
              const hasConflict = actionsWithoutCurrent.some((action) =>
                action?.type === 'DialogLine' && action.id === candidateWithSameIndex
              );
              if (!hasConflict) {
                id = candidateWithSameIndex;
              }
            }
          }

          nextAction = {
            ...updatedAction,
            id
          };
        }
      }

      return { ...prev, actions: updateNestedActionAtPath(actions, path, nextAction) };
    });
  }, [setFunction, contextName]);

  /**
   * Delete an action at a specific index
   */
  const deleteAction = useCallback((path: ActionPath) => {
    setFunction((prev) => {
      if (!prev) return prev;
      const newActions = deleteNestedActionAtPath(prev.actions || [], path);
      return { ...prev, actions: newActions };
    });
  }, [setFunction]);

  /**
   * Delete an action and focus the previous one
   */
  const deleteActionAndFocusPrev = useCallback((path: ActionPath) => {
    let focusTarget: ActionPath | null = null;
    setFunction((prev) => {
      if (!prev) return prev;
      const visiblePaths = flattenActionPaths(prev.actions || []);
      const currentIndex = visiblePaths.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(path));
      focusTarget = currentIndex > 0 ? visiblePaths[currentIndex - 1] : null;
      const newActions = deleteNestedActionAtPath(prev.actions || [], path);
      return { ...prev, actions: newActions };
    });

    if (focusTarget) {
      setTimeout(() => focusAction(focusTarget as ActionPath), 0);
    }
  }, [setFunction, focusAction]);

  /**
   * Add a dialog line after a specific index
   * By default toggles the speaker (self/other), unless toggleSpeaker is false
   */
  const addDialogLineAfter = useCallback((path: ActionPath, toggleSpeaker: boolean = true) => {
    let nextPath: ActionPath | null = null;
    setFunction((prev) => {
      if (!prev) return prev;
      const actions = prev.actions || [];

      const currentAction = getActionAtPath(actions, path);
      const newSpeaker = toggleSpeaker
        ? (currentAction?.type === 'DialogLine' && currentAction.speaker === 'self' ? 'other' : 'self')
        : (currentAction?.type === 'DialogLine' ? currentAction.speaker : 'self');
      const newAction = buildDialogLineAction(actions, newSpeaker);

      const newActions = insertActionAfterPath(actions, path, newAction);
      const visiblePaths = flattenActionPaths(newActions);
      const insertedIndex = visiblePaths.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(path)) + 1;
      nextPath = insertedIndex > 0 ? visiblePaths[insertedIndex] : null;
      return { ...prev, actions: newActions };
    });

    if (nextPath) {
      setTimeout(() => focusAction(nextPath as ActionPath, true), 0);
    }
  }, [setFunction, focusAction, buildDialogLineAction]);

  /**
   * Add an action after a specific index
   * Handles choice creation with automatic target function generation
   */
  const addActionAfter = useCallback((path: ActionPath, actionType: ActionTypeId) => {
    let nextPath: ActionPath | null = null;
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
        const actions = prev.actions || [];

        const newAction = createAction('choice', { dialogName: contextName }) as DialogAction;
        if ('targetFunction' in newAction) {
          newAction.targetFunction = newFunctionName;
        }

        const newActions = insertActionAfterPath(actions, path, newAction);
        const visiblePaths = flattenActionPaths(newActions);
        const insertedIndex = visiblePaths.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(path)) + 1;
        nextPath = insertedIndex > 0 ? visiblePaths[insertedIndex] : null;
        return { ...prev, actions: newActions };
      });

      if (nextPath) {
        setTimeout(() => focusAction(nextPath as ActionPath, true), 0);
      }
      return;
    }

    // Use factory for all other action types
    setFunction((prev) => {
      if (!prev) return prev;
      const actions = prev.actions || [];
      const parentIndex = path[path.length - 1] as number;
      const siblingActions = path.length === 1
        ? actions
        : (() => {
            const branch = path[path.length - 2];
            const parentPath = path.slice(0, -2);
            const parent = getActionAtPath(actions, parentPath);
            if (branch !== 'then' && branch !== 'else') {
              return actions;
            }
            return parent?.type === 'ConditionalAction'
              ? parent[branch === 'then' ? 'thenActions' : 'elseActions']
              : actions;
          })();

      const newAction = createActionAfterIndex(
        actionType,
        parentIndex,
        siblingActions,
        contextName
      ) as DialogAction;
      if (newAction.type === 'DialogLine') {
        newAction.id = createDialogLineId({
          dialogName: contextName,
          speaker: newAction.speaker,
          actions: collectDialogLineActions(actions)
        });
      }

      const newActions = insertActionAfterPath(actions, path, newAction);
      const visiblePaths = flattenActionPaths(newActions);
      const insertedIndex = visiblePaths.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(path)) + 1;
      nextPath = insertedIndex > 0 ? visiblePaths[insertedIndex] : null;
      return { ...prev, actions: newActions };
    });

    if (nextPath) {
      setTimeout(() => focusAction(nextPath as ActionPath, true), 0);
    }
  }, [setFunction, focusAction, semanticModel, onUpdateSemanticModel, contextName]);

  const addActionToBranchEnd = useCallback((path: ActionPath, branch: ActionBranchKey, actionType: ActionTypeId) => {
    let nextPath: ActionPath | null = null;
    setFunction((prev) => {
      if (!prev) return prev;
      const actions = prev.actions || [];
      const target = getActionAtPath(actions, path);
      const branchActions = target?.type === 'ConditionalAction'
        ? target[branch === 'then' ? 'thenActions' : 'elseActions']
        : [];
      const currentAction = branchActions[branchActions.length - 1];
      const newAction = createAction(actionType, {
        dialogName: contextName,
        currentAction,
        actions: branchActions
      }) as DialogAction;
      if (newAction.type === 'DialogLine') {
        newAction.id = createDialogLineId({
          dialogName: contextName,
          speaker: newAction.speaker,
          actions: collectDialogLineActions(actions)
        });
      }

      nextPath = [...path, branch, branchActions.length];
      return {
        ...prev,
        actions: appendActionToBranch(actions, path, branch, newAction)
      };
    });

    if (nextPath) {
      setTimeout(() => focusAction(nextPath as ActionPath, true), 0);
    }
  }, [setFunction, contextName, focusAction]);

  return {
    updateAction,
    deleteAction,
    deleteActionAndFocusPrev,
    addDialogLineAfter,
    addActionAfter,
    addActionToBranchEnd
  };
}
