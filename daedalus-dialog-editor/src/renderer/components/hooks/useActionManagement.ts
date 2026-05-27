import { useCallback } from 'react';
import { generateUniqueChoiceFunctionName, createEmptyFunction } from '../dialogUtils';
import { createAction, createActionAfterIndex, createDialogLineId } from '../actionFactory';
import type { ActionTypeId } from '../actionTypes';
import type { DialogAction, DialogFunction, DialogLineAction, SemanticModel } from '../../types/global';
import type { FunctionUpdater } from '../dialogTypes';
import type { ActionBranchKey, ActionPath } from '../nestedActionUtils';
import {
  actionPathToKey,
  appendActionToBranch,
  collectAllDialogLineActionsFromModel,
  collectDialogLineActions,
  deleteActionAtPath as deleteNestedActionAtPath,
  flattenActionPaths,
  getActionAtPath,
  insertActionAfterPath,
  moveActionWithinLevel,
  updateActionAtPath as updateNestedActionAtPath
} from '../nestedActionUtils';

/**
 * Given a flat path list derived from `newActions` (after an insertion
 * immediately following `insertedAfterPath`), return the path of the newly
 * inserted item.  Returns null when `insertedAfterPath` is not found or the
 * inserted item is beyond the end of the list.
 */
function findInsertedPath(newActions: DialogAction[], insertedAfterPath: ActionPath): ActionPath | null {
  const paths = flattenActionPaths(newActions);
  const afterIndex = paths.findIndex(
    (p) => actionPathToKey(p) === actionPathToKey(insertedAfterPath)
  );
  const insertedIndex = afterIndex + 1;
  return insertedIndex > 0 && insertedIndex < paths.length ? paths[insertedIndex] : null;
}

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
  /** Name of the function currently being edited (used to avoid stale data from semanticModel) */
  currentFunctionName?: string | null;
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
    currentFunctionName
  } = config;

  /**
   * Applies a pure transform to the function's actions list.
   * Handles the null guard and `{ ...prev, actions }` spread that every
   * setFunction callback otherwise has to repeat.
   */
  const patchActions = useCallback(
    (transform: (actions: DialogAction[]) => DialogAction[]) => {
      setFunction((prev) => {
        if (!prev) return prev;
        return { ...prev, actions: transform(prev.actions || []) };
      });
    },
    [setFunction]
  );

  /**
   * Collect all dialog line actions across all functions belonging to the same dialog.
   * Uses live actions for the current function (may have unsaved edits) and
   * semantic model data for all sibling functions.
   */
  const getAllDialogLineActions = useCallback((liveActions: DialogAction[]): DialogAction[] => {
    if (!semanticModel) {
      return collectDialogLineActions(liveActions);
    }
    const fromOtherFunctions = collectAllDialogLineActionsFromModel(
      semanticModel, contextName, currentFunctionName
    );
    return [...fromOtherFunctions, ...collectDialogLineActions(liveActions)];
  }, [semanticModel, contextName, currentFunctionName]);

  const buildDialogLineAction = useCallback((actions: DialogAction[], speaker: 'self' | 'other', text: string = ''): DialogLineAction => ({
    type: 'DialogLine',
    speaker,
    text,
    id: createDialogLineId({
      dialogName: contextName,
      speaker,
      actions: getAllDialogLineActions(actions)
    })
  }), [contextName, getAllDialogLineActions]);

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
          const actionsWithoutCurrent = getAllDialogLineActions(deleteNestedActionAtPath(actions, path));
          const generatedId = createDialogLineId({
            dialogName: contextName,
            speaker: updatedAction.speaker,
            actions: actionsWithoutCurrent
          });
          let id = generatedId;

          // Preserve sequence number when only the speaker changes.
          //
          // DialogLine IDs follow the format: `<prefix>_<speakerIndex>_<sequenceNumber>`
          //   Group 1 — full prefix up to the last two numeric segments
          //   Group 2 — speaker index  (e.g. 0 = self, 1 = other)
          //   Group 3 — per-speaker sequence number
          //
          // When the speaker flips we generate a new ID for the new speaker, but
          // we try to reuse the OLD sequence number so existing references don't
          // break unnecessarily.
          if (speakerChanged && currentId) {
            const generatedMatch = generatedId.match(/^(.*)_(\d+)_([0-9]+)$/);
            const currentMatch = currentId.match(/^(?:.+)_(\d+)_([0-9]+)$/);

            if (generatedMatch && currentMatch) {
              // candidateWithSameIndex: new prefix + new speaker index + old sequence number
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

      let updatedActions = updateNestedActionAtPath(actions, path, nextAction);

      // Sync following LogSetTopicStatus and LogEntry topics when CreateTopic topic changes
      if (
        updatedAction.type === 'CreateTopic' &&
        previousAction?.type === 'CreateTopic' &&
        updatedAction.topic !== previousAction.topic
      ) {
        const lastIndex = path[path.length - 1];
        if (typeof lastIndex === 'number') {
          const parentPath = path.slice(0, -1);
          for (let offset = 1; offset <= 2; offset++) {
            const siblingPath: ActionPath = [...parentPath, lastIndex + offset];
            const sibling = getActionAtPath(updatedActions, siblingPath);
            if (
              sibling &&
              (sibling.type === 'LogSetTopicStatus' || sibling.type === 'LogEntry') &&
              'topic' in sibling &&
              sibling.topic === previousAction.topic
            ) {
              updatedActions = updateNestedActionAtPath(updatedActions, siblingPath, {
                ...sibling,
                topic: updatedAction.topic
              });
            }
          }
        }
      }

      return { ...prev, actions: updatedActions };
    });
  }, [setFunction, contextName, getAllDialogLineActions]);

  /**
   * Delete an action at a specific index
   */
  const deleteAction = useCallback((path: ActionPath) => {
    patchActions((actions) => deleteNestedActionAtPath(actions, path));
  }, [patchActions]);

  /**
   * Delete an action and focus the previous one
   */
  const deleteActionAndFocusPrev = useCallback((path: ActionPath) => {
    let focusTarget: ActionPath | null = null;
    setFunction((prev) => {
      if (!prev) return prev;
      const visiblePaths = flattenActionPaths(prev.actions || []);
      const currentIndex = visiblePaths.findIndex((candidate) => actionPathToKey(candidate) === actionPathToKey(path));
      focusTarget = currentIndex > 0 ? visiblePaths[currentIndex - 1] : null;
      const newActions = deleteNestedActionAtPath(prev.actions || [], path);
      return { ...prev, actions: newActions };
    });

    if (focusTarget) {
      focusAction(focusTarget);
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
        ? (currentAction?.type === 'DialogLine' ? (currentAction.speaker === 'self' ? 'other' : 'self') : 'other')
        : (currentAction?.type === 'DialogLine' ? currentAction.speaker : 'other');
      const newAction = buildDialogLineAction(actions, newSpeaker);

      const newActions = insertActionAfterPath(actions, path, newAction);
      nextPath = findInsertedPath(newActions, path);
      return { ...prev, actions: newActions };
    });

    if (nextPath) {
      // Call focusAction immediately — it always stores a pending request so the
      // new element at nextPath gets focus as soon as it registers its ref in
      // useLayoutEffect (before the first paint).
      focusAction(nextPath, true);
    }
  }, [setFunction, focusAction, buildDialogLineAction]);

  /**
   * Add an action after a specific index
   * Handles choice creation with automatic target function generation
   */
  const addActionAfter = useCallback((path: ActionPath, actionType: ActionTypeId) => {
    let nextPath: ActionPath | null = null;

    if (actionType === 'choice' && semanticModel) {
      // Choice creation: generate a fresh target function before inserting the action
      const newFunctionName = generateUniqueChoiceFunctionName(contextName, semanticModel);
      const newFunction = createEmptyFunction(newFunctionName);
      onUpdateSemanticModel?.(newFunctionName, newFunction);

      setFunction((prev) => {
        if (!prev) return prev;
        const actions = prev.actions || [];
        const newAction = {
          ...createAction('choice', { dialogName: contextName }),
          targetFunction: newFunctionName
        };
        const newActions = insertActionAfterPath(actions, path, newAction);
        nextPath = findInsertedPath(newActions, path);
        return { ...prev, actions: newActions };
      });
    } else {
      // All other action types: use the factory
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

        let newAction = createActionAfterIndex(
          actionType,
          parentIndex,
          siblingActions,
          contextName
        );
        if (newAction.type === 'DialogLine') {
          newAction = {
            ...newAction,
            id: createDialogLineId({
              dialogName: contextName,
              speaker: newAction.speaker,
              actions: getAllDialogLineActions(actions)
            })
          };
        }

        let newActions = insertActionAfterPath(actions, path, newAction);
        const createTopicPath = findInsertedPath(newActions, path);

        if (actionType === 'createTopic' && createTopicPath) {
          const createTopicTopic = newAction.type === 'CreateTopic' ? newAction.topic : 'TOPIC_';
          const logSetStatusAction = createAction('logSetTopicStatus', { dialogName: contextName, currentAction: undefined });
          newActions = insertActionAfterPath(newActions, createTopicPath, {
            ...logSetStatusAction,
            topic: createTopicTopic,
            status: 'LOG_RUNNING',
          } as DialogAction);
          const logSetStatusPath = findInsertedPath(newActions, createTopicPath);
          const logEntryAction = createAction('logEntry', { dialogName: contextName, currentAction: undefined });
          if (logSetStatusPath) {
            newActions = insertActionAfterPath(newActions, logSetStatusPath, {
              ...logEntryAction,
              topic: createTopicTopic,
            } as DialogAction);
          }
          nextPath = createTopicPath;
        } else {
          nextPath = createTopicPath;
        }

        return { ...prev, actions: newActions };
      });
    }

    if (nextPath) {
      // Defer past MUI menu's async focus-restoration (runs in useEffect after
      // paint) so the new element wins the focus race after menu close.
      const pathToFocus = nextPath;
      setTimeout(() => focusAction(pathToFocus, true), 0);
    }
  }, [setFunction, focusAction, semanticModel, onUpdateSemanticModel, contextName, getAllDialogLineActions]);

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
      let newAction = createAction(actionType, {
        dialogName: contextName,
        currentAction,
        actions: branchActions
      });
      if (newAction.type === 'DialogLine') {
        newAction = {
          ...newAction,
          id: createDialogLineId({
            dialogName: contextName,
            speaker: newAction.speaker,
            actions: getAllDialogLineActions(actions)
          })
        };
      }

      nextPath = [...path, branch, branchActions.length];
      return {
        ...prev,
        actions: appendActionToBranch(actions, path, branch, newAction)
      };
    });

    if (nextPath) {
      focusAction(nextPath, true);
    }
  }, [setFunction, contextName, focusAction, getAllDialogLineActions]);

  const moveAction = useCallback((pathPrefix: ActionPath, sourceIndex: number, destinationIndex: number) => {
    patchActions((actions) => moveActionWithinLevel(actions, pathPrefix, sourceIndex, destinationIndex));
  }, [patchActions]);

  return {
    updateAction,
    deleteAction,
    deleteActionAndFocusPrev,
    addDialogLineAfter,
    addActionAfter,
    addActionToBranchEnd,
    moveAction
  };
}
