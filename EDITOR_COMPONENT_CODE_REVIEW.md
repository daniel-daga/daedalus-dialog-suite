# Editor Component Code Review

Scope reviewed:
- `daedalus-dialog-editor/src/renderer/components/EditorPane.tsx`
- `daedalus-dialog-editor/src/renderer/components/DialogDetailsEditor.tsx`

Focus areas:
- Maintenance burden
- Anti-patterns
- Long-term maintainability

## Executive summary

The editor experience is feature-rich, but the main `DialogDetailsEditor` component has accumulated too many responsibilities and now acts as an orchestration, data-access, mutation, async state, and rendering layer in one file. This increases cognitive load and risk when making changes. There are also several maintainability anti-patterns (heavy `any` usage, duplicated update flows, ad-hoc store reads, and hardcoded action menus) that make the component difficult to reason about and test safely.

## Findings

### 1) `DialogDetailsEditor` is a "god component" with mixed responsibilities (High) [Completed]

**Why this matters:**
The component handles:
- store reads/writes,
- async save/reset workflows,
- snackbar and validation dialog UX state,
- business logic for action creation,
- function rename logic,
- condition mutation logic,
- and extensive UI composition.

This tightly-coupled design makes every change risky and encourages regressions when evolving one concern.

**Evidence:**
- The file spans broad logic for state management, command handlers, and rendering in one component.
- Multiple unrelated handlers are embedded directly (`handleSave`, `handleReset`, `handleRenameFunction`, `addActionToEnd`, condition update flow).

**Recommendation:**
Split into focused hooks and child components, e.g.:
- `useDialogEditorCommands` (save/reset/rename/add-action)
- `useDialogEditorUIState` (snackbar/dialog/menu state)
- `DialogPropertiesSection`
- `DialogActionsSection`
- `ConditionSection`

---

### 2) Frequent direct store reads (`useEditorStore.getState()`) create hidden data flow and race complexity (High) [Completed]

**Why this matters:**
Calling `getState()` inside callbacks bypasses React’s explicit data flow and makes behavior dependent on implicit global state timing. It can reduce predictability and complicate tests because logic reads from two sources: hook-selected state and ad-hoc store snapshots.

**Evidence:**
- Direct store snapshots are pulled repeatedly in update/save flows (e.g., `setFunction`, rename flow, property updates, condition updates, reset flow).

**Recommendation:**
Centralize mutable editor operations in store actions (single API surface), and consume via stable selectors/hooks in the component. If fresh state is required for updater semantics, expose dedicated store actions that internally handle latest-state reads.

---

### 3) Type safety erosion from pervasive `any` in critical mutation paths (High) [Completed]

**Why this matters:**
Using `any` in update pipelines weakens compile-time guarantees for core editor operations and increases breakage risk during refactors.

**Evidence:**
- `setFunction(updatedFunctionOrUpdater: any)`
- `let newAction: any`
- `onUpdateSemanticModel: (funcName: string, func: any)`
- `handleDialogPropertyChange((updater: (d: any) => any) => ...)`
- `onUpdateFunction={(funcOrUpdater: any) => ...}`

**Recommendation:**
Introduce shared typed aliases and enforce them across hooks/components:
- `type FunctionUpdater = DialogFunction | ((prev: DialogFunction) => DialogFunction)`
- strong action union types for `createAction` return values
- typed `Dialog` updater signatures

---

### 4) Duplicated/parallel mutation strategies increase drift risk (Medium)

**Why this matters:**
There are multiple mutation pathways for similar concerns (`updateFunction`, `updateDialog`, `updateModel`, inline updater lambdas, manual map reconstruction). Over time this causes inconsistent invariants and subtle bugs.

**Evidence:**
- rename uses full model reconstruction + `updateModel`
- dialog property updates use normalization + `updateDialog`
- action operations use `setFunction` + `updateFunction`
- condition updates duplicate updater logic in an inline handler

**Recommendation:**
Create a single command layer for editor mutations with explicit invariants:
- `renameFunction(filePath, oldName, newName)`
- `updateDialogProperties(filePath, dialogName, patch)`
- `appendAction(filePath, functionName, actionType, context)`

---

### 5) Hardcoded action menu options are not configuration-driven (Medium)

**Why this matters:**
The UI duplicates a long list of `MenuItem` entries inline. This makes extension/error-prone edits likely and drifts from existing action factory/template abstractions.

**Evidence:**
- Repeated inline menu item definitions for each action type in `DialogDetailsEditor`.

**Recommendation:**
Define a typed `ACTION_MENU_ITEMS` configuration and render via `.map()`. Keep labels, action IDs, and optional grouping in one source of truth.

---

### 6) Repeated container layout patterns in `EditorPane` reduce maintainability (Low)

**Why this matters:**
`EditorPane` repeats near-identical wrappers for three early-return states (no selection, no function, missing function). Repetition increases surface area for style drift.

**Evidence:**
- Same outer `<Box>` layout block duplicated across multiple branches.

**Recommendation:**
Extract a small shared `EditorPaneStateShell` and a helper render function for state-specific content.

---

### 7) UI behavior constants are embedded as magic values (Low)

**Why this matters:**
Tab/header heights and transition timings appear in multiple locations (`40`, `100`, `200`, etc.). Implicit coupling between tab height and overlay top offset is fragile.

**Evidence:**
- Tab min height and skeleton overlay `top` offset are coupled by convention.

**Recommendation:**
Move to named constants:
- `const TABS_HEIGHT = 40`
- `const LOADING_FADE = { enter: 100, exit: 200 }`

## Positive patterns worth keeping

- Good use of focused child components (`ConditionEditor`, `ActionsList`, `ValidationErrorDialog`) already provides boundaries to build on.
- Save/reset flows provide user feedback and error handling.
- `EditorPane` handles empty/error/loading scenarios clearly for users.

## Suggested refactor order (incremental)

1. Add strict types for updater signatures and remove `any` from mutation paths.
2. Extract action-menu config to data-driven rendering.
3. Introduce store-level command APIs for rename/property/action updates.
4. Move save/reset/feedback logic into `useDialogEditorCommands` hook.
5. Split `DialogDetailsEditor` into section components.
6. Deduplicate `EditorPane` fallback shells and replace magic constants.

