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
 * What a dialog rename would do, and whether it may: the functions that follow
 * the dialog's name, or the first reason the rename is refused.
 *
 * The one place these rules live. `fileStore.renameDialog` refuses with `error`
 * and renames `functions`; the rename dialog previews `functions` and blocks its
 * submit on the same `error`, so the confirmation cannot disagree with what the
 * store does. The derived function names are the half a dialog-name check cannot
 * see: `DIA_A` can become `DIA_B` while `DIA_B_Info` already exists.
 */
export interface DialogRenamePlan {
  error: string | null;
  functions: Array<{ oldName: string; newName: string }>;
}

export function planDialogRename(
  model: Pick<SemanticModel, 'dialogs' | 'functions'>,
  oldDialogName: string,
  newDialogName: string,
  renameFunctions = true
): DialogRenamePlan {
  const dialogs = model.dialogs || {};
  const functions = model.functions || {};
  const dialogKey = Object.keys(dialogs).find((name) => name.toLowerCase() === oldDialogName.toLowerCase());
  const dialog = dialogKey ? dialogs[dialogKey] : undefined;
  if (!dialog) return { error: `Dialog ${oldDialogName} is not in this file`, functions: [] };

  const taken = Object.keys(dialogs).some(
    (name) => name !== dialogKey && name.toLowerCase() === newDialogName.toLowerCase()
  );
  if (taken) return { error: `A dialog named "${newDialogName}" already exists`, functions: [] };

  const renames: DialogRenamePlan['functions'] = [];
  if (renameFunctions) {
    // Only functions that exist: a dialog's condition property can name one
    // that was deleted, and listing it would be a rename the store cannot make.
    for (const name of collectDialogOwnedFunctions(model, dialog)) {
      const followsName = name.slice(0, oldDialogName.length).toLowerCase() === oldDialogName.toLowerCase();
      if (followsName && functions[name]) {
        renames.push({ oldName: name, newName: newDialogName + name.slice(oldDialogName.length) });
      }
    }
  }

  const beingRenamed = new Set(renames.map((entry) => entry.oldName.toLowerCase()));
  const collision = renames.find((entry) => Object.keys(functions).some(
    (name) => !beingRenamed.has(name.toLowerCase()) && name.toLowerCase() === entry.newName.toLowerCase()
  ));
  if (collision) return { error: `A function named "${collision.newName}" already exists`, functions: renames };

  return { error: null, functions: renames };
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

  // Dialog reachability only models information/condition roots and choice
  // callbacks. A surviving function may also call an owned function directly
  // inside preserved raw source. Use current actions/conditions (never the
  // historical callSites index) and conservatively retain a target whenever
  // its identifier appears in an unstructured representation. String or
  // comment matches can retain extra declarations, but cannot destroy source.
  let changed: boolean;
  do {
    changed = false;
    for (const name of [...deletable]) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reference = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'iu');
      const referencedByFunction = Object.entries(model.functions || {}).some(([caller, func]) => {
        if (deletable.has(caller)) return false;
        return reference.test(JSON.stringify([func.actions || [], func.conditions || []]));
      });
      const referencedByDialog = Object.entries(model.dialogs || {}).some(([survivor, other]) => {
        if (survivor === dialogName) return false;
        return reference.test(JSON.stringify([other.properties || {}, (other as any).actions || []]));
      });
      const referencedBySurvivor = referencedByFunction || referencedByDialog;
      if (referencedBySurvivor) {
        deletable.delete(name);
        changed = true;
      }
    }
  } while (changed);

  return deletable;
}
