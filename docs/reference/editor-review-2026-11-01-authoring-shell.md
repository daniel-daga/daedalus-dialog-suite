# Editor review — 2026-11-01, slice 4: the authoring shell

Slice: `src/renderer/App.tsx`, `components/MainLayout.tsx`,
`ThreeColumnLayout.tsx`, `EditorPane.tsx`, `EditorColumn.tsx`; the dialog tree
(`DialogTree.tsx`, `DialogTreeColumn.tsx`, `DialogTreeItem.tsx`,
`dialogTreeUtils.ts`, `dialogUtils.ts`, `npcWorldJump.ts`);
`DialogDetailsEditor.tsx`, `DialogPropertiesSection.tsx`,
`DialogActionsSection.tsx`, `VariableManager.tsx`; search (`SearchBar.tsx`,
`SearchPanel.tsx`, `SearchResults.tsx`, `store/searchStore.ts`); the
confirm/conflict/source dialogs (`RegisterTopicDialog.tsx`,
`RenameDialogConfirmDialog.tsx`, `DeleteDialogConfirmDialog.tsx`,
`ExternalChangeConflictDialog.tsx`, `ReviewChangesDialog.tsx`,
`DialogSourceViewDialog.tsx`, `ValidationErrorDialog.tsx`,
`WhatChangedDialog.tsx`, `ProjectOpeningOverlay.tsx`);
`keyboardShortcuts.ts`, `KeyboardShortcutsDialog.tsx`, `ErrorBoundary.tsx`,
`theme.ts`, `themeContext.tsx`.

Commit reviewed: `0390307`. Date: 2026-11-01.

**Load assumed.** A single-file session and an 890-file project alike; hundreds
of dialogs behind one NPC index; several recent tabs open; keyboard-driven
work at typing speed (type a field, Ctrl+S, move on without clicking); a rename
of a dialog that a dozen files reference through `Npc_KnowsInfo`; a delete of a
dialog whose owned function is still a choice target elsewhere; and a project
opening behind the overlay while the user keeps typing. Judged against that:
what the panel shows is the *file's* model the user is editing, and rename /
delete / register leave every reference that points in either intact or
visibly reported.

**What this slice does:** `App` owns the chrome (project, save, conflict and
close guard) and renders `MainLayout`, which keeps one view on screen and the
rest mounted-but-hidden. `ThreeColumnLayout` picks the model it shows (the
file's own model in single-file mode, a reassembled `dialogs`+`functions` slice
of the merged project model in project mode), and drives selection, the recent
tabs, search, and the rename/delete confirmations. The right pane resolves the
selected dialog and function to a `DialogDetailsEditor`, whose property edits
go through `historyActions` into `fileStore`; the middle pane renders a
virtualized tree flattened from the same model.

Checks run: the focused suites `dialogRenamePlan`, `searchStore`,
`SearchResults`, `DialogPropertiesSection`, `useDialogNavigation.reuseOpenFile`,
`DialogTree.perf`, `DialogTree.rerender`, `ThreeColumnLayout.rerender`,
`DialogDetailsEditor.undoFlush`, `App.worldUndoButtons`, `npcWorldJump`,
`keyboardShortcuts`, `ErrorBoundary.logging`, `ExternalChangeConflictDialog`
(all pass), plus three throwaway probes outside the repo: a `renderHook` of
`useDialogNavigation` in single-file mode, a `renderHook` of
`useSearchNavigation` against a choice-function text hit, and a timing of
`computeDialogDeletionSet` on a project-sized model. Findings 2, 3 and 5 below
are reproduced by them, not inferred. No repo file was edited except this
report.

## What already holds, and the test that would fail if it broke

| Rule | Test |
|---|---|
| a rename is refused for a dialog name taken by another dialog or by another dialog's derived function, and the preview blocks on the same rule the store applies | `tests/dialogRenamePlan.test.ts:39`, `:50`, `:68`, `:85` |
| a rename rewrites every reference in that file: properties, choice targets (including inside branches), `dialogRef` conditions and `declarationOrder` | `tests/historyActions.test.ts:444`–`:648` |
| a rejected rename leaves both undo stacks alone instead of leaving a step that reverts nothing | `tests/historyActions.noop.test.ts:121` |
| the tree virtualizes, and a re-render reaches only the rows whose data changed | `tests/DialogTree.perf.test.tsx`, `tests/DialogTree.rerender.test.tsx`, `tests/DialogTreeItem.perf.test.tsx` |
| the layout and its columns re-render for their own file's flushes, not for another file's | `tests/ThreeColumnLayout.rerender.test.tsx`, `tests/App.fileStoreSubscription.test.tsx`, `tests/MainLayout.rerender.test.tsx` |
| the dialog editor's undo/redo buttons flush the pending debounced edit first | `tests/DialogDetailsEditor.undoFlush.test.tsx` |
| the app-bar undo/redo are inert while the World view is on screen | `tests/App.worldUndoButtons.test.tsx`, `tests/MainLayout.worldUndo.test.tsx` |
| search finds a dialog line nested in an `if`/`else`, and an in-flight search cannot repopulate cleared results | `tests/searchStore.test.ts:259`, `:73` |
| the shortcut sheet's World rows are all still bound, and every chord the World surface claims has a row | `tests/keyboardShortcuts.test.ts` |
| the NPC→world jump answers jump / open that world / why not | `tests/npcWorldJump.test.ts`, `tests/DialogDetailsEditor.worldJump.test.tsx` |
| a crash inside the editor pane leaves the chrome (save, close, conflicts) alive, and logs the error | `tests/App.errorBoundary.test.tsx`, `tests/ErrorBoundary.logging.test.tsx` |
| a conflict dialog shows the disk-vs-mine diff, and Enter picks neither answer | `tests/ExternalChangeConflictDialog.test.tsx` |

In single-file mode the tree's own selection path works (`handleSelectDialog`
falls through to `finalizeDialogSelection`); it is the paths that go through
`navigateToDialog` that do not — see finding 2.

## Must fix

1. **A typed description never reaches the model unless the field loses focus**
   (`src/renderer/components/DialogPropertiesSection.tsx:190-202`, with the
   local state at `:49-57` and the commit at `:198-202`; the save path it
   bypasses is `src/renderer/hooks/useManualSave.ts:33`)
   - **What this is:** the Description box keeps its text in component state and
     writes to the model only in `onBlur`. Every other field in the section —
     NPC, Number (Priority), the flags, the constant picker — writes as you
     type or pick.
   - **Problem:** the blur-only commit is deliberate (its own test asserts that
     blurring an untouched field writes nothing), but nothing drains it. It is
     not a debounce, so it is not in the pending-edit registry either: only
     `ActionCard` and `useConditionUpdate` register flushers
     (`src/renderer/utils/pendingEditFlushRegistry.ts`). So with the caret still
     in the box: `Ctrl+S` returns early because the file is not dirty
     (`useManualSave.ts:33`), auto-save never arms for the same reason, and the
     close guard's `flushAllPendingEdits()` finds nothing, so the window quits
     without asking. The app bar meanwhile says "All changes saved" and shows the
     field's text as if it were the model's. Reproduced from the existing tests:
     `fireEvent.change` on the field produces no
     `onDialogPropertyChange` call, and the value stays on screen until a
     `fireEvent.blur`.
   - **What the user loses:** a description they typed and then saved the way a
     keyboard user saves — Ctrl+S and keep going, or close the window. The text
     is on screen, the file does not have it, and nothing says so.
   - **Test that does not exist:** type into Description, run the save path
     (`Ctrl+S` / `saveActiveFile`), assert the model has the typed text — and
     that the file is dirty before the save, so the save is not a silent no-op.
   - **Minimal fix:** write on change the way the neighbouring Number field
     does (`onChange` → `onDialogPropertyChange(...)`; the 300 ms snapshot
     coalescing in `historyStore` already keeps it to one undo step), and keep
     `onBlur` only for restoring a cleared field. Two lines, and the field then
     behaves like every other one in the section.
   - **If we skip it:** the single most-edited text property in the editor is
     the one that can be lost without a warning, and it is lost precisely in the
     flow the app documents (`Ctrl+S`, "All changes saved").

2. **Outside a project, no dialog navigation works — recent tabs and search both
   answer "Could not find dialog … in the current context"**
   (`src/renderer/components/hooks/useDialogNavigation.ts:179`, falling into
   `src/renderer/hooks/useNavigation.ts:31-110`, whose only lookup is
   `dialogIndex`)
   - **What this is:** `navigateToDialog` searches `dialogIndex` — the
     NPC→dialogs map — and returns `false` when it finds nothing. `dialogIndex`
     is filled by `openProject` and by nothing else (`projectStore.ts:622`,
     emptied at `:887`), so in a single-file session it is empty.
   - **Problem:** two surfaces route through it with no other path. Clicking a
     recent tab: `handleSelectRecentDialog` skips its project branch and calls
     `navigateToDialogWithLoading` (`useDialogNavigation.ts:179`). Every global
     search result except an NPC one: `useSearchNavigation.ts:71`, `:91`. Both
     then set `operationError`, so the user gets a red banner over a dialog list
     that is plainly on screen. Reproduced: one file open, `DIA_A` selected,
     `handleSelectRecentDialog('DIA_B', …)` → selection stays `DIA_A`, error
     `Could not find dialog "DIA_B" in the current context.` The tree still
     works, which is why this survives: the visible way in works, and the two
     keyboard/preferred ways in do not.
   - **What the user loses:** tab switching and the whole of Ctrl+F navigation
     whenever they opened a file directly from the welcome screen — the second
     button on it.
   - **Test that does not exist:** a single-file session where
     `handleSelectRecentDialog` (and a `dialog`/`text` search result) selects the
     dialog out of the one open file's model. `useDialogNavigation.reuseOpenFile`
     covers the project path only.
   - **Minimal fix:** in `navigateToDialog`, before `return false`, look in the
     open files' models — single-file mode has exactly one — and select the
     dialog (and its information function) when it is there. Six lines, and both
     callers start working.
   - **If we skip it:** the editor's two navigation aids are dead on the entry
     point the welcome screen advertises, and the error message blames the
     dialog rather than the missing project index.

3. **A search hit on a line inside a choice function opens that function under
   the dialog that was open before**
   (`src/renderer/components/hooks/useSearchNavigation.ts:82-105`, the fallback
   at `:103-104`)
   - **What this is:** for a `text` or `function` result the handler looks for a
     dialog whose *information* function is the hit. If the hit is in any other
     function — a choice target, which is where every hero line lives — it calls
     `setSelectedFunctionName(result.functionName)` and stops there.
   - **Problem:** `selectedDialog` is untouched, so the pane keeps rendering the
     previous dialog's properties and heading while the action list switches to a
     function from another dialog. Worse, `DialogDetailsEditor` resolves the
     function against the *active file's* model (`:61-70`), so when the hit is in
     another file the actions section disappears entirely and only the old
     dialog's properties remain — no error, nothing to explain it. Reproduced:
     with `selectedDialog: 'DIA_Other'`, a text hit whose `functionName` is
     `DIA_Open_Choice_1` leaves `selectedDialog: 'DIA_Other'`,
     `selectedFunctionName: 'DIA_Open_Choice_1'`, and never calls the navigator.
   - **What the user loses:** the ability to jump to the line they searched for.
     They land on a mixed pane, or on a pane with no actions, and have to find the
     dialog by hand. It also costs the trust in the panel's invariant: the heading
     and the body now describe two different dialogs.
   - **Test that does not exist:** a text hit in a choice function makes the
     owning dialog selected and the owning function selected together.
     `searchStore.test.ts:259` proves the hit is *found*; nothing proves it is
     reachable.
   - **Minimal fix:** when the hit is not an information function, resolve the
     owning dialog (walk `semanticModel.dialogs` for one whose owned functions
     contain the name — `collectDialogOwnedFunctions` in `dialogUtils.ts:107`
     already answers that) and call
     `navigateToDialogWithLoading(dialogName, functionName)`; keep the bare
     `setSelectedFunctionName` only for a function that no dialog owns.
   - **If we skip it:** the most common search result in a real project — a hero
     line inside a choice — is the one that cannot be opened, and the failure
     looks like a UI bug rather than a missing feature.

4. **A rename breaks the other files that reference the dialog, and the dialog's
   cross-file warning list is a hardcoded empty array**
   (`src/renderer/components/ThreeColumnLayout.tsx:559` `crossFileWarnings={[]}`;
   the rename at `:423`; `src/renderer/store/fileStore.ts:596-741`)
   - **What this is:** `RenameDialogConfirmDialog` has a
     `crossFileWarnings: string[]` prop documented as "Files (not current file)
     that have NpcKnowsInfo references to this dialog" and renders a warning
     listing them. There is exactly one producer of that prop, and it passes
     `[]`.
   - **Problem:** `fileStore.renameDialog` rewrites one file's model — its
     dialogs, functions, choice targets and `dialogRef`s. No other file is
     touched, and no index is told about the rename, so
     `Npc_KnowsInfo(other, DIA_Old)` in the other eleven files now names nothing.
     The confirmation therefore reports "no cross-file references" for every
     rename, whatever the project holds. It is the same scan the delete dialog
     already does over the merged model for its broken-reference list
     (`ThreeColumnLayout.tsx:313-321`) — rename is the one that skipped it. A
     Problems scan finds the damage afterwards (`knowsinfo-dangling`), but only
     for files the scan has parsed, and the cap in #467 means that can be a
     subset of an 890-file project. Also note the doc half: `dialogUtils.ts:124`
     calls `planDialogRename` "the one place these rules live" while the
     identifier-shape rule lives at `ThreeColumnLayout.tsx:371-382`, and
     `dialog-editor.md` says nothing about a rename being file-local.
   - **What the user loses:** a mod that stops compiling after a rename, with the
     one dialog that could have warned them saying there was nothing to warn
     about. The fix is manual, in files they may never open.
   - **Test that does not exist:** rename a dialog referenced from a second
     file's NpcKnowsInfo condition, and assert the confirmation lists that file.
   - **Minimal fix:** compute the list where the dialog is already being planned
     — scan `projectStore.parsedFiles` for `NpcKnowsInfoCondition.dialogRef`
     equal to the old name, minus the active file — and pass it. If the decision
     is instead that renames stay file-local, delete the prop and say so in
     `dialog-editor.md`; leaving a permanently-empty warning is the one wrong
     answer, because the code reads as if the check runs.
   - **If we skip it:** the confirmation's warning block is dead code that
     promises a check nobody runs, and the invariant this slice is judged on —
     rename keeps every reference that points in — is false across files with
     the UI's blessing.

## Should fix

5. **The delete confirmation is computed on the merged model and applied to one
   file, so the list it shows is not the set it deletes**
   (`src/renderer/components/ThreeColumnLayout.tsx:303-331` for the preview,
   `:337-342` for the apply; `src/renderer/store/fileStore.ts:567`)
   - **What this is:** in project mode `semanticModel` is the merged model, so
     `computeDialogDeletionSet(merged, target)` decides what will be deleted from
     every dialog and function in the project. `historyActions.removeDialog`
     then recomputes the same question against `activeFile`'s model alone.
   - **Problem:** the two disagree whenever ownership crosses a file. Reproduced
     with two files: `DIA_A` in file A reaches `SHARED_BRANCH`, which file B's
     `DIA_B` also targets. The preview says `['DIA_A_Info']` — `SHARED_BRANCH` is
     retained because a surviving dialog uses it — and the store deletes
     `['DIA_A_Info', 'SHARED_BRANCH']`, because file B is not in its model. File
     B's choice target is then dangling, and it was never listed. The same hole
     has a second shape: `targetFilePath` is `filePath || activeFile`, so a
     dialog that lives in a file other than the active one (the conflict chip and
     `openFile` both move `activeFile` without touching `selectedDialog`) makes
     `removeDialog` a no-op, while the tab still closes and the dialog is still
     listed — a delete that reports nothing and does nothing. The preview also
     costs 70–134 ms on a project-sized merged model (measured: 3,560 and 8,900
     dialogs), because its reference scan `JSON.stringify`s every function's
     actions once per deletable name.
   - **What the user loses:** an authored shared function, deleted with a
     confirmation that promised it would survive; or a delete that quietly did
     nothing. Both are invisible until the mod is compiled.
   - **Test that does not exist:** a project-mode delete where the target's owned
     function is reachable from a dialog in another file — assert the confirmed
     set is the set the store removes.
   - **Minimal fix:** build the preview from the same model the store will mutate
     (`useEditorStore.getState().openFiles.get(targetFilePath)?.semanticModel`).
     That makes the two agree, drops the cost to a file's worth of functions, and
     turns "this dialog is not in that file" into a disabled Delete rather than a
     silent no-op. Retention that genuinely needs the whole project is a store
     decision, not a preview one.
   - **If we skip it:** the confirmation dialog's entire job is to state what is
     about to be deleted, and in project mode it states a different set.

6. **A dialog whose choices all sit inside an `if`/`else` gets no expander, so
   its nested choices are unreachable from the tree**
   (`src/renderer/components/DialogTree.tsx:52-55`)
   - **What this is:** the collapsed-row test for "can this be expanded" is
     `infoFuncData.actions.some(a => 'dialogRef' in a && 'targetFunction' in a)`
     — top-level choices only, as its own `// Shallow check` comment admits.
   - **Problem:** the traversal underneath is not shallow: once expanded,
     `buildFunctionTree` walks branches, so the row would have children. It just
     never gets the arrow, and expansion is the only way to flatten them
     (`dialogTreeUtils.ts:49-51`). Conditional dialog is the normal shape —
     `if (Npc_KnowsInfo(other, DIA_X)) { … choices … }` — and #432/#436/#459 live
     in exactly this area.
   - **What the user loses:** the tree silently stops at the dialog for a whole
     class of real dialogs; the choices are only reachable in the action list.
   - **Test that does not exist:** a dialog whose information function holds only
     a `ConditionalAction` with choices reports `hasChildren: true` when
     collapsed.
   - **Minimal fix:** reuse `collectChoiceActions` (`nestedActionUtils.ts:284`),
     which the rest of the app already uses for this question:
     `hasChildren = collectChoiceActions(infoFuncData.actions).length > 0`.
   - **If we skip it:** one helper call's worth of code keeps a third of the tree
     flat, and the tree is the pane that is supposed to show the model.

7. **Deleting a variable writes the file from disk behind the open model, so the
   next save puts the declaration back**
   (`src/renderer/components/VariableManager.tsx:132-145` →
   `src/renderer/store/projectStore.ts:1184-1204` and
   `mutateQuestFile` at `:462-484`)
   - **What this is:** the row's confirm calls `deleteVariable(filePath, range)`,
     which reads the file's *disk* content, cuts the range out, parses, writes,
     and folds the fresh model into the merged model. Nothing in the path reads
     or updates `useEditorStore.openFiles`.
   - **Problem:** if that file is open in the editor, the open model still holds
     the declaration and the merged model no longer does — two answers to "what
     is in this file", on screen at the same time (the dialog editor's `nr`/
     description edits read one, this table reads the other). The write is a
     main-process write like any other, so the watcher suppression means the open
     file is never reloaded. The moment the file is dirty for any reason, the
     2-second auto-save regenerates the whole file from its model and the deleted
     `const` is written back; the user watches a deletion undo itself.
   - **What the user loses:** the deletion, minutes later, with no event that
     explains it. (`addVariable` and `RegisterTopicDialog` share the same
     disk-first write, so the same window exists for an addition — there the open
     model is *behind* and the next save removes it.)
   - **Test that does not exist:** delete a variable whose file is open and
     dirty, then save that file, and assert the declaration stays deleted.
   - **Minimal fix:** refuse (or queue) the delete while the file is open and
     dirty — the smallest correct answer, and one the panel can state in the
     confirmation — or apply the same edit to the open model as well, which is
     the larger fix.
   - **If we skip it:** a destructive action in a management panel can be
     silently reversed by the editor it is standing next to.

## Nice to have

8. **`EditorColumn` is a four-line passthrough of `EditorPane`**
   (`src/renderer/components/EditorColumn.tsx:23-25`; the only caller is
   `ThreeColumnLayout.tsx:567`, which could import `EditorPane` directly)
   - **What this is:** a `forwardRef` wrapper that forwards every prop, untyped
     additions included, under a second name for the same thing.
   - **Fix:** delete the file, import `EditorPane` in `ThreeColumnLayout`. The
     wrapper's own comment in `ThreeColumnLayout` already calls the pane the
     "right-most pane", so nothing reads better either way. −29 lines.

## Verdict

Verdict: fix 1, 2, 3 and 4 first. Finding 1 loses typed text under the app's own
documented save flow and is two lines; 2 makes the two navigation aids dead on
the welcome screen's second button; 3 lands the user on a pane that describes
two different dialogs, in every project, for the most common search result; 4 is
the one that breaks other files, and the confirmation already has the place to
say so. 5 and 6 are the same invariant one level deeper (the confirm states a
set it does not delete; the tree refuses to show choices it can already walk);
7 is a destructive panel writing around the model it sits beside.

Lean: −29 lines possible (finding 8). Finding 4 has a deletion-shaped version
too — if renames stay file-local by decision, the prop and its alert go.

Not checked: the real 890-file Beppo corpus is not on this machine, so finding
5's timings come from a synthetic 3,560/8,900-dialog model and finding 4's blast
radius from reading the reference scan rather than from a real project; and I
ran no Playwright or real-Electron suite, so findings 1 and 2 are read from
component tests and hook probes, not from a click in a packaged app.

`docs/architecture/dialog-editor.md` needs no correction for this slice other
than the sentence finding 4 asks for; its undo/redo and drag-and-drop sections
still describe the code.
