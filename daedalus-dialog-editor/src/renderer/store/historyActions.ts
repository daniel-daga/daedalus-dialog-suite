/**
 * History-aware wrappers for all fileStore mutation methods.
 *
 * Each exported function calls `historyStore.pushSnapshot(filePath)` before
 * delegating to the underlying fileStore method.  Components and hooks should
 * import from here instead of calling fileStore mutations directly so that every
 * change is automatically recorded in the undo stack.
 *
 * The `withHistory` helper captures a snapshot before the mutation fires.
 * Rapid sequential calls within COALESCE_MS are merged into a single undo step
 * by the historyStore.pushSnapshot coalescing logic.
 */

import { useFileStore } from './fileStore';
import { useHistoryStore } from './historyStore';
import type { Dialog, DialogFunction, SemanticModel } from '../types/global';

// ---------------------------------------------------------------------------
// Generic helper
// ---------------------------------------------------------------------------

/**
 * Wrap a fileStore mutation (whose first argument is always `filePath`) so that
 * a history snapshot is pushed before each call.
 */
function withHistory<Args extends [string, ...unknown[]]>(
  getMethod: () => (...args: Args) => void
): (...args: Args) => void {
  return (...args: Args) => {
    const filePath = args[0];
    useHistoryStore.getState().pushSnapshot(filePath);
    getMethod()(...args);
  };
}

// ---------------------------------------------------------------------------
// Exported history-aware mutations
// ---------------------------------------------------------------------------

export const updateModel = withHistory<[string, SemanticModel]>(
  () => useFileStore.getState().updateModel
);

export const updateDialog = withHistory<[string, string, Dialog]>(
  () => useFileStore.getState().updateDialog
);

export const updateDialogWithUpdater = withHistory<[string, string, (existing: Dialog) => Dialog | null]>(
  () => useFileStore.getState().updateDialogWithUpdater
);

export const updateDialogWithNormalizedProperties = withHistory<[string, string, (existing: Dialog) => Dialog | null]>(
  () => useFileStore.getState().updateDialogWithNormalizedProperties
);

export const updateFunction = withHistory<[string, string, DialogFunction]>(
  () => useFileStore.getState().updateFunction
);

export const updateFunctionWithUpdater = withHistory<[string, string, (existing: DialogFunction) => DialogFunction | null]>(
  () => useFileStore.getState().updateFunctionWithUpdater
);

export const renameFunction = withHistory<[string, string, string]>(
  () => useFileStore.getState().renameFunction
);

export const updateDialogConditionFunction = withHistory<[string, string, (existing: DialogFunction) => DialogFunction | null]>(
  () => useFileStore.getState().updateDialogConditionFunction
);

export const replaceDialogConditionFunction = withHistory<[string, string, DialogFunction]>(
  () => useFileStore.getState().replaceDialogConditionFunction
);
