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

- There is a single per-file edit history (`historyStore.editHistory`).
  Parallel undo stacks that restore full-model snapshots of the same file are
  not allowed — undo on one surface must not silently revert another surface's
  edits. (The quest-batch history that once shared this store went away with
  the quest Flow view — see `quest-editor.md`.)
- Snapshots (`EditSnapshot`) hold the semantic model **by reference**, never
  deep-cloned. This is safe only because fileStore state is Immer-produced
  (copy-on-write, auto-frozen). If fileStore ever stops producing frozen
  immutable state, history snapshots would alias live state.
- The snapshot timestamp coalesces rapid edits into one undo step.
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

Durable decisions from remediation slice 5 (fix-05, 2026-07-03):

- **Snapshot identity.** `EditSnapshot` carries a monotonic `id` (module-level
  counter, assigned in `createEditSnapshot`). Ids are eviction-proof and O(1) to
  compare — stack depths are not, because `MAX_HISTORY_SIZE` eviction and
  `clearHistoryForFile` shift them.
- **No phantom undo steps.** Snapshot pushes are transactional
  (`pushSnapshotTransactional`): the pre-state `past`/`future` refs and the
  current model reference are captured, the mutation runs, and if the model
  reference is unchanged (the fileStore updater no-opped — missing dialog/function,
  updater returned `null`) the captured stacks are **restored**. This also undoes
  the coalescing path's `future = []` wipe, so a no-op edit can no longer consume a
  Ctrl+Z or destroy the redo stack. Reference equality is sound because fileStore
  is Immer-produced (a real change always allocates a new model object).
- **No save-wipe of other files' history.** The fileStore save-detection branch
  clears only the saved file's history (`clearHistoryForFile(savedFile)`) —
  saving one file must not wipe undo state for other files.
- **Flush before undo/redo.** The Ctrl+Z/Ctrl+Y handler
  calls `flushAllPendingEdits()` (see the pending-edit flush registry in
  [save-pipeline.md](./save-pipeline.md)) inside `flushSync` before invoking
  undo/redo, so a 300 ms-debounced in-flight edit commits as a normal history step
  *first* — the first Ctrl+Z then reverts the in-flight typing and redo can restore
  it (standard editor semantics; flushing, never cancelling, so keystrokes are
  never silently discarded).

## Fire-time debounced edits

Both `ActionCard` and (since slice 5) `ConditionCard` resolve their 300 ms
debounced edits at **fire time via refs**, never from values captured lexically
when the timer was scheduled:

- The timer body reads `updateRef.current(indexRef.current, localRef.current)`, so
  a reindex (a delete above a card keyed by array index) lands the write on the
  current slot, not the stale one.
- The unmount flush is guarded by `shallowEqual(local, lastParentSynced)` so an
  unmount from drag-reorder does not re-apply an already-synced value.
- Delete exposes `markDeleted()` (clears the timer, syncs the ref) which the delete
  button calls before removing the item, so a pending edit cannot resurrect a
  deleted condition. `ConditionEditor.updateCondition`'s out-of-range append branch
  (the resurrection vector) was removed — out-of-range updates are no-ops (and push
  no phantom snapshot, above).

## Drag-and-drop

Action/condition reordering uses **`@hello-pangea/dnd`** (a maintained drop-in
replacement for the archived `react-beautiful-dnd`, which never registered
draggables under React 18 StrictMode). Architecture:

- **One hoisted `DragDropContext` per dialog-editing pane**
  (`DialogActionsSection`), not one per list. `ActionsList` is rendered
  recursively (conditional-action then/else branches, inline choice editors nest
  2–3 deep); nested contexts are unsupported.
- **Dispatch registry.** Each descendant `ActionsList` registers
  `droppableId → moveAction(pathPrefix, …)` with a small React `DragDispatchContext`
  on mount; the single `onDragEnd` dispatches by `result.source.droppableId`.
  Dispatch must be a registry rather than path-parsing because an inline choice
  editor's `moveAction` targets a *different function* than the outer list.
- **Namespaced droppableIds.** `${dialogContextName-or-target-function}:${actionPathToKey(pathPrefix) || 'root'}`
  — the old bare `'root'` collided the moment contexts were unified. Cross-list
  moves are rejected (`source.droppableId !== destination.droppableId`).
- **Stable, unique keys/draggableIds.** Duplicated `AI_Output` ids in real mod
  files are disambiguated (`id`, `id@2`, …) via a `useMemo` over the list content;
  conditions (which have no ids) are keyed by a parallel `uiIds` side-table mutated
  in the same add/delete handlers as the array.

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
