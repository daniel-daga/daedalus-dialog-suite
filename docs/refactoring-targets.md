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

### 3. Quest domain layer — physically move logic out of the UI tree
**Files:** `daedalus-dialog-editor/src/renderer/quest/domain/*`,
`.../components/QuestEditor/*`, `.../types/questGraph.ts`

The `quest/domain/*` modules are currently re-export shims pointing back into
`components/QuestEditor/*` (see `docs/architecture/quest-editor.md`). To make the
documented one-way layering physically true:

- Move the pure pipeline/command/guardrail/analysis logic into `quest/domain/*`.
- Remove the `reactflow` dependency from the domain by defining editor-owned
  graph node/edge types (replacing `reactflow`'s `Node`/`Edge` in
  `types/questGraph.ts` and `MarkerType` in `questEdgeBuilding.ts`).

---

### 4. History snapshots — avoid full deep clones
**File:** `daedalus-dialog-editor/src/renderer/store/historyStore.ts`,
`.../utils/historyUtils.ts`

Each edit deep-clones the entire semantic model (up to `MAX_HISTORY_SIZE` = 50
per file). Since models are treated as immutable, structural sharing (storing
references instead of clones) would cut memory and CPU, but needs a dedicated
test pass for aliasing safety.

---

### 5. `properties.information`/`condition` string-vs-object union
**Files:** parser model types + `daedalus-dialog-editor/src/renderer/**`

The dialog property references are sometimes a plain string and sometimes a
`{ name }` object, forcing `as any` / `resolveFunctionRef` casts at many call
sites. Encode the union once in the model types (parser + editor) instead.
