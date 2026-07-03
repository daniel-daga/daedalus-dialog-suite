# Fix Plan 05 — Undo/Redo × Edit Debouncing

Source: [code-review-findings.md](./code-review-findings.md) §5 (U1, U3–U6) + state-review F-class findings (phantom undo steps, global batch-history reset on save). Tracker: [code-review-remediation.md](./code-review-remediation.md), slice 5.

Status: plan-ready (deep-dive verified 2026-07-02). **Plan only — no implementation yet.**

All paths below are relative to `daedalus-dialog-editor/` unless stated otherwise.

---

## 1. Scope & verified findings

| ID | Status | Summary | Location |
|----|--------|---------|----------|
| U1 | **Verified** | Quest batch history records only file paths, not which snapshot each batch pushed. Per-file undo and later dialog edits shift the per-file stacks; `undoLastQuestBatch` then pops *whatever is on top* of each member file — reverting a dialog edit while claiming to undo the quest batch, and leaving the actual quest edit applied with the batch entry consumed. Multi-file batches revert a mix of quest and dialog changes. Two existing tests **codify** this behavior (`tests/editorStore.questHistory.test.ts:222` "reverts the most recent state of that file"). | `src/renderer/store/historyStore.ts:315-355, 265-301`; `src/renderer/utils/historyUtils.ts:33-36` |
| U3 | **Verified** | `useConditionUpdate.handleUpdate` captures `index` and `updated` **lexically** in the 300 ms `setTimeout` (`useConditionUpdate.ts:34-40`) — the `indexRef` that exists in the hook is only used by the unmount flush, not by the timer. `ConditionCard`s are keyed by array index (`ConditionEditor.tsx:365`), so a deletion above a card with a pending edit reindexes content under the same mounted component. `ConditionCard`'s delete button (`ConditionCard.tsx:81`) has **no deletion guard**: no timer cancel, no ref sync. The unmount flush (`useConditionUpdate.ts:53-60`) always fires a pending update, and `ConditionEditor.updateCondition`'s `index === newConditions.length` branch (`ConditionEditor.tsx:90-92`) **appends** it — a deleted last condition with a pending edit is resurrected. ActionCard already solved every one of these with refs + guards (`ActionCard.tsx:79-108`). | `src/renderer/components/hooks/useConditionUpdate.ts`; `src/renderer/components/ConditionEditor.tsx:82-98, 363-376`; `src/renderer/components/ConditionCard.tsx:81` |
| U4 | **Verified** | The global Ctrl+Z handler (`MainLayout.tsx:55-76`) calls `historyStore.undo()` immediately. A pending 300 ms ActionCard/ConditionCard debounce timer then fires afterwards: depending on whether React has committed the post-undo prop-sync effect before the timer, it either re-applies the just-undone text as a new edit, or writes an identical model back — in both cases going through `historyActions` → `pushSnapshot`, which **clears the redo stack** (`historyStore.ts:214, 228`) and pushes a phantom step. Blur does not flush (`ActionCard.tsx:279-282` only clears `hasFocus`), and Ctrl+Z does not blur the field, so the race is the normal case, not an edge. | `src/renderer/components/MainLayout.tsx:55-76`; `src/renderer/components/ActionCard.tsx:79-102` |
| U5 | **Verified** | (a) `getActionIdentity` uses `action.id` for DialogLines (`ActionsList.tsx:36-37`) — duplicated `AI_Output` ids in real mod files produce duplicate React keys **and** duplicate `draggableId`s, which react-beautiful-dnd requires to be unique (drag targets the wrong card, reconciliation swaps card state). Non-DialogLine actions use `${type}:${index}` — reorder changes the key → unmount/remount mid-drag. (b) Every `ActionsList` mounts its own `DragDropContext` (`ActionsList.tsx:125`) and is rendered recursively: `ConditionalActionRenderer.tsx:135` (then/else branches) and `ChoiceRenderer.tsx:161` → `InlineChoiceEditor.tsx:116` nest contexts 2–3 deep inside the outer context's `Draggable`s — explicitly unsupported by react-beautiful-dnd. (c) **New:** `droppableId = actionPathToKey(pathPrefix) \|\| 'root'` (`ActionsList.tsx:110`) — the outer list and every InlineChoiceEditor list all use `'root'`; ids collide the moment contexts are unified. | `src/renderer/components/ActionsList.tsx:36-37, 110, 125, 137`; `actionRenderers/ConditionalActionRenderer.tsx:135`; `InlineChoiceEditor.tsx:116` |
| U6 | **Interaction only** | `tests/ConditionSaving.test.tsx:20` skipped `[BUG DEMO]`: stale-`semanticModel` closures in the save path lose condition edits. Root cause is **slice 2** (save pipeline). Interaction owned here: the U4 flush registry must also be invoked at save entry, otherwise a save within 300 ms of typing serializes the model *without* the pending debounced edit — slice 2's fix is incomplete without it. | `tests/ConditionSaving.test.tsx:20` |
| F-A | **New (verified)** | Phantom undo steps: `withHistory` pushes a snapshot **before** delegating (`historyActions.ts:29-33`), but every fileStore mutation has silent no-op exits — missing dialog/function, updater returning `null` (`fileStore.ts:302-325, 363-386, 563-595`). The pushed snapshot is identical to current state → one Ctrl+Z press is consumed doing nothing, and `pushSnapshot` unconditionally wipes `future` → **redo destroyed by a no-op**. The coalescing path (`historyStore.ts:209-216`) also wipes `future` without pushing. | `src/renderer/store/historyActions.ts:26-34`; `src/renderer/store/fileStore.ts` no-op guards |
| F-B | **New (verified)** | Global batch-history reset on single-file save: the fileStore subscription calls `resetBatchHistory()` whenever **any one** file's source is saved (`historyStore.ts:495-506`, triggered by `saveSource` changing `originalCode`) — quest batch undo for *all other files* is wiped. `clearHistoryForFile(filePath)` on the line above already removes batches containing the saved file; the global reset is both redundant and wrong. | `src/renderer/store/historyStore.ts:494-506` |

Corrected vs. the review: U1's claim "permanently desync history from state" is accurate, but note the desync is currently *test-codified as intended* (`editorStore.questHistory.test.ts:222`) — the fix is a deliberate behavior change, and that test must be rewritten, not merely made green.

---

## 2. Fix design

### 2.1 U1 + F-B — Batch entries record snapshot identity; batch undo validates before acting

**Decision: keep the per-file unified stacks as the single source of truth; make quest batch entries reference the exact snapshots they pushed, via monotonic snapshot ids, and validate at read time.**

Changes:

- `src/renderer/utils/historyUtils.ts`
  - `EditSnapshot` gains `id: number` (module-level monotonic counter, assigned in `createEditSnapshot`).
  - `QuestBatchHistoryState` becomes `{ past: BatchEntry[]; future: BatchEntry[] }` with `BatchEntry = Array<{ filePath: string; snapshotId: number }>`.
- `src/renderer/store/historyStore.ts`
  - `applyQuestModelsWithHistory` / `applyQuestNodePositionWithHistory`: record `{ filePath, snapshotId }` of each snapshot pushed by `pushUncoalescedSnapshot`.
  - `undoLastQuestBatch`: a batch entry is **valid** only if, for every member, `past[top].id === entry.snapshotId`. Invalid entries (a member file got a newer dialog edit, its snapshot was consumed by per-file undo, evicted by `MAX_HISTORY_SIZE`, or cleared on save/close) are pruned lazily; undo acts only on a valid top entry.
  - `canUndoLastQuestBatch` performs the same validity check (after pruning), so the QuestFlow toolbar button (`QuestFlow.tsx:678`) disables as soon as atomic batch undo becomes ill-defined — instead of silently reverting the wrong edits.
  - On batch undo, record the ids of the snapshots placed at each member's `future[0]` into the batch **future** entry; `redoLastQuestBatch`/`canRedoLastQuestBatch` validate `future[0].id` symmetrically (a new edit that clears a member's `future` invalidates batch redo).
  - Remove `resetBatchHistory()` from the save-detection branch of the fileStore subscription (F-B). `clearHistoryForFile` already removes batches containing the file; with id-validation this is belt-and-braces. The all-files-closed `resetBatchHistory()` call becomes redundant (each removed file already clears its batches) — remove the call and, if then unreferenced, the method.

Alternatives considered (record the decision in `docs/architecture/` when the slice lands):

1. **Single global history stack with typed entries** (`dialog-edit | quest-batch | node-move`, each entry holding per-file before/after models). Fully desync-proof by construction, but: changes Ctrl+Z scoping from per-file to cross-file (surprising in a file-based editor), makes `clearHistoryForFile` on save/close ill-defined for entries spanning saved + unsaved files, invalidates the entire per-file test suite (`historyStore.editHistory.test.ts`), and collides with slice 4's planned rework of the quest apply path. Rejected for blast radius; revisit only if slice 4 concludes multi-file quest editing needs cross-file undo as a product behavior.
2. **Batch entries recording stack depths** instead of ids. Rejected: depths shift under `MAX_HISTORY_SIZE` eviction (`past.shift()`) and `clearHistoryForFile`; ids are eviction-proof and O(1) to validate.
3. **Status quo** ("batch undo pops whatever is on top", as codified by the existing test). Rejected: it is the bug.

Behavior change to document in the PR and in `docs/reference/`: after a member file receives a newer edit, the quest batch undo button disables; per-file Ctrl+Z remains available for everything. Size: **M**.

### 2.2 F-A — No phantom snapshot when the mutation no-ops

Make the snapshot push transactional in `historyStore`:

- `src/renderer/store/historyStore.ts`: add `pushSnapshotTransactional(filePath, mutate: () => void)` (name bikesheddable): capture the pre-state (`past`/`future` array refs and the current `semanticModel` reference), run `pushSnapshot` + `mutate()`, then compare `useFileStore.getState().openFiles.get(filePath)?.semanticModel` by **reference** against the captured model. Unchanged reference ⇒ the mutation no-opped ⇒ restore the captured `past`/`future` (this also un-does the coalescing path's `future = []` wipe). Reference equality is sound because fileStore is Immer-produced: any real change yields a new model object (documented at `historyStore.ts:75-81`).
- `src/renderer/store/historyActions.ts`: `withHistory` delegates through the transactional API instead of bare `pushSnapshot` + call.

Note: this does **not** catch "semantically identical but newly-allocated" updates (e.g. `updateAction` always spreads). That residual case only matters in the U4 race, which 2.3 removes at the source. Size: **S**.

### 2.3 U4 (+ U6 interaction) — Flush pending debounces before undo/redo (registry)

**Decision: flush, don't cancel.** Cancelling pending timers on undo silently discards the user's newest keystrokes with no redo path (data loss). Flushing commits the in-flight text as a normal history step first, so the *first* Ctrl+Z reverts the in-flight typing and redo can restore it — standard editor semantics.

- New module `src/renderer/utils/pendingEditFlushRegistry.ts` (~20 lines): `Set<() => void>` with `registerPendingEditFlusher(fn): () => void` (returns unregister) and `flushAllPendingEdits()`.
- `src/renderer/components/ActionCard.tsx`: register one stable flusher on mount (unregister on unmount) that no-ops unless `updateTimerRef.current` is set, otherwise clears the timer and applies `updateActionRef.current(pathRef.current, localActionRef.current)` — i.e., exactly the existing timer body, so flush and natural fire are byte-identical.
- `src/renderer/components/hooks/useConditionUpdate.ts`: same pattern (after 2.4's ref port, the timer body is also ref-resolved).
- `src/renderer/components/MainLayout.tsx:69`: call `flushAllPendingEdits()` before `undo`/`redo` in the keydown handler.
- `src/renderer/components/QuestFlow.tsx:703`: call it before `undoLastQuestBatch`/`redoLastQuestBatch` (a dialog-surface pending edit on a member file must not fire mid-batch-undo).
- **Slice 2 handoff (U6):** the save entry points (`saveFile` callers, auto-save tick) must call `flushAllPendingEdits()` before serializing the model, otherwise saves within 300 ms of typing lose the pending edit. This plan provides the registry; slice 2 wires the save path and un-skips/rewrites `tests/ConditionSaving.test.tsx`.

Rejected alternatives: (a) cancel timers on undo — data loss, see above; (b) have `historyStore.undo` itself flush — the store layer must not know about component debounce internals; callers (keyboard handler, toolbar, save) invoke the UI-layer registry. Size: **S** (registry + 4 call sites), given the flusher bodies already exist as `flushUpdate`.

### 2.4 U3 — Port the ActionCard ref pattern to conditions

Stage 1 (mandatory, fixes corruption + resurrection):

- `src/renderer/components/hooks/useConditionUpdate.ts`
  - `handleUpdate`'s timer resolves values at fire time: `updateConditionRef.current(indexRef.current, localConditionRef.current)` (mirrors `ActionCard.tsx:79-85`). Same for a pending flush via the registry (2.3).
  - Add a `conditionRef` synced from the `condition` prop, and guard the unmount flush with `!shallowEqual(localConditionRef.current, conditionRef.current)` (mirrors `ActionCard.tsx:89-102`, reusing `src/renderer/utils/shallowEqual.ts`).
  - Expose `markDeleted()`: clears the timer and syncs `conditionRef.current = localConditionRef.current` (mirrors `ActionCard.handleDelete`, `ActionCard.tsx:104-108`).
- `src/renderer/components/ConditionCard.tsx:81`: delete button calls `markDeleted()` before `deleteCondition(index)`.
- `src/renderer/components/ConditionEditor.tsx:90-92`: **remove the `index === newConditions.length` append branch** in `updateCondition`. It exists for no add flow (`addCondition` writes via `onUpdateFunction` directly) and is the resurrection vector. Out-of-range updates become no-ops (and with 2.2, push no phantom snapshot).

Outcome of stage 1: a delete during a pending edit can no longer write to the wrong slot or resurrect the deleted condition. Residual (accepted for stage 1): with index keys, deleting a condition *above* one with a pending edit re-syncs the shifted-in condition into the mounted card before the timer fires, so the ≤300 ms in-flight keystrokes are dropped rather than applied — safe, but lossy. Size: **S**.

Stage 2 (correctness of the residual case — do together with 2.5's key work):

- `src/renderer/components/ConditionEditor.tsx`: key `ConditionCard`s by a stable synthetic identity instead of `key={idx}`. Conditions have no ids and `sanitizeCondition` strips extra fields, so keep a parallel `uiIds: string[]` in a ref, mutated in the exact same handlers that mutate the array (`addCondition` pushes, `deleteCondition` splices; reset when `conditionFunction.name` changes or the lengths diverge from any known operation, e.g. after undo). Keys = `uiIds[idx]`. With identity keys, the card owning the pending edit keeps its condition across a deletion above it, its `index` prop shifts (kept current by `indexRef`), and the fire-time write lands on the right condition. Size: **M**.

### 2.5 U5 — Key stability, duplicate ids, single DragDropContext

- **Duplicate `action.id`** — `src/renderer/components/ActionsList.tsx:36-37, 134-137`: compute keys/draggableIds via a `useMemo` over `actions` that counts occurrences and disambiguates repeats (`id`, `id@2`, `id@3`, …). Stable for a given list content, unique always. Non-DialogLine actions keep `${type}:${index}` for now (their reorder-remount is already guarded by ActionCard's unmount flush; a full synthetic-identity scheme for all actions is deliberately out of scope — note in `docs/refactoring-targets.md` if desired).
- **Nested `DragDropContext`** — hoist to a single context per dialog-editing pane:
  - `src/renderer/components/DialogActionsSection.tsx`: render the one `DragDropContext`; its `onDragEnd` dispatches by `result.source.droppableId` through a small React context (`DragDispatchContext`) in which every descendant `ActionsList` registers `droppableId → moveAction(pathPrefix, …)` on mount. Reject drops where `source.droppableId !== destination.droppableId` (cross-list moves stay unsupported, as today).
  - `src/renderer/components/ActionsList.tsx`: drop its own `DragDropContext`, keep `Droppable`; register/unregister its handler with `DragDispatchContext`.
  - **Fix the `droppableId` collision first** (`ActionsList.tsx:110`): namespace as `${dialogContextName-or-target-function}:${actionPathToKey(pathPrefix) || 'root'}`; `InlineChoiceEditor.tsx` passes its `targetFunctionName` so choice sub-lists are unique — its `moveAction` targets a *different function*, which is exactly why dispatch must be a registry, not path parsing.
- Optional (flag for the team, not required by this slice): react-beautiful-dnd is archived/unmaintained; `@hello-pangea/dnd` is a maintained drop-in. If adopted, do it in this slice since all DnD tests are being (re)written anyway.

Size: **M** (keys S, context hoist M; combined with stage-2 condition keys this is the riskiest UI change of the slice).

---

## 3. Test plan (failing tests first — repo TDD rule)

Jest, written to fail against current code before each fix:

1. `tests/useConditionUpdate.interleave.test.tsx` (fake timers) — for 2.4:
   - Edit condition #2, then delete condition #0 within the 300 ms window → after timers run, no condition holds another condition's content; the deleted condition does not reappear. *(fails today: lexical index writes to the wrong slot)*
   - Delete the **last** condition while it has a pending edit → conditions length shrinks by one and stays shrunk after timers. *(fails today: unmount flush + append branch resurrects it)*
   - Stage 2: the pending edit **survives** a deletion above it and lands on the same logical condition. *(fails after stage 1 — drives stage 2 keys)*
2. `tests/pendingEditFlush.test.tsx` — for 2.3 (render ActionCard/dialog surface, fake timers, dispatch `window` keydown Ctrl+Z as `MainLayout` listens):
   - Type into a DialogLine, press Ctrl+Z within 300 ms → first undo reverts the in-flight text; Ctrl+Y restores it; the redo stack is not wiped by a late timer. *(fails today: pending timer re-applies/pushes after undo and clears `future`)*
   - After flush+undo, advancing timers produces no additional history step (no phantom echo).
3. `tests/historyActions.noop.test.ts` — for 2.2:
   - `updateDialogWithUpdater` whose updater returns `null` (and `updateFunction` on a missing function): `canUndo` unchanged, existing `future` **preserved**. *(fails today: phantom past entry + future wiped)*
4. `tests/historyStore.batchValidity.test.ts` — for 2.1 (replaces the codified-bug tests; explicitly rewrite `tests/editorStore.questHistory.test.ts:222` and audit `:135`):
   - Quest batch over files A+B, then a dialog edit (`pushSnapshot` + `_applyHistoryModelUpdate`) on A → `canUndoLastQuestBatch()` is false; `undoLastQuestBatch()` is a no-op; A's dialog edit and both quest edits remain undoable per-file. *(fails today: reverts A's dialog edit + B's quest edit, consumes the batch)*
   - No interleaving → batch undo restores exactly the pre-batch models of A and B; batch redo restores both.
   - Per-file `undo(A)` that consumes A's batch snapshot invalidates the batch entry (`canUndoLastQuestBatch()` false).
   - After batch undo, a new edit on B clears B's `future` → `canRedoLastQuestBatch()` false.
5. `tests/historyStore.editHistory.test.ts` (extend) — for F-B: two files with quest batches; `saveSource`-shaped state transition on file A (change `originalCode`, `isDirty=false`) → batches containing only B survive. *(fails today: global `resetBatchHistory`)*
6. `tests/ActionsList.test.tsx` (extend) — for 2.5 keys: render a list containing two DialogLines with identical `id` → rendered `Draggable`s have unique `draggableId`s / no duplicate-key warnings; keys stable across an unrelated re-render.

Playwright (`tests/e2e/`) — required where jsdom cannot exercise the behavior; per repo rules, verify each spec drives the real UI:

- **Drag-and-drop reorder** (2.5): react-beautiful-dnd pointer drags don't work under jsdom. One spec covering: reorder in the top-level list, reorder **inside a ConditionalAction branch**, and reorder inside an **InlineChoiceEditor** — all under the single hoisted context (use rbd keyboard DnD: focus drag handle, Space to lift, arrows, Space to drop — far more stable than mouse paths).
- **Ctrl+Z within 300 ms of typing** (2.3): type into a dialog line, press Ctrl+Z immediately, assert the text reverts and stays reverted; Ctrl+Y restores. Jest covers the store mechanics; the E2E guards the real focus/keydown routing (Monaco exclusion branch at `MainLayout.tsx:62-64`).
- Quest batch + dialog edit interleave is fully covered at store level (Jest #4); the quest-surface E2E depends on slice 4 making the quest UI reachable in production (Q1/Q2) — do not block this slice on it; add the toolbar-disabled assertion to slice 4's E2E checklist.

---

## 4. Ordering, dependencies, risks

Order within the slice (each step lands green before the next):

1. **2.2 phantom-undo transaction (S)** — foundation; later tests assert clean stacks.
2. **2.4 stage 1 condition ref-port (S)** — highest user-facing corruption risk, smallest fix.
3. **2.3 flush registry (S)** — depends on 2.4's ref-resolved timer body for conditions.
4. **2.1 batch snapshot ids + validity, incl. F-B (M)**.
5. **2.5 keys + single DragDropContext, with 2.4 stage 2 (M/L)** — riskiest, last.

Cross-slice coordination:

- **Slice 4 (quest editor):** U1's `BatchEntry` shape and validity semantics must be agreed with slice 4 before it reworks `applyQuestModelsWithHistory` call sites / guardrail enforcement (Q4). Land 2.1 first and have slice 4 consume it, or land both on slice 4's branch — do not implement divergent batch mechanisms twice. U2 (snapshot memory, `structuredClone` per command) stays in slice 4; nothing here worsens it (snapshots remain by-reference).
- **Slice 2 (save pipeline):** owns U6's root cause and the save-entry `flushAllPendingEdits()` call (2.3); the skipped `tests/ConditionSaving.test.tsx` is un-skipped there. This slice must not silently "fix" it — note the dependency in the slice-2 plan when wiring.

Risks:

- **Deliberate behavior change (2.1):** quest batch undo disables after a member file diverges instead of reverting something. Two existing tests codify the old behavior and must be rewritten (`editorStore.questHistory.test.ts:222`, audit `:135`) — call this out in review so it isn't mistaken for a regression.
- **Key-stability changes touch drag-and-drop (2.5):** hoisting the context changes rbd's event ownership for nested lists; duplicate-id disambiguation changes keys for affected files (remount → focus loss risk; focus is path-based via `registerActionRef`, not key-based, so exposure is limited — verify via the Playwright reorder spec).
- **Flush-before-undo (2.3)** makes the first Ctrl+Z after typing revert the in-flight burst; with `COALESCE_MS` the flush merges into the typing burst's step, so no extra keypress is normally needed — assert this in Jest #2 to prevent a "two undos per edit" regression.
- `uiIds` side-table (2.4 stage 2) must reset correctly across undo/redo of condition add/delete — covered by Jest #1; if it proves fiddly, ship stage 1 alone (safe, lossy-by-≤300 ms) and file stage 2 in `docs/refactoring-targets.md`.

## 5. Size summary

| Fix | Size |
|-----|------|
| 2.2 Phantom-undo transactional push (F-A) | S |
| 2.4 stage 1 Condition ref-port + append-branch removal (U3) | S |
| 2.3 Pending-edit flush registry (U4, U6 interaction) | S |
| 2.1 Batch snapshot ids + validity + save-wipe removal (U1, F-B) | M |
| 2.5 Keys/draggableIds + single DragDropContext (U5) + 2.4 stage 2 identity keys | M–L |

Definition of done (per tracker working agreement): all new Jest tests green, Playwright reorder + Ctrl+Z specs green and manually verified to drive the real UI, `npm test` + `npm run typecheck` clean in `daedalus-dialog-editor/`, behavior change of batch undo documented in `docs/reference/`, and this plan file deleted with durable decisions (unified-history model, flush-registry contract) extracted to `docs/architecture/`.
