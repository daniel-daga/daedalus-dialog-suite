/**
 * editorStore — barrel re-export
 *
 * The store has been split into two focused stores:
 *   - fileStore  (`useFileStore`)  — open/close/save, dirty tracking
 *   - historyStore (`useHistoryStore`) — undo/redo state + snapshot helpers
 *
 * `useEditorStore` is kept as an alias for `useFileStore` so that existing
 * consumers that only use file-management operations continue to work without
 * changes.  Components that also need history operations should import
 * `useHistoryStore` directly.
 */

export { useFileStore, useFileStore as useEditorStore } from './fileStore';
export type { FileStore, FileState } from './fileStore';
export { useHistoryStore } from './historyStore';
