# Undo / Redo Architecture Plan

## 1. Problem Statement

The Daedalus Dialog Editor has **two distinct editing surfaces** that need undo/redo support:

| Surface | Current undo/redo | Mutation path |
|---|---|---|
| **Dialog Detail Editor** (left-panel action list: add/delete/reorder/edit dialog lines, conditions, properties) | **None** | `useDialogEditorCommands` / `useActionManagement` -> `fileStore.updateFunction`, `updateDialog`, `updateDialogWithNormalizedProperties`, etc. |
| **Quest Graph Editor** (node-graph canvas: add transitions, set conditions, move nodes) | **Exists** via `historyStore` | `QuestEditingService` -> `executeQuestGraphCommand` -> `historyStore.applyQuestModelWithHistory` |

Autosave (`useAutoSave`) persists every dirty file to disk after a 2-second debounce. Because of this, **disk state cannot serve as a recovery point** — we must track undo history in-memory at the semantic-model level before saves happen.

### Goal

Provide unified undo/redo for the **Dialog Detail Editor** surface, using the same history infrastructure that already exists for the Quest Graph Editor. The user presses **Ctrl+Z / Ctrl+Y** (or toolbar buttons) and the editor reverses or replays their most recent logical editing operation.

---

## 2. Current Architecture (Summary)

### Stores (Zustand + Immer)

```
fileStore          — owns openFiles Map<filePath, FileState>
                     FileState.semanticModel is the source of truth
                     all mutation methods (updateModel, updateDialog, updateFunction, …)
                     set isDirty = true so autosave picks it up

historyStore       — owns questHistory Map<filePath, {past, future}>
                     snapshot = clone of SemanticModel + quest node positions
                     applyQuestModelWithHistory: push snapshot, then call fileStore._applyHistoryModelUpdate
                     undoQuestModel / redoQuestModel: pop/push snapshot stacks

storeSync          — subscribes to fileStore, mirrors model changes to projectStore
```

### Mutation Flow (Dialog Detail Editor — no history today)

```
User types in ActionCard
  -> useActionManagement.updateAction()
  -> setFunction() (from useDialogEditorCommands)
  -> fileStore.updateFunctionWithUpdater()
  -> Immer draft: mutate semanticModel, isDirty = true
  -> autosave picks up isDirty after 2s debounce -> writes to disk
```

### Mutation Flow (Quest Graph — has history today)

```
User drags edge in QuestFlow
  -> QuestEditingService.executeCommand()
  -> executeQuestGraphCommand() -> returns { updatedModel }
  -> historyStore.applyQuestModelWithHistory(filePath, updatedModel)
      1. Snapshot current model into `past` stack
      2. Call fileStore._applyHistoryModelUpdate(filePath, newModel) -> isDirty = true
  -> autosave picks up isDirty after 2s debounce -> writes to disk
```

---

## 3. Design Decisions

### 3.1 Snapshot Granularity: Full SemanticModel Snapshots (not deltas)

**Decision**: Continue using full SemanticModel clones as snapshots, matching the existing `historyStore` approach.

**Rationale**:
- SemanticModel for a single `.d` file is typically small (a few KB of JSON).
- `structuredClone` is fast enough for this size.
- Delta-based approaches (operational transforms, JSON patches) add complexity with no measurable gain at this scale.
- A capped stack (e.g. 50 entries) bounds memory usage to ~50 * fileSize, which is negligible.

### 3.2 History Scope: Per-File, Unified Across Surfaces

**Decision**: A single undo/redo stack per file, shared between dialog editing and quest editing.

**Rationale**:
- A user editing dialog properties and then immediately undoing expects to reverse **that** action, regardless of which panel it was in.
- Two separate stacks per file would create confusing UX ("I pressed undo but nothing happened in the panel I'm looking at").
- The existing `historyStore.questHistory` Map already stores per-file stacks. We will reuse and generalize it.

### 3.3 Where to Intercept: Store-Level Middleware, Not Component-Level

**Decision**: Introduce a thin `withHistory` wrapper that intercepts mutations at the `fileStore` level, rather than requiring each component/hook to explicitly push history.

**Rationale**:
- There are **many** mutation entry points: `updateFunction`, `updateFunctionWithUpdater`, `updateDialog`, `updateDialogWithUpdater`, `updateDialogWithNormalizedProperties`, `renameFunction`, `updateDialogConditionFunction`, `replaceDialogConditionFunction`, `updateModel`.
- Wrapping each call site is error-prone (missed call sites = silent history gaps).
- A store-level approach captures all mutations uniformly.

### 3.4 Coalescing Rapid Edits

**Decision**: Coalesce rapid mutations within a short time window (300ms) into a single undo step.

**Rationale**:
- Typing a dialog line fires `updateAction` on every keystroke (or on blur, depending on the text field implementation).
- Without coalescing, pressing undo would step through each character — unusable.
- The timer-based approach is simple and covers most interaction patterns (typing, rapid property changes).

### 3.5 Interaction with Autosave

**Decision**: Undo/redo operates on the in-memory `SemanticModel`; autosave continues to save whatever the current model is. Undoing does **not** restore disk state — it restores model state and re-triggers autosave.

**Rationale**:
- The autosave system already handles "save whatever isDirty points to". After an undo, the model changes and isDirty becomes true, so autosave naturally picks up the reverted model.
- No changes to `useAutoSave` are required.

---

## 4. Proposed Architecture

### 4.1 Generalize `historyStore` into a Unified History Manager

Rename the concept from "quest history" to "edit history" and make it serve both surfaces.

```
historyStore (generalized)
├── editHistory: Map<filePath, { past: Snapshot[], future: Snapshot[] }>
├── pushSnapshot(filePath)          — capture current model, push to past, clear future
├── undo(filePath)                  — pop past -> current, push current -> future
├── redo(filePath)                  — pop future -> current, push current -> past
├── canUndo(filePath) / canRedo(filePath)
├── coalescingTimers: Map<filePath, NodeJS.Timeout>
├── MAX_HISTORY_SIZE: 50
│
│   (Quest-specific additions remain)
├── questNodePositions: Map<...>    — unchanged
├── questBatchHistory: { past, future } — unchanged (for multi-file quest ops)
```

**Snapshot type** (extended from existing `QuestHistorySnapshot`):

```ts
interface EditSnapshot {
  model: SemanticModel;                           // deep clone
  nodePositions: Map<string, QuestNodePositionMap>; // quest node positions at that point
  timestamp: number;                              // for coalescing
}
```

### 4.2 Intercept All fileStore Mutations

Add a **`pushHistory` method** to `historyStore` that captures a snapshot before a mutation is applied. Then modify the approach at the **call-site level** by introducing a `withHistory` higher-order function:

```ts
// historyStore additions

/**
 * Capture the current model as a snapshot and push it to the undo stack.
 * If the last snapshot was pushed < COALESCE_MS ago for the same file,
 * skip the push (the previous snapshot already covers this burst of edits).
 */
pushSnapshot(filePath: string): void {
  const fileState = useFileStore.getState().openFiles.get(filePath);
  if (!fileState) return;

  const now = Date.now();
  const history = get().editHistory.get(filePath);
  const lastTimestamp = history?.past[history.past.length - 1]?.timestamp ?? 0;

  if (now - lastTimestamp < COALESCE_MS) {
    // Coalesce: don't push a new snapshot; the existing one covers this burst.
    // But DO clear the future stack (new edit branch).
    set(state => {
      const h = state.editHistory.get(filePath);
      if (h) h.future = [];
    });
    return;
  }

  const snapshot: EditSnapshot = {
    model: cloneSemanticModel(fileState.semanticModel),
    nodePositions: cloneQuestNodePositionsForFile(get().questNodePositions.get(filePath)),
    timestamp: now,
  };

  set(state => {
    const h = state.editHistory.get(filePath) ?? { past: [], future: [] };
    h.past.push(snapshot);
    if (h.past.length > MAX_HISTORY_SIZE) h.past.shift(); // evict oldest
    h.future = [];
    state.editHistory.set(filePath, h);
  });
}
```

### 4.3 Wrapping fileStore Mutations

Rather than modifying every fileStore method, we create **wrapper functions** that components call instead of calling fileStore directly:

```ts
// Example: a "history-aware" version of updateFunction
function updateFunctionWithHistory(filePath: string, functionName: string, func: DialogFunction) {
  useHistoryStore.getState().pushSnapshot(filePath);
  useFileStore.getState().updateFunction(filePath, functionName, func);
}
```

This can be generalized with a helper:

```ts
/**
 * Wrap any fileStore mutation so it pushes a history snapshot first.
 * The wrapper has the same signature as the original method.
 */
function withHistory<Args extends [string, ...unknown[]]>(
  method: (...args: Args) => void
): (...args: Args) => void {
  return (...args: Args) => {
    const filePath = args[0]; // first arg is always filePath
    useHistoryStore.getState().pushSnapshot(filePath);
    method(...args);
  };
}
```

**Where to expose these**: Add them as methods on `historyStore` itself, or export them from a new `historyActions.ts` module:

```ts
// renderer/store/historyActions.ts
export const updateFunction = withHistory(useFileStore.getState().updateFunction);
export const updateDialog = withHistory(useFileStore.getState().updateDialog);
export const updateFunctionWithUpdater = withHistory(useFileStore.getState().updateFunctionWithUpdater);
// ... etc for all mutation methods
```

### 4.4 Migrate Quest History to the Unified Stack

The existing `applyQuestModelWithHistory` already pushes a snapshot and applies a model update. Refactor it to use the same `pushSnapshot` + `_applyHistoryModelUpdate` flow, so quest and dialog edits share one stack per file.

The `questBatchHistory` (multi-file undo for cross-file quest operations) remains as a separate coordination layer on top — it records which files were part of a batch and calls per-file undo/redo in lockstep.

### 4.5 Keyboard Shortcuts and UI

#### Keyboard Shortcuts

Register global keyboard listeners (at the `MainLayout` or `App` level):

```ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
    const isRedo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey));

    if (!isUndo && !isRedo) return;

    const filePath = useFileStore.getState().activeFile;
    if (!filePath) return;

    e.preventDefault();
    if (isUndo) useHistoryStore.getState().undo(filePath);
    if (isRedo) useHistoryStore.getState().redo(filePath);
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

**Important**: The Monaco-based source code editor (`SourceCodeEditor.tsx`) has its own built-in undo/redo. The global handler must **not** intercept Ctrl+Z when the source editor is focused. Guard with a check like:

```ts
const activeElement = document.activeElement;
const isInMonaco = activeElement?.closest('.monaco-editor');
if (isInMonaco) return; // let Monaco handle it
```

#### Toolbar Buttons

Add Undo/Redo buttons to the `DialogDetailsEditor` toolbar (similar to how `QuestFlow` already has undo/redo buttons):

```tsx
<IconButton
  disabled={!canUndo}
  onClick={() => historyStore.undo(filePath)}
  title="Undo (Ctrl+Z)"
>
  <UndoIcon />
</IconButton>
<IconButton
  disabled={!canRedo}
  onClick={() => historyStore.redo(filePath)}
  title="Redo (Ctrl+Y)"
>
  <RedoIcon />
</IconButton>
```

---

## 5. Implementation Plan

### Phase 1: Generalize historyStore (Foundation)

**Files to modify:**
- `renderer/utils/historyUtils.ts` — Add `EditSnapshot` type (extending `QuestHistorySnapshot` with `timestamp`).
- `renderer/store/historyStore.ts` — Rename `questHistory` to `editHistory`. Add `pushSnapshot()`, generalized `undo(filePath)`, `redo(filePath)`. Keep quest batch operations. Add `MAX_HISTORY_SIZE` and `COALESCE_MS` constants.

**Migration**: The existing `applyQuestModelWithHistory` calls `pushSnapshot` internally, so `QuestFlow` continues to work without changes.

### Phase 2: Create History-Aware Mutation Wrappers

**New file:**
- `renderer/store/historyActions.ts` — Export wrapped versions of all fileStore mutation methods (`updateFunction`, `updateDialog`, `updateFunctionWithUpdater`, `updateDialogWithUpdater`, `updateDialogWithNormalizedProperties`, `renameFunction`, `updateDialogConditionFunction`, `replaceDialogConditionFunction`, `updateModel`).

### Phase 3: Wire Dialog Editor Components to Use History Wrappers

**Files to modify:**
- `renderer/components/hooks/useDialogEditorCommands.ts` — Import mutation functions from `historyActions` instead of directly from `useEditorStore`.
- `renderer/components/hooks/useActionManagement.ts` — The `setFunction` callback it receives comes from `useDialogEditorCommands`, so no direct changes needed here (history is pushed upstream).
- `renderer/components/hooks/useConditionUpdate.ts` — Same pattern: ensure the store mutations it calls go through history wrappers.
- `renderer/components/DialogDetailsEditor.tsx` — Pass history-wrapped mutations to child hooks.
- `renderer/components/DialogPropertiesSection.tsx` — If it calls store mutations directly, route through wrappers.
- `renderer/components/ConditionEditor.tsx` / `ConditionSection.tsx` — Same.

### Phase 4: Keyboard Shortcuts

**Files to modify:**
- `renderer/components/MainLayout.tsx` (or `App.tsx`) — Add global `keydown` listener for Ctrl+Z / Ctrl+Y with Monaco guard.

### Phase 5: Toolbar Buttons

**Files to modify:**
- `renderer/components/DialogDetailsEditor.tsx` — Add undo/redo `IconButton`s to the toolbar area, wired to `historyStore.undo/redo` and `canUndo/canRedo`.
- `renderer/components/QuestFlow.tsx` — Migrate existing undo/redo buttons to use the generalized `undo(filePath)` / `redo(filePath)` API (should be a rename).

### Phase 6: Testing

- **Unit tests** for `historyStore`: push, undo, redo, coalescing, max stack eviction, clear on file close, clear on source save.
- **Unit tests** for `historyActions`: verify snapshot is pushed before mutation is applied.
- **Integration tests**: simulate a sequence of dialog edits -> undo -> verify model state matches pre-edit state.
- **Manual testing**: verify undo/redo with autosave (undo -> file saves reverted state), verify Monaco source editor undo is not intercepted.

---

## 6. Edge Cases and Considerations

| Concern | Handling |
|---|---|
| **Autosave after undo** | Undo sets `isDirty = true`. Autosave picks it up and writes the reverted model. This is correct — disk should always reflect the current in-memory state. |
| **External file change (file watcher)** | When `FileWatcherService` detects an external change and reloads the file, clear the undo history for that file (same as current behavior for source saves). |
| **Source editor saves** | `saveSource` replaces the SemanticModel from parsed code. The existing subscription already clears history when `originalCode` changes + `isDirty=false`. No changes needed. |
| **File close / session reset** | Existing subscription cleans up history. No changes needed. |
| **Coalescing vs. discrete operations** | Typing in a text field → coalesce. Discrete operations (add action, delete action, reorder) → each gets its own snapshot (they are >300ms apart in practice since they require a click). If needed, we can also support an explicit `pushSnapshot` call for operations that should always be a distinct undo step. |
| **Large models / memory** | Cap at 50 snapshots per file. With ~10KB per model, that's ~500KB per file. With 5 files open, ~2.5MB total. Acceptable. |
| **Quest batch undo across files** | Unchanged. `questBatchHistory` records groups of filePaths. Per-file undo is applied for each file in the batch. |

---

## 7. Sequence Diagram

```
User types in a dialog line text field
  │
  ├─> onBlur / onChange fires
  │     │
  │     └─> useActionManagement.updateAction()
  │           │
  │           └─> setFunction() [from useDialogEditorCommands]
  │                 │
  │                 └─> historyActions.updateFunctionWithUpdater()
  │                       │
  │                       ├─> historyStore.pushSnapshot(filePath)
  │                       │     ├─ Check coalesce timer
  │                       │     ├─ if elapsed > 300ms: clone model -> push to past[], clear future[]
  │                       │     └─ if elapsed < 300ms: just clear future[]
  │                       │
  │                       └─> fileStore.updateFunctionWithUpdater(filePath, name, updater)
  │                             └─ Immer draft: mutate semanticModel, isDirty = true
  │
  ├─ (2 seconds later) autosave detects isDirty
  │     └─> fileStore.saveFile() -> writes to disk
  │
  └─ User presses Ctrl+Z
        │
        └─> historyStore.undo(filePath)
              ├─ Pop last snapshot from past[]
              ├─ Push current model to future[]
              ├─ fileStore._applyHistoryModelUpdate(filePath, snapshot.model)
              │     └─ isDirty = true
              └─ (2 seconds later) autosave writes reverted model to disk
```

---

## 8. Summary of New/Modified Files

| File | Change |
|---|---|
| `renderer/utils/historyUtils.ts` | Add `EditSnapshot` type with timestamp |
| `renderer/store/historyStore.ts` | Generalize to unified edit history; add `pushSnapshot`, `undo`, `redo`, coalescing, max size |
| **`renderer/store/historyActions.ts`** (new) | History-aware wrappers for all fileStore mutation methods |
| `renderer/store/editorStore.ts` | No changes (barrel re-export stays the same) |
| `renderer/components/hooks/useDialogEditorCommands.ts` | Use history-wrapped mutations |
| `renderer/components/DialogDetailsEditor.tsx` | Add undo/redo toolbar buttons; pass history-wrapped mutations |
| `renderer/components/MainLayout.tsx` | Add global Ctrl+Z / Ctrl+Y keyboard handler with Monaco guard |
| `renderer/components/QuestFlow.tsx` | Migrate to generalized `undo/redo` API |
| `renderer/components/hooks/useConditionUpdate.ts` | Route store mutations through history wrappers |
| `renderer/components/DialogPropertiesSection.tsx` | Route store mutations through history wrappers |
| `renderer/components/ConditionEditor.tsx` | Route store mutations through history wrappers |
