# Editor review — 2026-11-01, slice 3: edit, undo and save

Slice: `src/renderer/store/fileStore.ts`, `store/historyStore.ts`,
`store/historyActions.ts`, `store/storeSync.ts`, `src/renderer/hooks/`
(`useAutoSave`, `useFileWatcher`, `useManualSave`, `useNavigation`,
`useWindowCloseGuard`), and the main-process half of the save:
`main/services/FileService.ts`, `FileWatcherService.ts`, `SaveFileFlow.ts`,
`CodeGeneratorService.ts`, `ValidationService.ts`.

Commit reviewed: `62fdb8b`. Date: 2026-11-01.

**Load assumed.** A debounced edit every 300 ms while typing (the timer is the
one in `ActionCard.tsx` and `useConditionUpdate.ts`); auto-save armed at 2000 ms
of quiet and firing on its own; chokidar events from an external editor or a
`git checkout` that touches many of the 890 files at once; several files open
at a time, only one of them active; and a save that must not leave a half-written
file behind. Judged against that: the per-edit paths (dirty rule, mid-save
guard, flush registry) hold, and the things that break are the ones that cross
an `await` — a batch reload of several files, a save that a watcher event
interleaves with, and the second writer of the same model that is not the
dialog editor.

**What this slice does:** a keystroke lands in a component's local state for
300 ms, then goes into the file's `semanticModel` in `fileStore` (through
`historyActions`, which records a snapshot first and marks the file dirty).
Auto-save or Ctrl+S flushes any pending keystroke, validates and regenerates the
whole file in the main process (`SaveFileFlow` → `ValidationService` →
`CodeGeneratorService`), and `FileService` stages it to a sibling temp file,
fsyncs, and renames it into place with a disk-version precondition. External
changes come back through chokidar, are batched for 250 ms, and either reload a
clean file in place or mark a conflict on a dirty one.

Checks run: the focused suites `fileStore.dirtyTracking`, `fileStore.saveRace`,
`fileStore.diskVersion`, `autoSave`, `useAutoSave.conflictRouting`,
`useFileWatcher.conflict`, `useFileWatcher.batching`, `historyStore.editHistory`,
`historyActions.noop`, `closeGuard`, `FileService.atomicWrite`,
`FileService.conflictGuard` (all pass), plus two throwaway probes in a scratch
test file — both findings 1 and 2 below are reproduced by them, not inferred.
No repo file was edited except this report.

## What already holds, and the test that would fail if it broke

| Rule | Test |
|---|---|
| `isDirty` means "the model is not `savedModel`", so undoing back to the saved model is clean | `tests/fileStore.dirtyTracking.test.ts:113` |
| an edit that lands during a save stays dirty and is written by the next save | `tests/fileStore.saveRace.test.ts:35`, `tests/autoSave.test.ts:375` |
| a failed save never clears dirty, and records `saveError` by kind | `tests/autoSave.test.ts:419`, `:448`, `:477` |
| auto-save candidacy excludes parse-errored, validation-refused and conflicted files | `tests/autoSave.test.ts:320`, `:350`, `tests/useAutoSave.conflictRouting.test.ts` |
| a pending debounced edit is flushed before auto-save, Ctrl+S and close | `tests/autoSave.test.ts:508`, `tests/closeGuard.test.tsx:216` |
| a save carries, and adopts, the disk version it wrote | `tests/fileStore.diskVersion.test.ts:52`, `FileService.conflictGuard.test.ts:60` |
| a write that fails mid-way leaves the original file byte-identical and no temp file | `tests/FileService.atomicWrite.test.ts:98` |
| force-on-errors writes a `.bak` first and refuses the save if it cannot | `tests/FileService.atomicWrite.test.ts:179` |
| a lossy encoding is refused rather than `?`-substituted | `tests/FileService.encodingRoundtrip.test.ts` |
| an external change to a dirty file is a conflict, not a reload; to a clean one, an in-place reload | `tests/useFileWatcher.conflict.test.ts:117`, `:149` |
| a batch parses each path once, indexes once, and an older batch cannot win | `tests/useFileWatcher.batching.test.ts:123`, `:251` |
| a no-op mutation pushes no phantom undo step and keeps the redo stack | `tests/historyActions.noop.test.ts:69` |
| close with nothing unsaved approves; with unsaved work it lists, saves or asks | `tests/closeGuard.test.tsx:93`, `:106`, `:165`, `:181` |

The flush-before-undo rule holds for the keyboard only — see finding 3.

## Must fix

1. **An edit made while the watcher reloads another file is replaced by the disk copy, with no conflict**
   (`src/renderer/hooks/useFileWatcher.ts:162` and `:170`; the guard it feeds,
   `src/renderer/store/fileStore.ts:946-958`)
   - **What this is:** `flushChangedFiles` reads the open-file map once (`:162`) and then loops over the batch, awaiting one `reloadFile` per open file (`:186`). Whether a file may be reloaded is decided from that captured map (`:170`, `:179`).
   - **Problem:** Every `await` in that loop lets the renderer do work. A keystroke in file B that goes through its 300 ms debounce while file A is being reloaded commits to B's model — but the map captured at `:162` still says B is clean, so the loop reloads B and overwrites the edit. `reloadFile` cannot catch it either: it compares the state to itself *after* it started (`:946-952`), and an edit that landed before the reload began is already inside that "started" snapshot, so `changedDuringReload` is false and the disk model is applied over the dirty one. Reproduced: two clean files open, both changed externally in one batch, an `updateModel` on the second while the first's read is parked — after the batch the second file has `isDirty: false`, the edited value gone, `externalConflict` unset, `originalCode` the new disk text. Nothing asks. The doc's known residual (`save-pipeline.md`, external-modification conflicts) is about a keystroke during a *clean* reload of the *same* file; this is a different file losing an edit that had already reached the store.
   - **What the user loses:** A dialog line or condition typed within a few hundred ms of a bulk external change (a `git checkout`, a formatter, a second editor) is gone and the file looks saved.
   - **Test that does not exist:** a two-file batch where the second file gains a committed edit while the first is still reading; assert the second keeps the edit and ends in `externalConflict`. `tests/useFileWatcher.batching.test.ts` covers one path racing itself (`:251`, `:290`), never two files.
   - **Minimal fix:** read the live state inside the loop — `const openFileState = useFileStore.getState().openFiles.get(filePath);` and `useFileStore.getState().reloadFile(filePath)` — instead of the `fileStore` captured at `:162`. That one line puts the dirty check after every earlier `await`. (Optional belt: have `reloadFile` set a conflict instead of applying when the *current* state has unsaved changes and the caller did not ask to discard; `resolveExternalConflict('reloadTheirs')` is the one caller that does.)
   - **If we skip it:** the exact scenario the editor is built for — a modder with two dialog files open who pulls a branch — silently drops the line they just wrote.

2. **`openFile` throws away an already-open dirty file, and one caller still does it**
   (`src/renderer/store/fileStore.ts:376-398`; caller `src/renderer/components/Problems/ProblemsPanel.tsx:93`)
   - **What this is:** `openFile` always reads the file and `set`s a brand-new `FileState` over the existing entry (`:395-398`). It has no "already open" branch and no discard prompt; `reloadFile` is the separate, guarded path for re-reading.
   - **Problem:** Reproduced: open a file, dirty it, call `openFile` again — `isDirty` is false and the edit is gone. #377 fixed the two navigation call sites (`useNavigation.ts:21`, `useDialogNavigation.ts:127`) rather than the store, so the hole is one call away for anyone new. One caller is still unguarded: the Problems panel's fallback jump (`ProblemsPanel.tsx:93`, "the file that owns the declaration"), which runs whenever neither navigator resolves the row — i.e. for the waypoint/routine sites that only the whole-project index knows. Click a Problems row for a file that is open and dirty and its edits are replaced by the disk text, with no prompt and no conflict. (`App.tsx:290` also calls `openFile` to reload — that one is deliberate and becomes `reloadFile` under the fix.)
   - **What the user loses:** everything unsaved in that file, on a single click in a panel designed to be browsed.
   - **Test that does not exist:** `openFile` on a path already in `openFiles` with `isDirty` returns the same `FileState` untouched. `tests/fileStore.normalizedOnce.test.ts:83` currently asserts the opposite behaviour (a second `openFile` re-walks the model), so it needs a `closeFile` between its two opens — that test is about the `ensureActionIds` memo, not about overwrite semantics.
   - **Minimal fix:** at the top of `openFile`, `if (get().openFiles.has(filePath)) { get().setActiveFile(filePath); return; }`; change `App.tsx:290`'s reload to `reloadFile(activeFile)`.
   - **If we skip it:** the same class of bug returns with every new navigation surface, and the one that exists today loses work without a word.

3. **The app-bar Undo/Redo buttons skip the pending-edit flush**
   (`src/renderer/App.tsx:313`, `:326`; the path that does it right is `src/renderer/components/MainLayout.tsx:109-113`)
   - **What this is:** `save-pipeline.md` §"Pending-edit flush registry" makes it a rule: every save/discard **and undo/redo** entry point calls `flushAllPendingEdits()` first, at the UI layer. The Ctrl+Z/Ctrl+Y handler does, inside `flushSync`. The two toolbar buttons call `undo(activeFile)` / `redo(activeFile)` directly.
   - **Problem:** Click the Undo button within 300 ms of a keystroke and the model is reverted while the ActionCard still holds the typed text in its own state and its timer is still armed. When the timer fires it writes that text back (`ActionCard.tsx:98-110`), which is a real edit: it pushes a fresh snapshot and clears `future`. So the undo does not visibly undo, and the redo branch the user was about to use is destroyed. The keyboard path avoids exactly this, which is what `ef8dd11` fixed — the buttons were not in that fix.
   - **What the user loses:** the last undo step (it is re-consumed by the echo), and the redo stack, with no error.
   - **Test that does not exist:** register a flusher, click `appbar-undo-button`, assert the flusher ran before `undo`. `tests/App.worldUndoButtons.test.tsx` only checks enabled/disabled state.
   - **Minimal fix:** one handler beside the existing ones in `App.tsx` — `flushAllPendingEdits(); undo(activeFile);` (and the same for redo). `flushSync` is not needed here: a click is its own task, unlike the keydown batch.
   - **If we skip it:** the documented contract holds on the keyboard and not on the button, and the failure looks like "undo sometimes does nothing".

4. **Routine, quest-diary and NPC-editor saves never record an undo step**
   (`src/renderer/components/routineSave.ts:54` and `:114`, `src/renderer/components/questDiarySave.ts:21`, `src/renderer/components/NpcEditorDialog.tsx:381`; the rule they break is stated in `src/renderer/store/historyActions.ts:1-12`)
   - **What this is:** Those three surfaces build a new model and call `useEditorStore.getState().updateModel(filePath, next)` directly, then `saveFile`. `updateModel` records nothing; only the `historyActions` wrapper (`:31-33`) pushes a snapshot.
   - **Problem:** The edit reaches disk but not the per-file history, so the stack's newest snapshot is an *older, unrelated* model. Press Ctrl+Z in that file afterwards and it restores that older model — reverting the routine/quest/NPC change the user saved plus whatever was on top — and since `updateModel` sets `isDirty` when the model differs from `savedModel`, auto-save writes the reverted content to disk two seconds later. One undo silently discards a saved edit the user never asked to undo.
   - **What the user loses:** the routine or quest diary entry they just saved, and any intervening dialog edit, on the next Ctrl+Z.
   - **Test that does not exist:** after `saveRoutine` (or any of the three), `canUndo` is true and one `undo` returns the model *before* that save, not before an earlier one.
   - **Minimal fix:** call `historyActions.updateModel(filePath, next)` instead of the raw `updateModel` at the three call sites — one identifier each, and the coalescing/rollback behaviour comes for free.
   - **If we skip it:** the three newest authoring surfaces are the ones undo corrupts, and the damage lands on disk.

## Should fix

5. **The auto-save timer handle is dropped the moment its own save starts**
   (`src/renderer/hooks/useAutoSave.ts:158-161`)
   - **What this is:** the timer callback calls `performAutoSave()` and then, synchronously, sets `timeoutRef.current = null`.
   - **Problem:** `performAutoSave` starts with `flushAllPendingEdits()` (`:41`), which synchronously writes to the store, which fires the subscription and calls `reschedule`, which arms a *new* timer into `timeoutRef.current` — and the line after the call nulls that handle. The new timer still fires but can no longer be cancelled by `clearPending()`, which is what runs when auto-save is switched off or the hook unmounts. Switching auto-save off while a save is in flight therefore leaves one armed tick that calls `performAutoSave` (candidacy does not consult `autoSaveEnabled`, only the store subscription's arm path does) and writes a file after the user turned it off.
   - **Fix:** swap the two lines: `timeoutRef.current = null;` first, then `void performAutoSave();`.
   - **Test that does not exist:** unregister/disarm mid-save and assert no further `saveFile` call after the interval.

6. **A save over a mapped target leaves the old file in the project folder, forever**
   (`src/main/services/FileService.ts:124-141`, temp cleanup at `:209-213`)
   - **What this is:** when Windows refuses to rename over a target (the asset VFS memory-maps every file under the project root while a world or NPC preview is open), `replaceFile` renames the original aside, puts the new file in place, and best-effort unlinks the aside. The comment at `:139-140` says the aside "stays until the mapping is gone" — but nothing ever retries, so it stays for good.
   - **Problem:** one `.<name>.d.<pid>.<rand>.tmp.old` per save, next to the script, for as long as a world or preview is open — which is the whole of routine/NPC authoring. The name does not end in `.d`, so the watcher and the project scanner ignore it and it accumulates invisibly; `tests/FileService.atomicWrite.test.ts:140` covers only the case where the unlink succeeds (`readdir` is asserted to be exactly one entry, with a mock whose first rename alone fails). A crash between the two renames (1-2 ms) leaves the script missing from its own name, its content only in the aside.
   - **Fix:** keep one aside name per file (`.<basename>.save-aside`) instead of a random one, and unlink it best-effort at the start of the next write of that path — at most one stray file per script, and a crash window whose contents have a predictable name. Whatever is chosen, say in `save-pipeline.md` that the aside is best-effort.
   - **If we skip it:** the editor writes files the user did not ask for into their mod folder, and the crash window has no recovery path.

7. **The docs and the code disagree about whether a save clears undo history**
   (`src/renderer/store/historyStore.ts:289-300` against `docs/architecture/dialog-editor.md:49-56`)
   - **What this is:** the subscription clears a file's history when `originalCode` changes and the file is clean — described in the doc as "history for a file is cleared when it is externally changed or replaced from a source save". `fileStore.saveFile` never writes `originalCode` back (`:855-871`); only `reloadFile` does.
   - **Problem:** Reproduced: save a file and `canUndo` is still true with `originalCode` still holding the text read at open. So the "source save" half of that rule is dead, and the doc reads as if a save drops history. Both behaviours are defensible (keeping history across a save is what most editors do, and undo-then-autosave then rewrites the older content on purpose); what is not defensible is that the next reader has to guess.
   - **Fix:** delete the `originalCode !==` clause and its comment, or make `saveFile` store the generated code as `originalCode` and keep the rule. One line either way, plus the doc sentence that matches it.
   - **Test that does not exist:** whichever behaviour is chosen — `canUndo` after a successful save, asserted once.

8. **An external `add` of an NPC file writes new `DIA_*.d` files into the project**
   (`src/renderer/hooks/useFileWatcher.ts:263` → `src/renderer/utils/npcExitDialog.ts:109-147`)
   - **What this is:** every `add` event goes through `handleFileAdded`, which plans and writes an EXIT dialog file for each C_NPC instance in the added file that has no dialog yet.
   - **Problem:** that is issue #141's intended drop-in workflow, and it is safe (an existing non-empty target is never overwritten) — but it means a `git checkout` of a branch that adds twenty NPC files makes the editor create twenty untracked `.d` files, and nothing in `save-pipeline.md` says the editor may write on an external event at all.
   - **Fix:** none required if it is wanted; one paragraph in `save-pipeline.md` ("writes not caused by a save") is what is missing. If it is not wanted for bulk adds, gate it to the editor's own Create-NPC path, which already calls `handleFileAdded` directly.
   - **If we skip it:** the next person reviewing "nothing the user did not type is written" reports it as a bug.

## Nice to have

9. **`_markFileDirty` has no caller** (`src/renderer/store/fileStore.ts:310`, `:1058-1065`)
   - **What this is:** an interface entry and an implementation that nothing invokes; the file is dirty through every mutation that needs it.
   - **Fix:** delete both, 9 lines.

## Verdict

Verdict: fix 1, 2, 3 and 4 first. Finding 1 loses a keystroke under a load the editor is built for (several open files plus a bulk external change) and needs one line; 2 is the same loss one click away and belongs in the store, not in the callers; 3 is a two-line contract the keyboard already honours; 4 is one identifier per call site in three newer surfaces. 5 and 6 are cheap and stop the editor from writing files nobody asked for; 7 is a doc decision; 8 needs a sentence.

Lean: -9 lines possible (finding 9). Finding 7 either deletes a branch or keeps it — no gain either way.

Not checked: the real 890-file Beppo corpus is not on this machine, so batch sizes were judged from the batching tests and from probe-level timing, not from a `git checkout` against the real project; and I did not run the Playwright or real-Electron suites, so findings 3 and 6 are read from source and component tests rather than from a click in a packaged app.
