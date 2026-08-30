# Code Review Remediation — July 2026

Source: general code review + UI/UX review of master HEAD (2026-07-12), covering renderer state
management, React components, quest editor, Electron main process, parser workspace, and a live
browser-harness UI pass.

**Triaged against the tree 2026-08-29, and the age bought almost no decay.** This file went seven
weeks with no board card, no routing-table row and no `CLAUDE.md` line pointing at it — invisible
work, which is the failure the board exists to prevent. Every one of its 37 unchecked items was
then walked against the current code rather than trusted: **28 are still reproducible today**, 4
had landed, and 5 died with the quest Flow view. Each survivor below carries the file and line
that proves it *now*; the July references were mostly shifted and are gone.

Deleted in that pass, so nobody re-checks them: the six P0/P1 items (all complete); **2.2** (a real
Ctrl+S exists — `hooks/useManualSave.ts`, plus a Save button — though nothing tests the handler
itself); **4.2** (history was rewritten plan-then-commit and `isSourceDirty` is gone, asserted by
`tests/fileStore.dirtyTracking.test.ts`); **4.6** (`closeProject` resets `questFiles`, covered);
**5.5** (the conflict dialog renders `CodeDiffView`); and **4.4, 4.8, 4.9, 4.10, 5.2**, all of
which named litegraph/QuestFlow code that no longer exists.

Conventions for every item: failing test first (Jest for logic/stores, Playwright for UI flows),
minimal fix, then workspace-level `npm test` + `npm run lint` + typecheck before marking done.
Delete an item when it lands; delete this file when it empties.

**If you are picking one thing, pick 2.5** — Escape then Enter destroys an action today, with no
undo prompt and nothing to reveal that deletion was armed.

---

## P2 — Silent-failure UX (highest user-facing payoff)

- [ ] **2.1 Surface project-open failures**
  `store/projectStore.ts:427-432`, `App.tsx:183-184`
  `openProject` still catches everything into `loadError` and never rethrows, so
  `openProjectWithReset`'s own `catch` can never fire and the user stays on the welcome screen
  with no message. `loadError` remains **write-only**: ten writes in `projectStore.ts`
  (`:91, 378, 385, 430, 587, 773, 817, 845, 877, 899`), zero component reads.
  Fix: rethrow from `openProject`, or render `loadError`; delete the redundant writes either way.

- [ ] **2.3 Make save state visible** *(partly remediated)*
  `App.tsx:283-284, 303-309, 563-566`, `hooks/useAutoSave.ts:161-163`
  The dirty signal is icon-and-tooltip only ("Unsaved changes — Ctrl+S to save"); there is still
  no status chip with visible text, the error snackbar still auto-hides after 5 s
  (`autoHideDuration={5000}`), and repeated autosave failure never escalates — `useAutoSave` sets
  `autoSaveError` and `console.error`s, and nothing counts consecutive failures.
  Fix: status chip with text; persistent banner on repeated failure; errors persist until dismissed.

- [ ] **2.4 Un-dead-end the parse-error state** *(partly remediated)*
  `MainLayout.tsx:60, 163-167` vs `ThreeColumnLayout.tsx:121, 493-495` and
  `SyntaxErrorsDisplay.tsx:21-22, 77-84`
  The contradiction stands, on two near-identical gates: the banner says visual edits are possible
  but lossy ("saving will drop the content the parser could not read") while the panel that
  replaces the editor says the file "cannot be edited until they are fixed". Line and column are
  now rendered (`SyntaxErrorsDisplay.tsx:47-54`); there is still no reload, open-externally or
  reveal-in-folder affordance — the component ends in a plain file-path `Typography`.
  Fix: reconcile the two messages; add reload / open-in-external-editor / reveal-in-folder.

- [ ] **2.5 Escape must not arm deletion**
  `components/ActionCard.tsx:237-240`, `components/common/DeleteConfirmDialog.tsx:29-36, 52-59`
  Escape in an action field calls `setDeleteConfirmOpen(true)`, and the dialog deliberately
  focuses the destructive button (`confirmRef`, commented "so Enter confirms immediately"). So
  **Escape then Enter deletes the action** — the two keystrokes that mean "back out" everywhere
  else.
  Fix: focus Cancel by default, keep Delete reachable by Tab. Reconsider whether Escape should open
  a delete confirm at all; add a shortcuts popover for the Enter/Tab/Ctrl+Enter grammar.

## P3 — Divergent duplicate implementations (stops the P0/P2 classes from recurring)

- [x] **3.1 Auto-save must call `fileStore.saveFile`** — **landed 2026-08-30.** `performAutoSave` keeps candidacy, scheduling and `autoSaveError`; the write is `fileStore.saveFile`, so an `EXTERNAL_MODIFICATION:` rejection routes through `markExternalConflict` and the success path no longer touches `hasErrors`/`errors`. Cost: each file commits its own `set()`, so a multi-file tick is N store updates, not one.
  `hooks/useAutoSave.ts:73-95, 88-92, 125-126, 135-144` vs `store/fileStore.ts:766-792`
  The hook still calls `window.editorAPI.saveFile` directly and both divergences persist: an
  `EXTERNAL_MODIFICATION` rejection becomes a plain `saveError` with `isDirty: true` instead of
  `markExternalConflict`, so the file stays dirty and non-conflicted and `isAutoSaveCandidate`
  re-selects it **every tick** while the conflict dialog is never raised from this path; and the
  success path writes `hasErrors: false, errors: []`, which the store's own success path
  deliberately does not touch (the parse-state invariant, `save-pipeline.md`).
  Fix: keep only candidacy and scheduling in the hook; route the write through `fileStore.saveFile`.

- [ ] **3.2 Single action-type registry**
  `actionRenderers/index.tsx:83-111`, `common/ActionTypeMenu.tsx:30-57`, `ActionCard.tsx:243+`
  Three tables, already drifted: `customAction` is "Action" in one and "Custom Action" in the
  other, `commentAction` is missing from the menu entirely, and the icons are a third switch.
  Fix: one `Record<ActionTypeId, { renderer, label, icon, addable? }>` consumed by all three — the
  rule `docs/architecture/dialog-editor.md` already documents.

- [ ] **3.3 Deduplicate add-action flows**
  `hooks/useDialogEditorCommands.ts:79-158` vs `hooks/useActionManagement.ts:285-379`
  `addActionToEnd` still re-implements the choice sub-function seeding and the
  createTopic to logSetTopicStatus + logEntry companion insertion that `addActionAfter` performs
  through `insertActionAfterPath`.
  Fix: express append as insert-after-last, or extract one shared helper.

- [ ] **3.4 Single source of truth for validation types**
  `main/services/ValidationService.ts:8-16, 21-36, 481`, `shared/types.ts:583-591`,
  `main/services/CodeGeneratorService.ts:4-9`
  Still triplicated and still drifted in the direction that crosses IPC: `ValidationService` emits
  `invalid_string_content` and the renderer handles it (`ValidationErrorDialog.tsx:44, 58`), but
  the shared union omits it. `CodeGeneratorSettings` keeps a private copy too.
  Fix: move to `shared/types.ts`; main and renderer both import from there.

- [ ] **3.5 Render condition menu/templates from `conditionRegistry`**
  `components/ConditionEditor.tsx:164-236, 442-477`,
  `components/conditions/conditionRegistry.tsx:25-29`
  Still a 9-branch template switch plus 9 hand-written `MenuItem`s; `RegistryEntry` is still
  `{ icon, label, Fields }`.
  Fix: add `menuLabel` and `createDefault()` to `RegistryEntry`; render both from the registry.

## P4 — Correctness (medium severity, batch by area)

Renderer stores:
- [x] 4.1 **Landed 2026-08-30.** `getSemanticModel` now stamps the file before the await and
      drops its cache write if the stamp moved — `invalidateCacheForFile`, `clearCache`,
      `closeProject` and `updateFileModels` all bump it. The caller still gets the model it
      asked for; only the shared cache is protected. Test: `projectStore.staleCacheWrite`.
      The "skip writes for open files" half is covered *indirectly* and not by importing
      `useFileStore` (which would be a cycle — `fileStore.ts:12` imports `projectStore`):
      `storeSync` pushes every open file's model through `updateFileModel`, so the editor's
      model always wins over a parse in flight, and a cached entry means no parse starts at
      all. **Residual, unowned:** `enforceParsedFilesCap` does not pin open files, so if an
      open file's entry is evicted on a project past the 512-file cap, the next
      `getSemanticModel` re-parses from disk and caches a model without its unsaved edits.
      Pinning needs the open-file set, which is the import projectStore cannot have.
- [x] **4.3 `clearSearch` cancels the in-flight search** — **landed 2026-08-30.** It bumps
      `currentSearchId` and sets `isSearching: false`, so a chunked search that was mid-yield
      fails both cancellation guards and returns without writing its results.
- [ ] 4.5 `updateModel` (`fileStore.ts:372-382`) and `_applyHistoryModelUpdate` (`:932-942`) have
      byte-identical bodies, and neither clears `saveError` though every sibling mutator does
      (`:393, 417, 452, 476, 499, 539, 648, 681`). Dedupe and clear.
- [ ] 4.7 Case-sensitivity divergence: `quest/domain/graph.ts:36` does an exact-case
      `TOPIC_` to `MIS_` replace and `questNodeIdentification.ts:106, 147, 160, 271` compare with
      `===`, while `utils/questIdentity.ts:15-17` is case-insensitive.
      **Consider deleting instead of fixing:** `buildQuestGraph` has no production caller left
      after the Flow-view removal — only tests reach it, and the components that import
      `quest/domain` (`QuestDetails.tsx:30`, `QuestList.tsx:35`) use analysis only. Decide which,
      and record the decision in `docs/architecture/quest-editor.md`.

Main process:
- [ ] 4.11 `FileService.ts:26, 33, 39` keys `fileEncodingCache`/`fileStatCache`/`fileLocks` on the
      raw `filePath`, and `main.ts:120-123` passes the watcher's path straight into the cache
      clears. `FileWatcherService.ts:24-27` already has the canonicalizer (normalize, then `/`,
      then lowercase on win32) but applies it only to self-write suppression. Apply it to the keys.
- [ ] 4.12 `closeApproved` (`main.ts:33`) is module-global, set at `:138` and `:473`, and the
      `mainWindow.on('closed')` handler (`:143-146`) never resets it — so after a macOS
      re-activation the guard at `:132` short-circuits permanently. Make it per-window.
- [ ] 4.13 `UpdaterService.ts:154` writes the rate-limit timestamp *before* the `httpsGet` at
      `:158`, so a network failure still burns the hour. `checkForUpdate()` (`:129`) takes no
      arguments, so a manual check cannot be exempted either (`main.ts:483-485`, `preload.ts:87`).
- [ ] 4.14 The worker-count formula contradicts its own architecture doc:
      `docs/architecture/worker-reliability.md:36` states both pools cap at
      `Math.max(1, Math.min(os.cpus().length - 1, 8))`; `MetadataWorkerPool.ts:101` matches but
      `ParserService.ts:61` is `Math.max(2, Math.min(numCPUs, 8))` — different floor, no `-1`.
      Fix one to match the other, and say in the doc which is right.
- [ ] 4.15 Both pools still treat a clean exit as normal — `ParserService.ts:96-100` and
      `MetadataWorkerPool.ts:160-164` both guard on `code !== 0`, so a worker exiting 0 is never
      reaped and callers stall for 30 s.

Parser:
- [x] 4.16 Comments become arguments: all three extractors filter punctuation only —
      `argument-parsing.ts:10` and `:38`, and `condition-parsers.ts:297` (`parseRawCallArguments`)
      — so a `comment` node inside an argument list is collected as an argument. Other visitors do
      skip comments (`linking-visitor.ts:182, 282, 705, 904`), so the pattern exists and simply was
      not applied here. **Fixed 2026-08-30**: the three sites share `isArgumentNode`, which excludes
      `comment` along with the punctuation. A comment inside an argument list is now lost on
      regeneration instead of displacing the arguments after it — the corpus numbers are unchanged.
- [ ] 4.17 `allowPartialModel` generates from an EMPTY model whenever parsing errored:
      `parser-utils.ts:45-47` returns as soon as `hasErrors`, skipping `pass1_createObjects` and
      `pass2_analyzeAndLink`, and the editor worker duplicates it verbatim
      (`main/workers/parser.worker.ts:30-33`). The force-save path can therefore emit a near-empty
      file. Run the passes on errored trees, or rename and document the option.
- [ ] 4.18 The grammar contradicts both the doc and codegen on string escapes.
      `docs/reference/parser-roundtrip-scope.md:19-27` declares Daedalus has **no** string escape
      sequences and codegen agrees (`generator.ts:483-492` just wraps in quotes), but
      `grammar.js:233-249` still implements C-style escapes — so a string ending in a backslash
      consumes its own closing quote. No trailing-backslash test exists. Settle the real Daedalus
      semantics first, then make all three agree.

## P5 — UX polish backlog

- [ ] 5.1 Search is not what it says: `performSearch` reads only the in-memory `semanticModel`,
      never `parsedFiles`, and the text pass (`searchStore.ts:228-246`) walks only top-level
      `func.actions`, so lines inside `thenActions`/`elseActions` are invisible. The panel still
      calls itself "Global Search" (`SearchPanel.tsx:78-80`). Widen the scope or label it honestly.
- [ ] 5.3 Native dialogs remain: `App.tsx:156` `window.confirm` for the unsaved-changes prompt,
      `VariableManager.tsx:132, 137` `confirm`/`alert` for variable deletion. Replace with the MUI
      confirm pattern; variable delete should state irreversibility and show a usage count
      (`projectStore.ts` writes immediately, with no undo).
- [ ] 5.4 Keyboard, two parts left of three: there is still no Alt+Up/Down reorder binding
      anywhere, and Tab is still swallowed at `ActionCard.tsx:211-218` so the handle, insert and
      delete controls are unreachable. *(The Ctrl+F view gate landed —
      `hooks/useSearchNavigation.ts:44-46`.)*
- [ ] 5.6 Empty-project guidance: `NPCList.tsx:121-144` renders the empty state only when
      `npcFilter` is set, so an unfiltered zero-NPC project shows a blank pane instead of the
      file-drop workflow. Auto-created EXIT dialogs still notify nobody —
      `hooks/useFileWatcher.ts:210-247` only `console.error`s.
- [ ] 5.7 Small, three left: an `h6` inside the `h2` of `DialogSourceViewDialog.tsx:82-83` (live
      `validateDOMNesting` warning); no clipboard-copy feedback (`:85-89` calls `handleCopy` with
      no Snackbar); and the brand is still split — "Dandelion" in `App.tsx:236, 462` and
      `index.html:22` against `"productName": "Daedalus Dialog Editor"` in `package.json:46`.
      *(The two QuestFlow sub-items died with the Flow view.)*

## P6 — Cleanup and refactoring-target bookkeeping

- [ ] 6.1 Dead-code sweep, roughly half done. *Swept:* `SourceCodeEditor.tsx`, the recent-projects
      flow (now fully wired, `main.ts:334, 403` into `App.tsx:126-131, 488-496`), the quest-model
      history aliases, `resolveOutputSlot`. *Still dead:* `pendingValidation`
      (`fileStore.ts:759, 781, 809, 926`, read by nothing); `loadError` (see 2.1);
      `SettingsService.ts:164` `setUpdaterAutoCheck` (no caller); the `adjacency` map built and
      returned at `quest/domain/questEdgeBuilding.ts:178-186, 381` and never consumed; and in the
      parser, `bin/bin/` + `bin/src/` stale build output plus
      `examples/code-generator-usage.ts:4-7`, which imports `../src/parser-utils`,
      `../src/semantic-visitor` and `../src/semantic-model` — internal paths, which the parser's
      own hygiene rule bans, and which no longer exist under the current
      `src/{core,semantic,codegen,utils}` layout. That example cannot compile.
- [ ] 6.2 Add to `docs/refactoring-targets.md` (none of the five are there, and all five still
      hold): `linking-visitor.ts` god class (**1016** lines, five concerns, literal duplicate
      methods, denormalized `Dialog.actions` mirror); `setupIpcHandlers` save-orchestration
      extraction (`main.ts:193-735`); the double deserialization at `semantic-model.ts:1005-1014`
      (`ensureActionType` runs, then `deserializeAction` calls it again); quest UI files at
      `components/` root against the `components/QuestEditor/` boundary that
      `docs/architecture/quest-editor.md:8, 41` documents and no test guards; and cross-store
      wiring consolidation on the `initStoreSync` pattern (`store/storeSync.ts:36`).

---

## Verification

- Editor: `pnpm --filter daedalus-dialog-editor test`, `lint`, `typecheck:renderer`, targeted
  Playwright specs for each P2 UI item (`tests/e2e/`), `npm run test:e2e` before closing a tier.
- Parser: `pnpm --filter daedalus-parser test` (includes typecheck), `lint`,
  `npm run test:roundtrip-corpus` after 4.16-4.18.
