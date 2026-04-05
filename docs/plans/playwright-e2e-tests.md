# Plan: Playwright E2E Test Coverage

**Date:** 2026-04-05
**Scope:** daedalus-dialog-editor
**Status:** Draft

---

## Objective

Ensure all major features of the Dandelion dialog editor have Playwright E2E test coverage. The app runs in browser mode with a mock `editorAPI` backed by `localStorage`, making it well-suited for fast, isolated Playwright tests without Electron.

---

## Current State

### Existing test files (25 tests total)

| File | Coverage Area | Tests |
|------|--------------|-------|
| `file-opening.spec.ts` | Welcome screen, open single file, NPC/dialog selection, mock API detection | 8 |
| `dialog-editing.spec.ts` | Edit dialog lines, add lines, typing preservation, unsaved-changes chip, multi-edit stability | 7 |
| `dialog-creation.spec.ts` | Create new NPC in project mode, dedicated per-NPC file creation | 1 |
| `project-mode-editing.spec.ts` | Open project folder, select dialog from tree, add line via button & Enter key | 2 |
| `dialog-focus.spec.ts` | Focus behavior: Enter, Shift+Enter, Add Line button, "+" insert between actions | 4 |
| `node-editor.spec.ts` | Node editor playground: quest switching, entry surfaces, semantic condition types | 3 |

### Infrastructure

- **Config:** `playwright.config.ts` — Chromium only, `dev:browser` web server on port 5173
- **Fixture data:** `tests/fixtures/sample-dialog.d`
- **Mock API:** Browser-mode mock backed by `localStorage` keys prefixed `mockapi_file_`
- **Test commands:** `npm run test:e2e`, `test:e2e:ui`, `test:e2e:headed`, `test:e2e:debug`

---

## Gap Analysis

Features with **no** E2E coverage, ordered by user impact:

### High Priority (Core Editing)

1. **Dialog Properties Editing** — `DialogPropertiesSection.tsx`
   - Expand/collapse properties panel
   - Edit NPC name, `nr` (priority), `important` flag, `permanent` flag, `description`
   - Verify changes reflected in unsaved-changes state

2. **Choice / Branch Creation & Editing** — `InlineChoiceEditor.tsx`, `ChoiceRenderer.tsx`
   - Click "Add Choice" button to create a choice branch
   - Edit choice description text
   - Add dialog lines inside a choice branch
   - Navigate choice tree structure

3. **Action Deletion** — `ActionDeleteButton.tsx`, `DeleteConfirmDialog.tsx`
   - Delete a dialog line via the delete button
   - Confirm deletion in the confirmation dialog
   - Verify action count decreases and remaining actions are intact

4. **Undo / Redo** — `historyStore.ts`, `DialogDetailsEditor.tsx`, `MainLayout.tsx`
   - Undo button in editor toolbar
   - Redo button in editor toolbar
   - Ctrl+Z keyboard shortcut
   - Ctrl+Y / Ctrl+Shift+Z keyboard shortcut
   - Verify state restoration after undo (action text reverts)

5. **Action Type Insertion** — `ActionTypeMenu.tsx`, `actionRenderers/index.tsx`
   - Click "+" between actions to open the action type menu
   - Insert a `SetVariable` action
   - Insert a `GiveXP` action
   - Insert a `LogEntry` / `LogSetTopicStatus` action
   - Verify the new action card renders with the correct type-specific fields

### Medium Priority (Navigation & Project Features)

6. **View Switching** — `MainLayout.tsx`
   - Switch from Dialog view to Quest view via sidebar toggle
   - Switch from Dialog view to Variable Manager view
   - Verify the correct panel renders for each view
   - Verify dialog state is preserved when switching away and back

7. **Search** — `SearchPanel.tsx`, `SearchBar.tsx`, `SearchResults.tsx`
   - Open search (locate trigger — likely Ctrl+F or a UI button)
   - Type a query and see matching results
   - Click a search result to navigate to the matching dialog/NPC
   - Clear search and close panel

8. **Variable Manager** — `VariableManager.tsx`, `VariableCreationDialog.tsx`
   - View variables/constants table in project mode
   - Filter by search query
   - Filter by category (constants vs. variables) and type
   - Add a new variable via the creation dialog
   - Delete a variable
   - Pagination controls

9. **Dialog Deletion** — (if implemented per `dialog-remove-rename.md` plan)
   - Delete a dialog instance from the tree
   - Confirm deletion
   - Verify the dialog is removed from NPC list and file

10. **Action Reordering** — `react-beautiful-dnd` in `ActionsList.tsx`
    - Drag an action card to reorder it
    - Verify the new order persists
    - _(Note: Playwright drag-and-drop can be flaky; consider keyboard-based reorder if available)_

### Lower Priority (Polish & Secondary)

11. **Theme Switching** — `App.tsx`, `themeContext.tsx`
    - Click Dark / Light / Gothic theme chips
    - Verify theme class or palette changes on the page

12. **Source Code View** — `DialogSourceViewDialog.tsx`
    - Open source view for a dialog (Code icon button)
    - Verify generated Daedalus code is displayed
    - Close the dialog

13. **Reload & Unsaved Changes Confirmation** — `App.tsx`
    - Click "Neu laden" (Reload) with unsaved changes
    - Verify confirmation dialog appears
    - Accept → content reloads; Dismiss → changes preserved

14. **Quest Editor (Project Mode)** — `QuestEditor.tsx`, `QuestFlow.tsx`, `QuestDetails.tsx`
    - Quest list renders in project mode
    - Select a quest and see the graph/details
    - Quest inspector panel shows quest info
    - _(Depends on quest data being available in mock)_

15. **Cross-Reference Navigation** — `ReferenceLink.tsx`
    - Click a function reference link in the editor
    - Verify navigation to the referenced dialog/function

---

## Implementation Approach

### Test Structure

Each new spec file should follow the established patterns:
- Use inline Daedalus source strings or `tests/fixtures/*.d` files for test data
- Seed via `localStorage.setItem('mockapi_file_<path>', content)` before interactions
- Use `page.on('dialog', ...)` to handle browser prompts for file/project paths
- Prefer `getByRole`, `getByLabel`, `getByText` locators (accessible selectors)
- Avoid `waitForTimeout` where possible; use `toBeVisible`, `toPass`, or `waitForSelector`

### Proposed New Spec Files

| File | Covers Items |
|------|-------------|
| `dialog-properties.spec.ts` | #1 — Properties panel editing |
| `choice-editing.spec.ts` | #2 — Choice/branch creation and editing |
| `action-deletion.spec.ts` | #3 — Deleting actions with confirmation |
| `undo-redo.spec.ts` | #4 — Undo/redo via buttons and keyboard |
| `action-types.spec.ts` | #5 — Inserting different action types |
| `view-switching.spec.ts` | #6 — Sidebar view toggle |
| `search.spec.ts` | #7 — Search panel |
| `variable-manager.spec.ts` | #8 — Variable manager (project mode) |
| `action-reorder.spec.ts` | #10 — Drag-and-drop reordering |
| `theme-switching.spec.ts` | #11 — Theme toggle |
| `source-view.spec.ts` | #12 — Source code view dialog |
| `reload-confirmation.spec.ts` | #13 — Reload with unsaved changes |
| `quest-editor.spec.ts` | #14 — Quest editor in project mode |

### Fixture Data

Some tests will need richer fixture files than the existing `sample-dialog.d`:
- A dialog with **choices** (choice functions with `AI_Output` lines)
- A dialog with **multiple action types** (SetVariable, LogEntry, etc.)
- A **project-mode** fixture set with multiple NPC files, variables/constants, and quest data

These can be added as new files under `tests/fixtures/` or inlined in the spec files (following the pattern used by `dialog-creation.spec.ts` and `project-mode-editing.spec.ts`).

### Phased Rollout

- **Phase 1:** Items #1–#5 (core editing) — ~15–20 new tests
- **Phase 2:** Items #6–#10 (navigation & project) — ~15–20 new tests
- **Phase 3:** Items #11–#15 (polish) — ~10–15 new tests

Target: **~50 new tests** bringing the total to **~75 E2E tests**.

---

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| Drag-and-drop tests are flaky in Playwright | Use `page.dispatchEvent` or keyboard-based reorder fallback |
| Quest editor requires complex mock data | Build a dedicated quest fixture; consider a shared `seedProjectData()` helper |
| Monaco editor interactions are non-trivial | Use `page.evaluate` to interact with Monaco API directly when needed |
| Some features may be project-mode only | Ensure both single-file and project-mode test setups exist |
| `data-testid` attributes may be sparse | Add targeted `data-testid` props to components as needed during test authoring |

---

## Success Criteria

- All 13 new spec files pass in CI (`npm run test:e2e`)
- Every user-facing feature area listed above has at least one happy-path test
- No existing tests are broken by new additions
- Test execution time stays under 2 minutes total (parallel, single Chromium worker)
