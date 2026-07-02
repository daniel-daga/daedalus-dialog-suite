# Dialog Editor Architecture

Durable design decisions for `daedalus-dialog-editor/` outside the quest
editor (see `quest-editor.md` for quest-specific layering). Consolidated from
the March and June 2026 editor reviews.

## Action System Conventions

Established by the March 2026 review (see git history of
`REVIEW-dialog-editor.md` for the full findings and fix log):

- Action type detection uses the `type` discriminant field via the
  `TYPE_TO_ID` lookup in `actionTypes.ts`; property-sniffing exists only as a
  fallback for legacy actions without a `type` field. A new action must set
  `type` and register in the map — never extend the sniffing chain.
- `createAction` is template-lookup driven (`ACTION_TEMPLATES[actionType]()`),
  with explicit special cases only for dialog lines (speaker toggle) and
  choices (`dialogRef`). Factory and utility signatures are fully typed
  (`DialogAction` / `SemanticModel`) — no `any`.
- The action-type menu (`ActionTypeMenu`) and renderer registry are the single
  source of truth for action labels/items; components must not carry local
  copies of the menu list.
- Deferred focus goes through `useFocusNavigation`'s `pendingFocusRequests`
  queue (applied when the target registers its ref) — never
  `setTimeout(..., 0)`.
- `ActionCard` guards its unmount flush by comparing the local action against
  the last parent-synced value (`shallowEqual`); this prevents stale writes
  when drag-and-drop reorder unmounts/remounts cards.
- Escape on an action opens a delete confirmation (`DeleteConfirmDialog`,
  confirm auto-focused); it never deletes immediately.
- Action IDs come from `crypto.randomUUID()`.

## Undo/Redo History

- There is a single per-file edit history (`historyStore.editHistory`) shared
  by all editing surfaces (dialog editing and quest editing). Parallel undo
  stacks that restore full-model snapshots of the same file are not allowed —
  undo on one surface must not silently revert the other surface's edits.
- Snapshots (`EditSnapshot`) hold the semantic model **by reference**, never
  deep-cloned. This is safe only because fileStore state is Immer-produced
  (copy-on-write, auto-frozen). If fileStore ever stops producing frozen
  immutable state, history snapshots would alias live state.
- Snapshots also capture and restore quest `nodePositions`; the timestamp
  coalesces rapid edits into one undo step (quest-surface snapshots use
  timestamp 0 so later edits never coalesce into them).
- Undo/redo is phased so no Immer draft proxy can escape into fileStore:
  **plan** (built from plain, non-draft store state) → **commit** (stack moves
  inside the Immer draft) → **apply** (restore the planned snapshot into
  fileStore outside the draft).
- Because autosave writes every dirty file after a 2-second debounce, disk
  state is never a recovery point: history lives in memory at the
  semantic-model level, and undo simply restores the model and re-triggers
  autosave (disk always reflects the current in-memory state). History for a
  file is cleared when it is externally changed or replaced from a source
  save.
- Bounds: `MAX_HISTORY_SIZE = 50` snapshots per file; edits within
  `COALESCE_MS = 300` ms merge into one undo step (`historyStore.ts`).
- The global Ctrl+Z / Ctrl+Y handler (`MainLayout.tsx`) yields to Monaco's
  built-in undo/redo whenever focus is inside a `.monaco-editor` element.

## Main-Process Security Boundaries

The renderer is untrusted; security decisions live in the main process:

- **Path allowlist** (`PathValidationService`): new directories are
  whitelisted only by main-process flows (file/folder dialogs,
  `addRecentProject`). The `project:addAllowedPath` IPC only re-whitelists
  paths already persisted as recent projects; unknown paths are ignored, so a
  compromised renderer cannot extend the allowlist.
- **Updater**: `downloadUpdate` only accepts the URL offered by the most
  recent main-process `checkForUpdate`; `installUpdate` only executes the
  installer actually downloaded (and only inside the temp directory). HTTP
  redirects are bounded (`MAX_REDIRECTS`).
- **File-watcher self-write suppression** is registered by the main process at
  actual write time — not by the renderer before a save that may still fail
  validation.

## File I/O

- `FileService` serializes per-file access with a FIFO lock queue (waiters are
  released one at a time, in order).
- Encoding: files that were never read before being written default to
  windows-1252 (the Gothic 2 script encoding), not utf8.
