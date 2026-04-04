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
2. Add `isModelEmpty()` utility (E2)
3. Add `removeDialog` to fileStore + historyActions (including `declarationOrder` cleanup — E6)
4. Add `renameDialog` to fileStore + historyActions (including `declarationOrder` update — E6)
5. Write unit tests for all four, including edge cases E3 (orphaned functions) and E7 (collisions)

### Phase 2: Remove UI

6. Add context menu to `DialogTreeItem.tsx`
7. Add `DeleteDialogConfirmDialog.tsx` with reference analysis
8. Wire context menu → confirm dialog → `removeDialog` store action
9. Handle post-deletion selection state (E5 — NPC disappears)
10. Add "empty file" detection + `deleteFile` IPC handler (E1)
11. Add `EmptyFileConfirmDialog.tsx` — prompt to delete empty file after removal
12. Handle undo history cleanup on file deletion (E8)
13. Verify FileWatcher `unlink` idempotency (E10)

### Phase 3: Rename UI

14. Add inline rename editing to `DialogTreeItem.tsx`
15. Add name validation logic with same-file hard block + cross-file soft warning (E7)
16. Add `RenameDialogConfirmDialog.tsx` for cascade preview
17. Wire inline edit → (optional confirm) → `renameDialog` store action

### Phase 4: Polish

18. Keyboard shortcuts: `Delete` key on selected dialog, `F2` for rename
19. Update dialog tree filter/search after rename
20. Edge case testing: multi-file dialog removal (E4), auto-save interactions (E9), removing last dialog for an NPC (E5), undo/redo cycles across removal + file deletion boundary (E8)

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `daedalus-parser/src/semantic/cross-references.ts` | New — reference analysis utility |
| `daedalus-dialog-editor/src/renderer/store/fileStore.ts` | Add `removeDialog`, `renameDialog`, `deleteFile` |
| `daedalus-dialog-editor/src/renderer/store/historyActions.ts` | Wrap new actions with `withHistory` |
| `daedalus-dialog-editor/src/renderer/store/uiSelectionStore.ts` | Handle post-delete selection clearing (dialog + NPC) |
| `daedalus-dialog-editor/src/renderer/store/projectStore.ts` | Refresh `dialogIndex`/`npcList` after file deletion |
| `daedalus-dialog-editor/src/renderer/store/historyStore.ts` | Clear undo history for deleted files |
| `daedalus-dialog-editor/src/main/main.ts` | New IPC handler: `file:delete` (fs.unlink) |
| `daedalus-dialog-editor/src/main/preload.ts` | Expose `deleteFile` to renderer |
| `daedalus-dialog-editor/src/renderer/components/DialogTreeItem.tsx` | Context menu, inline rename |
| `daedalus-dialog-editor/src/renderer/components/DeleteDialogConfirmDialog.tsx` | New — deletion confirmation |
| `daedalus-dialog-editor/src/renderer/components/EmptyFileConfirmDialog.tsx` | New — prompt to delete empty file |
| `daedalus-dialog-editor/src/renderer/components/RenameDialogConfirmDialog.tsx` | New — rename cascade preview |
| `daedalus-dialog-editor/src/renderer/components/DialogTreeColumn.tsx` | Pass new callbacks down |
| `daedalus-dialog-editor/src/renderer/components/ThreeColumnLayout.tsx` | Wire new operations |

---

## Edge Cases

### E1: Empty File After Removal

When all dialogs and functions are removed from a `.d` file, the generated output would be an empty string (the code generator iterates `model.dialogs` and `model.functions` — if both are empty, `sections` is empty).

**Decision required**: What to do with an empty file?

- **Option A — Keep the empty file**: Save produces a blank or whitespace-only `.d` file. The file remains in the project and on disk. Simple, fully reversible via undo.
- **Option B — Offer to delete the file** (recommended): After removal, if `Object.keys(model.dialogs).length === 0 && Object.keys(model.functions).length === 0` and the model has no remaining constants/variables/instances/npcs, show a secondary prompt: _"The file `DIA_Farim.d` is now empty. Delete the file from disk?"_ with [Keep Empty File] / [Delete File].
  - If deleted: call a new `deleteFile` IPC handler (fs.unlink + close the file in fileStore + remove from projectStore)
  - The `FileWatcherService` already handles `unlink` events, so external tooling stays in sync
  - Undo cannot restore a deleted file — warn in the confirmation dialog: _"File deletion cannot be undone."_
- **Option C — Prevent removal of the last dialog**: Disable the "Delete Dialog" context menu item when it's the only dialog in the file. Too restrictive — the user may genuinely want to clear the file.

**Recommendation**: Option B. Prompt after the semantic removal is saved. Keep the file deletion as a separate, explicit step from the dialog removal so undo still works for the semantic change.

### E2: File Contains Non-Dialog Content

A `.d` file's `SemanticModel` can contain `constants`, `variables`, `instances`, `npcs`, `items`, and `animations` in addition to dialogs and functions. Removing the last dialog should **not** trigger the "empty file" prompt if other content remains. The emptiness check must verify all model dictionaries, not just `dialogs`:

```typescript
function isModelEmpty(model: SemanticModel): boolean {
  return (
    Object.keys(model.dialogs).length === 0 &&
    Object.keys(model.functions).length === 0 &&
    Object.keys(model.constants ?? {}).length === 0 &&
    Object.keys(model.variables ?? {}).length === 0 &&
    Object.keys(model.instances ?? {}).length === 0 &&
    Object.keys(model.npcs ?? {}).length === 0 &&
    Object.keys(model.items ?? {}).length === 0 &&
    Object.keys(model.animations ?? {}).length === 0
  );
}
```

### E3: Orphaned Functions After Removal

When a dialog is removed, its condition/info functions and choice subtree functions are candidates for deletion. But the file may also contain **standalone functions** not linked to any dialog (utility helpers, global scripts). These must never be touched. Only delete functions that:
1. Are reachable from the dialog being removed (via property refs or choice `targetFunction` chains), AND
2. Are not referenced by any remaining dialog or function in the file

### E4: Removing a Dialog That Spans Multiple Files (Project Mode)

In project mode, `projectStore` merges semantic models from multiple files into `mergedSemanticModel`. A dialog's condition function could theoretically live in a different file than the dialog instance itself (unusual but possible). The `removeDialog` operation must:
1. Identify which file each function lives in (check `parsedFiles` map)
2. Only delete functions from their owning file
3. If the dialog and its functions span multiple files, warn the user and only remove what's in the dialog's file — leave cross-file functions for manual cleanup

### E5: NPC Disappears From NPC List

When the last dialog for an NPC is removed, `projectStore.dialogIndex` will have an empty array for that NPC. Two sub-cases:

- **NPC instance defined in a separate `NPC_*.d` file**: The NPC remains in `npcList` because the instance definition still exists. The dialog tree column shows empty state. This is correct.
- **NPC instance was auto-created by `useDialogFactory` in the same file**: If the NPC instance is also in the file and the file is deleted (E1 Option B), the NPC disappears from the project. The `npcList` should be refreshed after file deletion. If the deleted NPC was selected, clear `selectedNPC` in `uiSelectionStore`.

### E6: `declarationOrder` Consistency

`SemanticModel.declarationOrder` tracks the source-order of dialogs and functions for round-trip fidelity. When removing a dialog:
- Remove the dialog's entry from `declarationOrder`
- Remove entries for all deleted functions from `declarationOrder`
- Failure to do this means the code generator's `generateByDeclarationOrder()` path will try to look up deleted names, producing undefined output

When renaming:
- Update the `name` field in the corresponding `declarationOrder` entry (or remove+re-add)

### E7: Rename Collision With Existing Content

Renaming `DIA_Farim_Hallo` → `DIA_Farim_Trade` must check for collisions against:
- All dialog names in the file
- All function names in the file (since derived names like `DIA_Farim_Trade_Condition` are generated)
- All dialog/function names in the merged model (project mode) — warn but allow, since Daedalus scripts may have legitimate same-name items across files

Show inline validation error for same-file collisions (hard block). Show a warning for cross-file collisions (soft — user can proceed).

### E8: Undo After File Deletion

If the user removes a dialog (undo-able), then deletes the now-empty file (not undo-able), and then hits Ctrl+Z:
- The file is gone from disk and from `fileStore.openFiles`
- Undo has no target file to restore into

**Mitigation**: When deleting a file after dialog removal, also clear the undo history for that file path. The confirmation dialog already warns that file deletion can't be undone.

### E9: Auto-Save Race Condition

If auto-save is enabled and fires between the dialog removal and the user confirming file deletion, the empty/reduced file will be written to disk. This is acceptable — the semantic model is the source of truth, and the file reflects the current state. No special handling needed, but worth noting.

### E10: FileWatcher Reacts to Our Own Deletion

When we delete a file via IPC, the `FileWatcherService` will fire an `unlink` event. The existing `useFileWatcher` hook calls `fileStore.closeFile()` on `unlink`. If we've already closed the file in our deletion flow, the second close is a no-op (`openFiles.delete` on a missing key). Verify this is safe — it should be, but add a guard if needed.

---

## Risks and Considerations

1. **Cross-file references**: Rename/remove only operates on the current file's semantic model. References in other files (loaded via `projectStore.parsedFiles`) won't be updated automatically. The UI must clearly warn users about this. A future "refactor across project" feature could address this.

2. **Shared functions**: A function might be referenced by multiple dialogs (e.g., a shared greeting response). The remove operation must detect this and skip deleting shared functions.

3. **Undo granularity**: A dialog removal that deletes 5+ functions should be a single undo step. The `withHistory` wrapper snapshots the full file state before mutation, so this works naturally.

4. **Quest graph sync**: If the quest editor has nodes for the deleted/renamed dialog, those nodes need to be updated or removed. This may require changes to the quest graph store, but should be deferred to a follow-up if the quest editor does not yet track dialog names directly.

5. **Performance**: Reference scanning across large projects (hundreds of dialogs) should be fast since it's in-memory dictionary iteration. No concern expected.
