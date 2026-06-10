/**
 * Cross-reference analysis utilities for the semantic model.
 *
 * Used by removeDialog and renameDialog operations to detect broken references
 * and cascade renames across functions and dialogs.
 */

import type { SemanticModel } from './semantic-model';
import { getDialogProperty } from './semantic-model';

export interface DialogReference {
  /** The function name that contains the reference */
  functionName: string;
  /** The kind of reference */
  kind: 'NpcKnowsInfo';
  /** Index of the condition within the function's conditions array */
  conditionIndex: number;
}

export interface FunctionReference {
  /** Source of the reference */
  sourceKind: 'dialog-info' | 'dialog-condition' | 'choice-target';
  /** Name of the dialog (if source is a dialog property) */
  dialogName?: string;
  /** Name of the function containing the choice action (if choice-target) */
  functionName?: string;
  /**
   * Index of the top-level action (within the function's actions array) that
   * contains the choice — the choice itself may be nested inside a
   * ConditionalAction branch at that index.
   */
  actionIndex?: number;
}

/**
 * Invokes `visit` for every Choice action reachable from `actions`, including
 * choices nested inside ConditionalAction then/else branches. `topLevelIndex`
 * is the index of the containing top-level action.
 */
function forEachChoice(
  actions: any[],
  visit: (choice: any, topLevelIndex: number) => void
): void {
  const walk = (action: any, topLevelIndex: number): void => {
    if (!action) return;
    if (action.type === 'Choice') {
      visit(action, topLevelIndex);
      return;
    }
    if (action.type === 'ConditionalAction') {
      for (const nested of action.thenActions || []) walk(nested, topLevelIndex);
      for (const nested of action.elseActions || []) walk(nested, topLevelIndex);
    }
  };
  actions.forEach((action, idx) => walk(action, idx));
}

/**
 * Finds all NpcKnowsInfoCondition references to a named dialog across the model.
 */
export function findDialogReferences(
  model: SemanticModel,
  dialogName: string
): DialogReference[] {
  const refs: DialogReference[] = [];

  for (const [funcName, func] of Object.entries(model.functions || {})) {
    const conditions = func.conditions || [];
    conditions.forEach((cond: any, idx: number) => {
      if (cond.type === 'NpcKnowsInfoCondition' && cond.dialogRef === dialogName) {
        refs.push({ functionName: funcName, kind: 'NpcKnowsInfo', conditionIndex: idx });
      }
    });
  }

  return refs;
}

/**
 * Finds all references to a named function across the model:
 * - dialog.properties.information / condition (string or object)
 * - Choice action targetFunction fields
 */
export function findFunctionReferences(
  model: SemanticModel,
  functionName: string
): FunctionReference[] {
  const refs: FunctionReference[] = [];

  // Check dialog property references (property names are case-insensitive in Daedalus)
  for (const [dialogName, dialog] of Object.entries(model.dialogs || {})) {
    const info = getDialogProperty(dialog.properties, 'information');
    const infoName = typeof info === 'string' ? info : (info as any)?.name;
    if (infoName === functionName) {
      refs.push({ sourceKind: 'dialog-info', dialogName });
    }

    const cond = getDialogProperty(dialog.properties, 'condition');
    const condName = typeof cond === 'string' ? cond : (cond as any)?.name;
    if (condName === functionName) {
      refs.push({ sourceKind: 'dialog-condition', dialogName });
    }
  }

  // Check choice action targetFunction references (including nested choices)
  for (const [funcName, func] of Object.entries(model.functions || {})) {
    forEachChoice(func.actions || [], (choice, idx) => {
      if (choice.targetFunction === functionName) {
        refs.push({ sourceKind: 'choice-target', functionName: funcName, actionIndex: idx });
      }
    });
  }

  return refs;
}

/**
 * Returns the set of function names reachable from a starting function via
 * Choice.targetFunction chains.  The start function itself is included.
 *
 * Only functions actually present in the model are included; dangling references
 * are silently skipped.  Cycles are handled via the visited set.
 */
export function collectReachableFunctions(
  model: SemanticModel,
  startFunctionName: string
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [startFunctionName];

  while (queue.length > 0) {
    const name = queue.pop()!;
    if (visited.has(name)) continue;
    const func = model.functions?.[name];
    if (!func) continue;
    visited.add(name);

    forEachChoice(func.actions || [], (choice) => {
      if (typeof choice.targetFunction === 'string' && !visited.has(choice.targetFunction)) {
        queue.push(choice.targetFunction);
      }
    });
  }

  return visited;
}
