import { createContext } from 'react';
import type { ActionPath } from './nestedActionUtils';
import type { DialogAction } from '../types/global';

/**
 * Replaces the whole list at one nesting level of the function being edited
 * (#322). A quest step card stands for several lines, so its edits, deletes
 * and moves are list-level operations the per-action handlers cannot express.
 *
 * Provided per edited function: DialogActionsSection for the dialog's own
 * function, InlineChoiceEditor for a choice's target function. A null context
 * (a standalone render or a unit test) turns quest-step grouping off, and the
 * list shows every line as its own card.
 */
export type ActionLevelPatch = (
  pathPrefix: ActionPath,
  transform: (actions: DialogAction[]) => DialogAction[]
) => void;

export const ActionLevelPatchContext = createContext<ActionLevelPatch | null>(null);
