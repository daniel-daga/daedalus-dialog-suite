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
