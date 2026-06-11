/**
 * Utility functions for dialog editing
 */

import type { Dialog, DialogFunction, SemanticModel } from '../types/global';
import { collectChoiceActions } from './nestedActionUtils';

/**
 * Generate a unique function name for a choice's target function
 * Format: <DialogName>_Choice_<Number>
 */
export const generateUniqueChoiceFunctionName = (dialogName: string, semanticModel: SemanticModel): string => {
  const baseName = `${dialogName}_Choice`;
  let counter = 1;
  let candidateName = `${baseName}_${counter}`;

  // Keep incrementing until we find a unique name
  while (semanticModel.functions && semanticModel.functions[candidateName]) {
    counter++;
    candidateName = `${baseName}_${counter}`;
  }

  return candidateName;
};

/**
 * Create a new empty function in the semantic model
 */
export const createEmptyFunction = (functionName: string): DialogFunction => {
  return {
    name: functionName,
    returnType: 'VOID',
    calls: [],
    actions: [],
    conditions: []
  };
};

/**
 * Validate function name for choice target functions
 * Returns error message if invalid, null if valid
 */
export const validateChoiceFunctionName = (
  functionName: string,
  requiredPrefix: string,
  semanticModel: SemanticModel | undefined,
  originalFunctionName?: string
): string | null => {
  if (!functionName || functionName.trim() === '') {
    return 'Function name cannot be empty';
  }

  if (!functionName.startsWith(requiredPrefix)) {
    return `Function name must start with "${requiredPrefix}"`;
  }

  // Check uniqueness (skip if it's the same as original - meaning no rename)
  if (functionName !== originalFunctionName && semanticModel?.functions?.[functionName]) {
    return 'Function name already exists';
  }

  return null;
};

/**
 * Resolve a dialog property function reference that may be either a plain
 * name or a `{ name }` object.
 */
export const resolveFunctionRef = (ref: unknown): string | undefined => {
  if (typeof ref === 'string') return ref;
  return (ref as { name?: string } | undefined)?.name;
};

/**
 * Collect every function reachable from `rootFunctionName` by following
 * `Choice.targetFunction` references, including choices nested inside
 * ConditionalAction branches.
 */
export function collectReachableChoiceFunctions(
  functions: SemanticModel['functions'] | undefined,
  rootFunctionName: string | undefined
): Set<string> {
  const reachable = new Set<string>();
  if (!rootFunctionName) return reachable;

  const queue: string[] = [rootFunctionName];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (reachable.has(name)) continue;
    const func = functions?.[name];
    if (!func) continue;
    reachable.add(name);
    for (const choice of collectChoiceActions(func.actions || [])) {
      const target = (choice as { targetFunction?: unknown }).targetFunction;
      if (typeof target === 'string' && !reachable.has(target)) {
        queue.push(target);
      }
    }
  }
  return reachable;
}

/**
 * Collect all functions owned by a dialog: its condition function plus the
 * full choice subtree reachable from its information function.
 */
export function collectDialogOwnedFunctions(
  model: Pick<SemanticModel, 'dialogs' | 'functions'>,
  dialog: Dialog | undefined
): Set<string> {
  const owned = collectReachableChoiceFunctions(
    model.functions,
    resolveFunctionRef(dialog?.properties?.information)
  );
  const condFuncName = resolveFunctionRef(dialog?.properties?.condition);
  if (condFuncName) owned.add(condFuncName);
  return owned;
}

/**
 * Compute the set of functions that can safely be deleted together with
 * `dialogName`: functions owned by the dialog that are not referenced by any
 * remaining dialog (via information/condition properties or nested choices).
 */
export function computeDialogDeletionSet(
  model: Pick<SemanticModel, 'dialogs' | 'functions'>,
  dialogName: string
): Set<string> {
  const dialog = model.dialogs?.[dialogName];
  if (!dialog) return new Set();

  const candidates = collectDialogOwnedFunctions(model, dialog);

  const stillReferenced = new Set<string>();
  for (const [name, other] of Object.entries(model.dialogs || {}) as Array<[string, Dialog]>) {
    if (name === dialogName) continue;
    collectDialogOwnedFunctions(model, other).forEach((fn) => stillReferenced.add(fn));
  }

  const deletable = new Set<string>();
  for (const name of candidates) {
    if (!stillReferenced.has(name)) deletable.add(name);
  }
  return deletable;
}
