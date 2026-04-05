/**
 * Cross-reference analysis utilities for the semantic model.
 *
 * Used by removeDialog and renameDialog operations to detect broken references
 * and cascade renames across functions and dialogs.
 */

import type { SemanticModel } from './semantic-model';

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
  /** Index of the choice action within the function's actions array */
  actionIndex?: number;
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

  // Check dialog property references
  for (const [dialogName, dialog] of Object.entries(model.dialogs || {})) {
    const info = dialog.properties?.information;
    const infoName = typeof info === 'string' ? info : (info as any)?.name;
    if (infoName === functionName) {
      refs.push({ sourceKind: 'dialog-info', dialogName });
    }

    const cond = dialog.properties?.condition;
    const condName = typeof cond === 'string' ? cond : (cond as any)?.name;
    if (condName === functionName) {
      refs.push({ sourceKind: 'dialog-condition', dialogName });
    }
  }

  // Check choice action targetFunction references
  for (const [funcName, func] of Object.entries(model.functions || {})) {
    const actions = func.actions || [];
    actions.forEach((action: any, idx: number) => {
      if (action.type === 'Choice' && action.targetFunction === functionName) {
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

    for (const action of func.actions || []) {
      const a = action as any;
      if (a.type === 'Choice' && typeof a.targetFunction === 'string') {
        if (!visited.has(a.targetFunction)) {
          queue.push(a.targetFunction);
        }
      }
    }
  }

  return visited;
}
