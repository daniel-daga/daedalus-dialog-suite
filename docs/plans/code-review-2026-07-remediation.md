# Code Review Remediation Plan — July 2026

Source: general code review + UI/UX review of master HEAD (2026-07-12), covering renderer state
management, React components, quest editor, Electron main process, parser workspace, and a live
browser-harness UI pass. This file is the prioritized working checklist; delete it when complete
after extracting durable outcomes into `docs/architecture/` (per docs hygiene rules).

Conventions for every item: failing test first (Jest for logic/stores, Playwright for UI flows),
minimal fix, then workspace-level `npm test` + `npm run lint` + typecheck before marking done.

---

## P0 — Data-integrity bugs (small fixes, real corruption/loss vectors)

- [x] **0.1 Bounds-check `updateActionAtPath` + stable identities for non-DialogLine actions**
  `src/renderer/components/ActionsList.tsx:49-50`, `src/renderer/components/nestedActionUtils.ts:54-64`, `src/renderer/components/ActionCard.tsx:108-121`
  Non-`DialogLine` actions get `${type}__${index}` identities, so keys shift on deletion. Within
  the 300 ms debounce window, deleting a card above either appends a duplicate action (unmount
  flush through a stale path — `updateActionAtPath` has no in-range guard and writes at
  `index === length`) or silently discards pending keystrokes (instance reuse + `[action]`
  prop-sync effect). Same bug class was already fixed on the conditions side
  (`ConditionEditor.tsx:118-127` guard + `uiIds` side-table keys) — mirror it.
  Fix: add the in-range guard (closes corruption immediately); key non-DialogLine actions via a
  uiId side-table or extend `ensureActionIds` (`fileStore.ts:29`) beyond DialogLine.

- [x] **0.2 Fix stale-closure write in `ActionCard.flushUpdate`**
  `src/renderer/components/ActionCard.tsx:68-81`; callers: `actionRenderers/SetVariableActionRenderer.tsx:52-53`, `RemoveInventoryItemsActionRenderer.tsx:23-29`, `PickpocketActionRenderer.tsx:26-27`, `StartOtherRoutineActionRenderer.tsx:24-28`
  `flushUpdate` checks dirtiness via refs but writes closure-captured `path`/`localAction`. The
  four select-type renderers call `handleUpdate(...)` + `flushUpdate()` in the same tick: the
  store gets the pre-change value, the debounce timer is cleared, and `flushAllPendingEdits`
  (Ctrl+S/undo) never commits the real value.
  Fix: write via refs (`updateActionRef.current(pathRef.current, localActionRef.current)`), or
  add a `handleImmediateUpdate` like `useConditionUpdate.ts:68-75`.

- [x] **0.3 Quest condition-expression editing: stop round-tripping display strings**
  `src/renderer/quest/domain/questGraphSharedHelpers.ts:127-159`, `quest/domain/conditionExpressionCodec.ts:99-132`, `quest/domain/commands/setConditionExpression.ts:31-34`, `components/QuestEditor/Inspector/QuestInspectorPanel.tsx:254`
  Inspector prefills from pretty labels ("X has Y", "X is dead"); apply reparses with a codec
  that only understands `Npc_KnowsInfo(...)`, `Npc_IsDead(...)`, `VAR op VALUE`. Anything else
  degrades into a raw generic condition containing the pretty label (invalid Daedalus), and the
  command replaces `fn.conditions` wholesale — also duplicating conditions merged in from the
  dialog's separate condition function onto the info function.
  Fix: emit codec-parseable source forms from `getConditionExpression` (or carry structured
  conditions and derive the editable text from the codec), and target the actual owner function(s).

- [x] **0.4 Route dialog creation through history**
  `src/renderer/components/ThreeColumnLayout.tsx:43,49` → `components/hooks/useDialogFactory.ts:207`
  Creation writes via raw `fileStore.updateModel`, pushing no undo snapshot; next Ctrl+Z fuses
  creation with the previous edit's revert. Fix: pass `historyActions.updateModel` into
  `useDialogFactory` (the same component already uses history-wrapped remove/rename).

## P1 — Security / IPC (contradict the documented security invariant)

- [x] **1.1 Remove/neuter `settings:addRecentProject` whitelist bypass**
  `src/main/main.ts:443-452` (cf. the gate comment at `main.ts:414-431`)
  The handler calls `pathValidator.addAllowedPath` on an unvalidated renderer-supplied path and
  persists it into recents, which `isKnownRecentProject` then trusts forever — a compromised
  renderer can whitelist `C:\` and read/write anywhere via `file:read`/`file:write`. No
  production renderer code calls the channel (only the mock).
  Fix: delete the channel; persist recent projects main-side inside `project:openFolderDialog`.
  Update `docs/architecture/security-model.md` if the channel removal changes the documented surface.

- [x] **1.2 Validate `fileWatcher:start` path**
  `src/main/main.ts:455-462`
  Only path-accepting handler with no `pathValidator.validatePathResolved` check; allows watching
  arbitrary directories. One-line fix mirroring `project:buildIndex` (`main.ts:381-395`).

## P2 — Silent-failure UX (highest user-facing payoff)

- [ ] **2.1 Surface project-open failures**
  `src/renderer/store/projectStore.ts:354-359`, `src/renderer/App.tsx:170-173`
  `openProject` catches everything into `loadError` — written in 6 places, read by zero
  components — and doesn't rethrow, so the App snackbar path never fires; user stays on the
  welcome screen with no message. Fix: rethrow from `openProject` (App already handles it) or
  render `loadError`; delete the now-redundant write-only `loadError` writes.

- [ ] **2.2 Wire a real save shortcut / stop advertising Ctrl+S**
  `src/renderer/utils/saveError.ts:46-54`, `App.tsx:268`, `components/SourceCodeEditor.tsx:139` (unmounted), `components/hooks/useDialogEditorCommands.ts:183` (unused `handleSave`)
  Error copy says "retry with Ctrl+S" but no mounted component handles it, and no manual Save
  button exists. Fix: global Ctrl+S → flush pending edits + `saveFile(activeFile)`, plus a retry
  affordance next to the save-error indicator; or fix the copy.

- [ ] **2.3 Make save state visible**
  `src/renderer/App.tsx:244-266`, `hooks/useAutoSave.ts:151-160`, `App.tsx:519`
  No dirty indicator while typing; post-save state is an icon-only glyph with tooltip-only
  explanation; persistent autosave failure never escalates; error snackbar auto-hides in 5 s.
  Fix: dirty/saved status chip with text, snackbar or persistent banner on repeated autosave
  failure, errors persist until dismissed.

- [ ] **2.4 Un-dead-end the parse-error state**
  `src/renderer/components/SyntaxErrorsDisplay.tsx:21-23`, `ThreeColumnLayout.tsx:452-453` vs `MainLayout.tsx:143-147`
  Banner says visual edits are possible-but-lossy; red panel says the file cannot be edited —
  contradictory (verified visually). Error details omit line/column even though the error objects
  carry them; no reload/open-externally affordance.
  Fix: reconcile the two messages, render line/column, add "Open in external editor" /
  "Reveal in folder" + a reload button in place.

- [ ] **2.5 Escape must not arm deletion**
  `src/renderer/components/ActionCard.tsx:232-236`, `components/common/DeleteConfirmDialog.tsx:32-38`
  Escape in an action field opens "Delete action" with the Delete button auto-focused
  (verified: `document.activeElement` = Delete) — Escape→Enter deletes the action.
  Fix: focus Cancel by default; keep Delete reachable via Tab. Consider whether Escape should
  open a delete confirm at all; add a shortcuts popover for the Enter/Tab/Ctrl+Enter grammar.

## P3 — Divergent duplicate implementations (stops P0/P2 classes from recurring)

- [ ] **3.1 Auto-save must call `fileStore.saveFile`**
  `src/renderer/hooks/useAutoSave.ts:69-163` vs `store/fileStore.ts:708-796`
  The reimplementation has diverged: EXTERNAL_MODIFICATION goes to `saveError` instead of
  `markExternalConflict` (auto-save then retries a doomed write every tick; conflict dialog never
  raised from this path), and the success path writes `hasErrors: false` in violation of the
  parse-state invariant (`fileStore.ts:124-131`, save-pipeline.md). Keep only candidacy/
  scheduling in the hook.

- [ ] **3.2 Single action-type registry**
  `src/renderer/components/actionRenderers/index.tsx:84-112`, `components/common/ActionTypeMenu.tsx:30-57`, `components/ActionCard.tsx:239-267`
  Labels/icons maintained in three tables, already drifted (label mismatch for `customAction`,
  menu omits `commentAction`, icon fallbacks disagree). One registry
  `Record<ActionTypeId, { renderer, label, icon, addable? }>` consumed by all three
  (this is the documented rule in `docs/architecture/dialog-editor.md`).

- [ ] **3.3 Deduplicate add-action flows**
  `components/hooks/useDialogEditorCommands.ts:79-160` vs `components/hooks/useActionManagement.ts:285-385`
  `addActionToEnd` clones `addActionAfter`'s choice-seeding and createTopic-companion logic.
  Express append as insert-after-last or extract one shared helper.

- [ ] **3.4 Single source of truth for validation types**
  `src/main/services/ValidationService.ts:8-65`, `src/main/services/CodeGeneratorService.ts:4-9`, `src/shared/types.ts:533-565`
  Triplicated and drifted (`'invalid_string_content'` crosses IPC but is missing from the shared
  union). Move to `src/shared/types.ts`; main + renderer import from there.

- [ ] **3.5 Render condition menu/templates from `conditionRegistry`**
  `src/renderer/components/ConditionEditor.tsx:152-233, 433-468`
  Hard-coded 9-branch template switch + 9-item menu duplicate the registry. Add
  `menuLabel`/`createDefault()` to `RegistryEntry`; render from the registry.

## P4 — Correctness (medium severity, batch by area)

Renderer stores:
- [ ] 4.1 `projectStore` write-after-await races: background parse / `getSemanticModel` overwrite
      a user-edited cached model (`projectStore.ts:414-443, 536-560`). Skip writes for files
      open in `useFileStore` or with a newer `parsedFiles` entry.
- [ ] 4.2 Undo/redo pops stacks before apply; source-dirty refusal silently consumes steps
      (`historyStore.ts:342-357, 442-455` + `fileStore.ts:1024-1037`). Check `isSourceDirty` in
      the plan phase.
- [ ] 4.3 `clearSearch` doesn't bump `currentSearchId` — in-flight chunked search repopulates
      cleared results (`searchStore.ts:95-102`). Increment id + reset `isSearching`.
- [ ] 4.4 Quest node drags mark the file dirty but positions are never persisted — phantom saves
      and close-guard prompts (`historyStore.ts:495-524`). Persist positions or stop dirtying.
- [ ] 4.5 `updateModel`/`_applyHistoryModelUpdate` near-duplicates; neither clears `saveError`
      contrary to the field contract (`fileStore.ts:337-351` vs `1024-1038`). Dedupe + clear.
- [ ] 4.6 `closeProject` doesn't reset `questFiles` (`projectStore.ts:482-509`).

Quest editor domain:
- [ ] 4.7 Case-sensitivity divergence: graph builder uses exact-case `TOPIC_`→`MIS_` replace and
      `===` comparisons while guardrails are case-insensitive (`quest/domain/graph.ts:36` vs
      `utils/questIdentity.ts:14`; `questNodeIdentification.ts:104,145,158`). Use
      `getQuestMisVariableName`/`isCaseInsensitiveMatch` in the graph pipeline.
- [ ] 4.8 `updateConditionLink` matches the OLD condition with the NEW operator and hard-coded
      `negated=false` — operator-only edits always fail CONDITION_NOT_FOUND
      (`commands/updateConditionLink.ts:47-57`; UI sends edited values for removal,
      `QuestInspectorPanel.tsx:711-732`). Add `oldOperator`/`oldNegated` to the command.
- [ ] 4.9 Bounds-check `choiceIndex` in `removeTransition.ts:92` / `updateTransitionText.ts:36`
      (raw TypeError escapes the domain's structured-failure contract).
- [ ] 4.10 QuestFlow undo staleness + silent refusals: subscribe to a reactive quest-batch
      selector; populate `message` on refused batch undo (`QuestFlow.tsx:82-98,700-701,728-731`,
      `historyStore.ts:435,462`).

Main process:
- [ ] 4.11 Canonicalize keys for `fileEncodingCache`/`fileStatCache`/`fileLocks` (case/separator
      mismatches silently miss invalidation on Windows; `FileService.ts:26-39` +
      `main.ts:116-119`, cf. `FileWatcherService.ts:22-29` normalizer).
- [ ] 4.12 Make `closeApproved` per-window; reset on window close (guard is dead after macOS
      re-activation; `main.ts:34,127-137,503-510`).
- [ ] 4.13 Persist updater rate-limit timestamp only after a successful fetch; exempt manual
      checks (`UpdaterService.ts:138-147`).
- [ ] 4.14 Align `ParserService` worker-count formula with `worker-reliability.md` (or fix the
      doc) (`ParserService.ts:41` vs `MetadataWorkerPool.ts:87`).
- [ ] 4.15 Treat clean worker exit (code 0) as death in both pools to avoid 30 s stalls
      (`ParserService.ts:65-69`, `MetadataWorkerPool.ts:143-147`).

Parser workspace:
- [ ] 4.16 Skip `comment` nodes in argument extraction (comments become arguments; variadic
      parsers re-emit them) (`src/semantic/parsers/argument-parsing.ts:6-47`,
      `condition-parsers.ts:284-296`, `action-parsers.ts:311-344`).
- [ ] 4.17 `allowPartialModel` generates from an EMPTY model whenever parsing errored (passes are
      skipped on `hasErrors`) — the editor's force-save path can emit a near-empty file. Run the
      passes on errored trees or rename/document the option (`src/utils/parser-utils.ts:44-47`,
      editor `src/main/workers/parser.worker.ts:30-33`).
- [ ] 4.18 Resolve grammar-vs-codegen contradiction on string escapes (grammar implements
      C-style escapes; codegen assumes none — trailing-backslash strings would mis-parse)
      (`grammar.js:233-250` vs `src/semantic/dialogActions.ts:63`). Verify actual Daedalus
      semantics first.

## P5 — UX polish backlog

- [ ] 5.1 Search: search project-wide from `parsedFiles` (or label the scope honestly); include
      lines inside conditional branches (`searchStore.ts:160-255`, `projectStore.ts:819-843`).
- [ ] 5.2 Quest flow view: theme the toolbar/canvas for Light/Gothic (hardcoded dark colors);
      replace developer jargon ("ComfyUI-style node editor defaults", "open a concrete source
      file to apply edits") with user vocabulary; disable litegraph's `show_info` debug overlay
      (T/I/N/V/FPS renders in product UI); investigate unhandled
      `TypeError: ... reading 'focus'` on node click (litegraph internals — all renderer-source
      `.focus()` calls are guarded); keep node titles legible at fit-to-view zoom (litegraph
      hides titles below ~0.5 scale → anonymous boxes).
- [ ] 5.3 Replace native `window.confirm`/`alert` with the MUI confirm pattern for project
      switch/reload (`App.tsx:144`) and variable deletion (`VariableManager.tsx:132-137`);
      variable delete should state irreversibility + show usage count
      (`projectStore.ts:797-817` writes immediately, no undo).
- [ ] 5.4 Keyboard: Alt+Up/Down bindings to `moveAction` for reorder; make handle/insert/delete
      reachable (Tab is intercepted at `ActionCard.tsx:206-213, 337-351`); gate the global
      Ctrl+F listener on the active view (`components/hooks/useSearchNavigation.ts:34-49`,
      `MainLayout.tsx:141`).
- [ ] 5.5 External-conflict dialog: add a diff view (Monaco diff already ships via
      `QuestDiffPreviewDialog`) (`ExternalChangeConflictDialog.tsx:59-111`).
- [ ] 5.6 Empty-project guidance: unfiltered zero-NPC state should explain the file-drop
      workflow (`NPCList.tsx:79-82,121-144`; auto-created EXIT dialogs happen with zero
      notification, `hooks/useFileWatcher.ts:162-192`).
- [ ] 5.7 Small: fix `<h6>`-in-`<h2>` DOM nesting in the Source dialog title (live
      validateDOMNesting warning); quest-batch Undo disabled state needs a tooltip with the
      reason (`QuestFlow.tsx:723`); canvas a11y (`role="img"` + aria-label,
      `QuestLiteGraphCanvas.tsx:759`); clipboard-copy feedback in `DialogSourceViewDialog`;
      decide on one brand ("Dandelion" vs "Daedalus Dialog Editor" productName).

## P6 — Cleanup and refactoring-target bookkeeping

- [ ] 6.1 Dead-code sweep: `SourceCodeEditor.tsx` (unmounted, 228 lines); recent-projects flow
      (half-wired — welcome list can never populate); write-only store fields
      (`pendingValidation` `fileStore.ts:750`, `loadError` after 2.1); updater settings
      (`setUpdaterDismissedVersion`/`setUpdaterAutoCheck`, `SettingsService.ts:156-170`,
      `updater-types.ts:18-22`); quest-model history aliases (`historyStore.ts:582-588`);
      `adjacency` map (`questEdgeBuilding.ts:178-186,374-381`); `resolveOutputSlot`
      (`QuestLiteGraphCanvas.tsx:707-712`); parser `bin/bin`/`bin/src` stale build output +
      broken `examples/` import paths.
- [ ] 6.2 Add to `docs/refactoring-targets.md`: `linking-visitor.ts` god class (968 lines, five
      concerns, literal duplicate methods at :723-731/:743-751 + denormalized `Dialog.actions`
      mirror); `setupIpcHandlers` save-orchestration extraction (`main.ts:172-549`);
      `semantic-model.ts` action registry consolidation (4 registration points, double
      deserialization at :994-995); quest UI files at `components/` root vs the documented
      `components/QuestEditor/` boundary (also outside the boundary test's net); cross-store
      wiring consolidation on the `initStoreSync` pattern.

---

## Verification

- Editor: `pnpm --filter daedalus-dialog-editor test`, `lint`, `typecheck:renderer`, targeted
  Playwright specs for each P0/P2 UI item (`tests/e2e/`), `npm run test:e2e` before closing a tier.
- Parser: `pnpm --filter daedalus-parser test` (includes typecheck), `lint`,
  `npm run test:roundtrip-corpus` after 4.16-4.18.
- P1 items: extend the security-focused main-process tests; update
  `docs/architecture/security-model.md` in the same change.
