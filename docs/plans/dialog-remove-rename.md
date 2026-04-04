# Plan: Remove and Rename Dialog Instances

**Date:** 2026-04-04
**Scope:** daedalus-parser + daedalus-dialog-editor
**Status:** Draft

---

## Objective

Add the ability to **remove** (delete) and **rename** dialog instances from the editor UI. Currently, dialogs can be created and edited but not deleted or renamed through the UI. Renaming only exists at the function level (`renameFunction` in `fileStore.ts:381`), and no delete operation exists for dialogs or their associated functions.

---

## Current State

### What exists today

1. **Dialog creation**: `useDialogFactory.ts` creates a dialog instance + condition function + information function as a unit. The naming convention is `DIA_{NpcToken}_{Label}`.

2. **Function rename**: `fileStore.renameFunction()` renames a function key in `semanticModel.functions` but does not update:
   - The dialog's `condition`/`information` property references
   - Choice action `targetFunction` references in other functions
   - `NpcKnowsInfoCondition.dialogRef` references
   - The dialog instance name itself

3. **No dialog delete**: There is no `removeDialog` or `deleteDialog` operation. The only way to remove a dialog is to edit the source `.d` file directly.

4. **History integration**: All fileStore mutations are wrapped via `historyActions.ts` with `withHistory()` for undo/redo support.

5. **Cross-references**: Dialogs are referenced by:
   - Their own `condition` and `information` function name properties
   - `NpcKnowsInfoCondition.dialogRef` in other dialogs' condition functions
   - Choice action `targetFunction` fields (indirect — points to functions, not dialog names)
   - `projectStore.dialogIndex` (NPC → DialogMetadata[] mapping)

6. **UI layout**: Three-column layout — NPC list → Dialog tree → Editor. The dialog tree (`DialogTreeColumn.tsx` / `DialogTree.tsx` / `DialogTreeItem.tsx`) shows dialogs as expandable tree items. No context menus exist on tree items today.

---

## Design

### Part 1: Remove Dialog Instance

#### 1a. Semantic Operation — `removeDialog` (fileStore)

Add `removeDialog(filePath: string, dialogName: string)` to `fileStore.ts`:

1. Look up the dialog in `semanticModel.dialogs[dialogName]`.
2. Resolve the condition and information function names from dialog properties.
3. Delete the dialog entry from `semanticModel.dialogs`.
4. Delete the condition function from `semanticModel.functions` (if it exists and is not shared).
5. Delete the information function from `semanticModel.functions`.
6. Recursively delete any "private" functions reachable only through this dialog's function tree (choice target functions that are not referenced by any other dialog). Use `useFunctionTreeBuilder` logic to find the full subtree.
7. Mark file dirty, clear `workingCode`.

Wrap with `withHistory()` in `historyActions.ts` so undo restores the full dialog + functions.

**Shared function detection**: Before deleting a function, scan all remaining dialogs and functions for references to it. If referenced elsewhere, leave it in place and only remove the dialog instance.

#### 1b. Cross-Reference Cleanup

When a dialog is removed, scan the entire merged semantic model for:
- `NpcKnowsInfoCondition` entries where `dialogRef === dialogName` → flag these to the user as broken references (warning, not auto-delete)
- Choice actions pointing to functions that were deleted → same warning

This produces a **removal report** shown in the confirmation dialog (see 1c).

#### 1c. UI — Confirmation Dialog

**Entry point**: Right-click context menu on a dialog tree item → "Delete Dialog..."

The confirmation dialog should:
- Show the dialog name and description
- List all functions that will be deleted (condition, information, choice subtree)
- List any **broken references** that will result (other dialogs referencing this one via `Npc_KnowsInfo`)
- Show a warning icon if broken references exist
- Two buttons: "Cancel" / "Delete" (destructive red)

**UI pattern**: Use MUI `Dialog` component, consistent with the existing `DeleteConfirmDialog.tsx` used for action deletion. Extend or reuse that component.

#### 1d. UI — Context Menu on Dialog Tree Items

Add a right-click context menu to `DialogTreeItem.tsx`:

```
┌─────────────────────┐
│ Rename Dialog...     │
│ ─────────────────── │
│ Delete Dialog...     │
└─────────────────────┘
```

Use MUI `Menu` + `MenuItem`. Store anchor element in local state. Close on selection or click-away.

#### 1e. Post-Deletion State

After deletion:
- If the deleted dialog was selected, clear `selectedDialog` and `selectedFunctionName` in `uiSelectionStore`
- Refresh `projectStore.dialogIndex` for the affected NPC
- If the NPC has no remaining dialogs, keep the NPC selected but show an empty state in the dialog tree column

---

### Part 2: Rename Dialog Instance

#### 2a. Semantic Operation — `renameDialog` (fileStore)

Add `renameDialog(filePath: string, oldDialogName: string, newDialogName: string, renameFunctions: boolean)` to `fileStore.ts`:

1. Look up the dialog in `semanticModel.dialogs[oldDialogName]`.
2. Create a new entry under `newDialogName` with updated `dialog.name`.
3. Delete the old entry.
4. If `renameFunctions` is true (default), cascade rename:
   - Condition function: `{OldName}_Condition` → `{NewName}_Condition`
   - Information function: `{OldName}_Info` → `{NewName}_Info`
   - Update the dialog's `condition` and `information` property values to the new function names
   - Recursively rename choice subtree functions that follow the `{OldDialogName}_*` naming pattern → `{NewDialogName}_*`
5. Update `NpcKnowsInfoCondition.dialogRef` references across all functions in the same file that point to `oldDialogName` → `newDialogName`.
6. Mark file dirty, clear `workingCode`.

Wrap with `withHistory()` for undo/redo.

**Cross-file references**: `NpcKnowsInfoCondition.dialogRef` in other files won't be updated automatically. Show a warning listing affected files so the user can fix them manually or via a future "refactor across files" feature.

#### 2b. Name Validation

Before accepting a rename:
- Name must match `^[A-Za-z_][A-Za-z0-9_]*$` (valid Daedalus identifier)
- Name must not collide with an existing dialog in the same file
- Name must not collide with an existing function name if `renameFunctions` is true (check all derived names)
- Show inline validation error in the rename UI

#### 2c. UI — Inline Rename

**Primary interaction**: Double-click on dialog name in the tree → inline text field.

This is the most natural and least disruptive pattern for rename. Implementation:
- `DialogTreeItem.tsx` gets an `isEditing` state
- When editing, replace the label `Typography` with a `TextField`
- Auto-select the suffix part of the name (after `DIA_{NpcToken}_`) so users typically only change the meaningful label portion
- Press Enter to confirm, Escape to cancel
- On blur, confirm (if changed) or cancel

**Secondary interaction**: Right-click context menu → "Rename Dialog..." → same inline edit mode.

#### 2d. UI — Rename Options Dialog (advanced)

When the rename involves cascading function renames, show a brief confirmation:

```
┌─────────────────────────────────────────────┐
│ Rename Dialog                               │
│                                             │
│ DIA_Farim_Hallo → DIA_Farim_Greeting        │
│                                             │
│ The following functions will also be renamed:│
│   • DIA_Farim_Hallo_Condition               │
│     → DIA_Farim_Greeting_Condition          │
│   • DIA_Farim_Hallo_Info                    │
│     → DIA_Farim_Greeting_Info               │
│   • DIA_Farim_Hallo_Dragon                  │
│     → DIA_Farim_Greeting_Dragon             │
│                                             │
│ ⚠ 2 references in other files will need     │
│   manual update (DIA_Xardas.d, DIA_Lares.d) │
│                                             │
│            [Cancel]  [Rename]               │
└─────────────────────────────────────────────┘
```

Only show this dialog if there are associated functions to rename. If the user just renames the dialog instance without matching functions, apply immediately.

---

### Part 3: Parser Support

#### 3a. Semantic Model

No changes needed to the `Dialog` class itself. The operations manipulate the `SemanticModel.dialogs` and `SemanticModel.functions` dictionaries directly.

#### 3b. Code Generation

The existing code generator (`daedalus-parser/src/codegen/generator.ts`) already generates from the semantic model. Removing a dialog from the model means it won't appear in generated output. No generator changes needed.

#### 3c. Cross-Reference Analysis Utility

Add a utility in the parser's semantic layer:

```typescript
// daedalus-parser/src/semantic/cross-references.ts
export function findDialogReferences(
  model: SemanticModel,
  dialogName: string
): DialogReference[];

export function findFunctionReferences(
  model: SemanticModel,
  functionName: string
): FunctionReference[];
```

This can be used by both remove and rename operations to detect broken references and cascade renames. It scans:
- `DialogProperties.condition` / `information` fields
- `NpcKnowsInfoCondition.dialogRef` fields
- Choice action `targetFunction` fields

---

## Implementation Order

### Phase 1: Core Store Operations (no UI)

1. Add `findDialogReferences` / `findFunctionReferences` utility in daedalus-parser
2. Add `removeDialog` to fileStore + historyActions
3. Add `renameDialog` to fileStore + historyActions
4. Write unit tests for all three

### Phase 2: Remove UI

5. Add context menu to `DialogTreeItem.tsx`
6. Add `DeleteDialogConfirmDialog.tsx` with reference analysis
7. Wire context menu → confirm dialog → `removeDialog` store action
8. Handle post-deletion selection state

### Phase 3: Rename UI

9. Add inline rename editing to `DialogTreeItem.tsx`
10. Add name validation logic
11. Add `RenameDialogConfirmDialog.tsx` for cascade preview
12. Wire inline edit → (optional confirm) → `renameDialog` store action

### Phase 4: Polish

13. Keyboard shortcuts: `Delete` key on selected dialog, `F2` for rename
14. Update dialog tree filter/search after rename
15. Edge case testing: rename when dialog has no matching function names, removing last dialog for an NPC, undo/redo cycles

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `daedalus-parser/src/semantic/cross-references.ts` | New — reference analysis utility |
| `daedalus-dialog-editor/src/renderer/store/fileStore.ts` | Add `removeDialog`, `renameDialog` |
| `daedalus-dialog-editor/src/renderer/store/historyActions.ts` | Wrap new actions with `withHistory` |
| `daedalus-dialog-editor/src/renderer/store/uiSelectionStore.ts` | Handle post-delete selection clearing |
| `daedalus-dialog-editor/src/renderer/components/DialogTreeItem.tsx` | Context menu, inline rename |
| `daedalus-dialog-editor/src/renderer/components/DeleteDialogConfirmDialog.tsx` | New — deletion confirmation |
| `daedalus-dialog-editor/src/renderer/components/RenameDialogConfirmDialog.tsx` | New — rename cascade preview |
| `daedalus-dialog-editor/src/renderer/components/DialogTreeColumn.tsx` | Pass new callbacks down |
| `daedalus-dialog-editor/src/renderer/components/ThreeColumnLayout.tsx` | Wire new operations |

---

## Risks and Considerations

1. **Cross-file references**: Rename/remove only operates on the current file's semantic model. References in other files (loaded via `projectStore.parsedFiles`) won't be updated automatically. The UI must clearly warn users about this. A future "refactor across project" feature could address this.

2. **Shared functions**: A function might be referenced by multiple dialogs (e.g., a shared greeting response). The remove operation must detect this and skip deleting shared functions.

3. **Undo granularity**: A dialog removal that deletes 5+ functions should be a single undo step. The `withHistory` wrapper snapshots the full file state before mutation, so this works naturally.

4. **Quest graph sync**: If the quest editor has nodes for the deleted/renamed dialog, those nodes need to be updated or removed. This may require changes to the quest graph store, but should be deferred to a follow-up if the quest editor does not yet track dialog names directly.

5. **Performance**: Reference scanning across large projects (hundreds of dialogs) should be fast since it's in-memory dictionary iteration. No concern expected.
