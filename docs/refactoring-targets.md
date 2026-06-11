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

### 3. History snapshots — avoid full deep clones
**File:** `daedalus-dialog-editor/src/renderer/store/historyStore.ts`,
`.../utils/historyUtils.ts`

Each edit deep-clones the entire semantic model (up to `MAX_HISTORY_SIZE` = 50
per file). Since models are treated as immutable, structural sharing (storing
references instead of clones) would cut memory and CPU, but needs a dedicated
test pass for aliasing safety.
