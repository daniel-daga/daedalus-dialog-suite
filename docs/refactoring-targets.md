# Refactoring Targets

Audit of god components, muddled concerns, and maintainability red flags.

---

## Deferred Architectural Splits

### 1. `editorStore.ts` — split into focused stores
**File:** `daedalus-dialog-editor/src/renderer/store/editorStore.ts`

- `fileStore` — open/close/save, dirty tracking
- `historyStore` — undo/redo state + snapshot helpers (move `applyUndoForFile`/`applyRedoForFile` + store state)

---

### 2. `ThreeColumnLayout.tsx` — split layout into sub-components
**File:** `daedalus-dialog-editor/src/renderer/components/ThreeColumnLayout.tsx`

- Sub-components for NPC column, dialog-tree column, and editor column

---

### 3. InlineChoiceEditor sub-list does not re-render on target-function structural changes
**Files:** `daedalus-dialog-editor/src/renderer/components/ActionCard.tsx` (memo comparator),
`daedalus-dialog-editor/src/renderer/components/InlineChoiceEditor.tsx`

Surfaced during fix-05 §2.5. `ActionCard`'s `React.memo` comparator intentionally
ignores `semanticModel` (a deliberate perf guard — the model is large and changes on
every edit). For a `Choice` action, that means when the choice's *target function*
changes structurally (e.g. its actions are reordered) but the `ChoiceAction` itself is
unchanged, the `ActionCard` — and therefore the nested `InlineChoiceEditor` — does not
re-render, so the sub-list shows a stale order. Drag reorder inside a choice sub-list
dispatches and commits correctly (verified: the move handler runs with the right
source/dest under the single hoisted `DragDropContext`), but the UI does not reflect it.

This is pre-existing (not introduced by the context hoist) and out of scope for slice 5.
Fix option: have `InlineChoiceEditor` subscribe to its target function directly from the
store (a granular selector) instead of reading it from the memo-stale `semanticModel`
prop, so it re-renders on target-function changes without re-rendering all `ActionCard`s.
The fix-05 Playwright spec asserts the choice sub-list joins the single context and lifts
a drag; the visible-reorder assertion is deferred to this fix.

---

### 4. Native parser isolation — survive a hard tree-sitter crash (SIGSEGV)
**Files:** `daedalus-dialog-editor/src/main/services/ParserService.ts`,
`daedalus-dialog-editor/src/main/workers/parser.worker.ts`,
`daedalus-dialog-editor/src/main/workers/metadata.worker.ts`

Documented as the "Known limitation: native SIGSEGV" in
[`architecture/worker-reliability.md`](./architecture/worker-reliability.md). The parser
pools run tree-sitter in Node `worker_threads`, which are threads in the **same** process.
A hard native crash (SIGSEGV/abort) inside tree-sitter kills the entire Electron main
process — no `error`/`exit` event fires, so the slice-3 restart-with-replacement machinery
cannot help. Slice 3's defenses cover only the recoverable modes (JS exceptions escaping
the worker, OOM via `resourceLimits`, self-exit, timeout hangs); slice 8 added crash
*visibility* (`render-process-gone`/`child-process-gone` handlers + `LogService`) but not
recovery. So a malformed input that segfaults the native parser takes down the whole app.

Not a worker-reliability bug — an architecture boundary. Fix option: move the native
parser out of the main process into an isolated **`utilityProcess`** (or `child_process`),
so a native crash kills only that child and the existing pool can respawn it, instead of
`worker_threads` sharing the main process's fate. Larger effort (new process boundary + IPC
serialization for parse requests/results); deferred until a real segfault is observed in
practice. Note the NAPI `npmRebuild: false` invariant still applies to whatever process
loads the addon.

---

### 5. The world payload types live on both sides of the boundary
**Files:** `daedalus-dialog-editor/src/shared/worldTypes.ts`,
`zen-world/src/model/`

`VobIndex` is defined in `zen-world` and re-exported by the editor
(`worldTypes.ts:6-8`); `WaynetPayload` is defined in the editor instead
(`worldTypes.ts:62-73`), even though both are shapes the binding emits and the
domain reasons about. The split is historical, not designed.

Noticed while adding `MoveWaypoint` (2026-08-27) and deliberately not fixed
there: the op needed no cross-package type at all once its factory took the
payload's own columns — `(positions, names, waypoint, to)` — so moving
`WaynetPayload` would have been adjacent refactoring the change did not need.

It starts to cost something at the waypoint gizmo slice, where the renderer, the
store and the op model all handle waypoints and only two of the three can name
the type. Fix direction: `WaynetPayload` moves to `zen-world` beside `VobIndex`
and the editor re-exports it, matching what already happened for the VOB index.
Small, but it touches every waynet import, so it wants its own commit.
