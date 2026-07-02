# Issue Tracking

Progress tracker for the GitHub issues triaged in `github-issues.md`.
Source of detail for each issue is `github-issues.md`; this file tracks status only.

Legend: ✅ done · 🚧 in progress · ⬜ not started

## Workflow when an issue is resolved

Marking an issue ✅ here is not the end. For every resolved issue:

1. **Check its live state on GitHub** with `gh` (e.g.
   `gh issue view <n> --json number,state,title`). The status in this file can
   drift from GitHub — an issue fixed in code is often still `OPEN` upstream.
2. **If it is still open, close it with a comment** that tells the original
   reporter what actually happened, in plain terms:
   - what was fixed (and whether it was already on `master` vs. newly done),
   - the commit(s) that carry the fix,
   - the regression test that now guards it.
   Use `gh issue close <n> --comment "..."`. Never close silently — the person
   who opened the ticket should be able to understand the resolution without
   reading the code.

---

## P1 — Bugs

| Issue | Title | Status |
|---|---|---|
| #174 | Wrong variable prefix in LOG_RUNNING condition | ✅ done |
| #116 | B_Attack emits `hero` (unknown identifier) | ✅ done |
| #145 | If/else block: text deleted on "Add Line", missing "knows info" option | ✅ done |
| #117 | Added choice not accessible until user re-clicks NPC | ✅ done |
| #126 | New dialog line defaults to NPC speaker, should default to Hero | ✅ done |

## P2 — Small QOL / UX

| Issue | Title | Status |
|---|---|---|
| #182 | "Add Dialog Line" ignores nesting level; delete button broken in dropdown | ✅ done |
| #181 | Auto-insert dialog line with same text when adding a Choice | ✅ done |
| #140 | "Create Topic" should also insert a "Log Set Status" action | ✅ done |
| #123 | New action: Info_ClearChoices | ✅ done |
| #119 | New action: Npc_SetRefuseTalk | ✅ done |
| #183 (item 3) | Tab key doesn't navigate Giver → Receiver → Item field | ✅ done |
| #118 | Tab key to jump into choice sub-editor | ✅ done |

## P3 — Medium features

| Issue | Title | Status |
|---|---|---|
| #183 (items 1–2) | Give Inventory Item: swap hero/self button + auto-fill from condition | ✅ done |
| #111 | Choices: show preceding dialog context (accordion / split-screen) | ✅ done |

## P4 — Larger features

| Issue | Title | Status |
|---|---|---|
| #141 | Disable "Add NPC"; auto-create EXIT dialog when NPC file appears | ✅ done |
| #147 | Teacher dialog template (Lehrer anlegen) | ✅ done |
| #114 | "Create Topic" writes to external log/quest files | ✅ done |

---

## #117 — resolution notes

- **Root cause:** in project mode the dialog tree + editor read from
  `projectStore.mergedSemanticModel`. Adding a Choice creates a brand-new target
  function (the sub-dialog) but no new dialog, and the merged model was not
  re-built after the edit, so the new function was invisible until a manual NPC
  re-click forced a re-merge.
- **Fix (already in `master`):** `projectStore.updateFileModel` re-merges the
  selected NPC's model after every edit that touches one of its files or a
  global file (`158ee70`, refined for perf in `35f0e9d`). The new target function
  reaches the merged model via `storeSync` → `updateFileModel` →
  `loadAndMergeNpcModels`, so the choice is accessible immediately.
- **Regression test:** `tests/e2e/choice-editing.spec.ts` →
  `Choice accessibility after creation in project mode (issue #117)` (2 tests).
  Verified to fail when the re-merge path is disabled and pass with it enabled.

## #182 — resolution notes

- **Request:** two bugs when working inside a dropdown-expanded sub-dialog (the
  choice accordion): (1) "Add Dialog Line" inserted into the top-level hierarchy
  instead of the current nesting level, and (2) the trash icon for a line shown
  inside the dropdown did nothing (user had to fall back to the sidebar tree).
- **Already implemented:** the `InlineChoiceEditor` accordion (`6ef4e25`,
  2026-03-16, post-dating the issue) renders the choice's sub-dialog with its
  own `useActionManagement` instance whose `setFunction` targets the choice's
  function (`updateFunctionWithUpdater(filePath, targetFunctionName, …)`). Every
  add/delete inside the expanded choice — the per-line "+" menu and the
  `DialogLineRenderer` trash icon — therefore operates on the choice's function
  at the correct nesting level, not the parent dialog.
- **Gap closed:** no test exercised the real add/delete wiring inside the
  dropdown — `tests/InlineChoiceEditor.test.tsx` mocks `ActionsList`. An E2E was
  not viable: the browser mock parser (`mockAPI.ts`) only understands
  `AI_Output`, so a choice cannot be seeded from source, and creating one via
  the UI then navigating in/out to populate the dropdown is fragile. Per the
  TDD rule's component-level exception, the regression test renders the **real**
  `ActionsList` / `ActionCard` / renderers instead.
- **Regression test:** `tests/InlineChoiceEditor.nesting.test.tsx` (2 tests) —
  clicking the inline "+" → "Dialog Line" and the line's trash icon must update
  the choice sub-function (`DIA_Test_Yes`), appending / removing a line.
  Verified discriminating: temporarily routing `setFunction` to a wrong function
  name makes both fail.
- **Collateral fix:** `tests/e2e/choice-editing.spec.ts` used
  `getByRole('menuitem', { name: 'Choice' })`, which became ambiguous once #123
  added the "Clear Choices" action (Playwright matches accessible names by
  substring). Added `exact: true` to the seven occurrences; the 6-test spec
  passes again.

## #119 / #123 — resolution notes (new actions)

- **Request:** add two new dialog actions — `Npc_SetRefuseTalk(self, <seconds>)`
  with an editable seconds field (default 300, #119) and
  `Info_ClearChoices(DIA_...)` with the dialog instance auto-filled from the
  current dialog context (#123).
- **Parser (`daedalus-parser`):** new model classes `SetRefuseTalkAction`
  (`npcActions.ts`, emits `Npc_SetRefuseTalk (target, seconds);`) and
  `ClearChoicesAction` (`dialogActions.ts`, emits `Info_ClearChoices (dialog);`).
  Wired into the `DialogAction` union, `ACTION_DISCRIMINATOR`, the legacy
  `ensureActionType` fallback, and `action-parsers.ts` dispatch
  (`npc_setrefusetalk`, `info_clearchoices`).
- **Editor (`daedalus-dialog-editor`):** added interfaces to `shared/types.ts`
  (+ re-export via `types/global.d.ts`), `actionTypes.ts` (union, `ActionTypeId`,
  `TYPE_TO_ID`), `actionTemplates.ts`, `actionFactory.ts` (clearChoices seeds the
  dialog instance from `dialogName`), the `ActionTypeMenu`, the renderer registry
  + labels, and two new renderers (`SetRefuseTalkActionRenderer`,
  `ClearChoicesActionRenderer`).
- **Tests:**
  - Parser: `test/actions-refusetalk-clearchoices.test.js` — parse + codegen
    round-trip for both (5 tests).
  - Editor Jest: `tests/refuseTalkAndClearChoices.test.tsx` — factory shape,
    type detection, renderer registration, and end-to-end codegen via
    `CodeGeneratorService` (5 tests).
  - Editor E2E: `tests/e2e/action-content-types.spec.ts` — added both to the
    insertion matrix plus behavior tests (Seconds defaults to 300 and edits;
    Clear Choices auto-fills `DIA_<dialog>`).

## #140 — resolution notes

- **Request:** invoking "Create Topic" should automatically append a "Log Set
  Status" action directly below it, preset to `LOG_RUNNING`.
- **Already implemented:** `useActionManagement.addActionAfter` auto-inserts a
  `LogSetTopicStatus` (status `LOG_RUNNING`, topic copied from the new
  `CreateTopic`) followed by a `LogEntry` whenever a `createTopic` action is
  added (`useActionManagement.ts:313-329`). `updateAction` keeps the sibling
  `LogSetTopicStatus`/`LogEntry` topics in sync when the `CreateTopic` topic is
  edited (`useActionManagement.ts:163-188`). This shipped alongside the #111
  comment item "auto-insert Log Entry after Create Topic".
- **Regression test:** `tests/createTopicAutoAppend.test.ts` (3 tests, passing).
  Covers the auto-append order, topic matching, and topic-sync on edit.

## #181 — resolution notes

- **Request:** when a Choice is inserted, the first dialog line under that choice
  should be pre-populated with the same text as the "Choice Text" field — in
  Gothic the choice text is only the menu label, the spoken line has to be
  repeated in the sub-dialog. Side benefit: the choice's dropdown is no longer
  empty right after creation.
- **Two creation paths seeded:** choices are created in two places, both now seed
  the target function with one Hero (`other`) `DialogLine` instead of leaving it
  empty:
  - `useDialogEditorCommands.addActionToEnd` (the toolbar "Add action" button),
  - `useActionManagement.addActionAfter` (the inline "+" between actions).
  The seeded line's id is generated against **every** dialog line in the dialog
  (`collectAllDialogLineActionsFromModel` + the live function actions /
  `getAllDialogLineActions`), so it does not collide with the parent line's id —
  a naïve empty-list id reused `DIA_…_15_00` and would have emitted duplicate
  `AI_Output` sound names.
- **Mirror on edit:** `useActionManagement.updateAction` detects a `Choice` text
  change and mirrors the new text into the first line of the choice's
  `targetFunction` (via `onUpdateSemanticModel`), but only while that line still
  matches the *previous* choice text — once the user edits the spoken line
  themselves it is left alone. Same guard pattern as the #140 CreateTopic →
  LogSetTopicStatus topic sync.
- **Tests:**
  - Jest: `tests/choiceAutoSeedLine.test.ts` (3 tests) — seeding shape + unique
    id, mirror-while-matching, and no-clobber-after-manual-edit. Verified
    discriminating (2 of 3 fail before the implementation; the no-clobber test
    guards the match check).
  - E2E: `tests/e2e/choice-editing.spec.ts` — the two #117 navigation tests now
    assert the seeded line is present (not "No actions yet"), plus a new test
    `Choice Text is mirrored into the seeded sub-dialog line (issue #181)` that
    types a Choice Text, navigates into the sub-dialog and asserts the line
    carries the same text. Confirmed against the real project-mode merged-model
    path (a temporary store dump showed the seed reaching `mergedSemanticModel`).

## #183 (item 3) — resolution notes (Tab order in Give Inventory Item)

- **Request:** in the "Give Inventory Item" action, Tab from Giver should move to
  Receiver, then to Item, in the *same* row. Instead it jumped to the next
  action card (or nowhere if none followed).
- **Root cause:** `ActionCard.handleKeyDown` (`ActionCard.tsx:158`)
  `preventDefault`s **Tab** and focuses the next/previous *action card* — correct
  for a single-field dialog line, wrong for a multi-field action where Tab should
  first walk the fields in the row. Every field in `GiveInventoryItemsRenderer`
  was wired straight to `handleKeyDown`, so the very first Tab hijacked focus.
- **Fix:** new pure helper `actionRenderers/rowTabNavigation.ts` →
  `createRowTabHandlers(cardKeyDown, fieldCount)` returns one keydown handler per
  field. Tab/Shift+Tab in the middle of the row are left to native browser focus
  order; only Tab on the **last** field and Shift+Tab on the **first** field fall
  back to `handleKeyDown` for card-to-card navigation. All non-Tab keys still
  delegate, so Enter/Escape/Ctrl+Enter are unchanged. Wired into the four
  `GiveInventoryItemsRenderer` fields (Giver/Receiver/Item/Quantity).
- **Supporting fix:** the "Follow reference" `IconButton` in `VariableAutocomplete`
  was focusable and would interpose between fields when a value resolved to a
  known symbol; marked `tabIndex={-1}` (mouse-only affordance). MUI's own
  clear/popup indicators already carry `tabIndex={-1}`, so the row now tabs
  cleanly field-to-field.
- **Scope:** only Give Inventory Item is wired up (the issue's item 3). The same
  helper can be adopted by the other multi-field renderers (Attack, Exchange,
  Remove Inventory, …) if the same complaint surfaces.
- **Tests:**
  - Jest: `tests/rowTabNavigation.test.ts` (5 tests) — boundary logic: middle
    Tab/Shift+Tab do **not** delegate (native focus proceeds), first/last edges
    do, non-Tab keys always do.
  - E2E: `tests/e2e/action-content-types.spec.ts` →
    `Give Inventory Items: Tab moves Giver -> Receiver -> Item`. Verified
    discriminating — reverting the renderer wiring to `handleKeyDown` makes the
    Receiver-focus assertion fail (focus leaves the row).
- **GitHub:** all three items are now done (see the #183 items 1–2 notes below);
  the issue was closed once items 1–2 shipped.

## #183 (items 1–2) — resolution notes (swap button + auto-fill from condition)

- **Request:** two more "Give Inventory Item" QOL items: (1) a small button to
  swap Giver ↔ Receiver, and (2) when the same dialog instance gates on an
  "NPC has item" condition, pre-populate the Item field with that item.
- **Item 1 — swap button:** `GiveInventoryItemsRenderer` now renders a
  `SwapHoriz` `IconButton` between the Giver and Receiver fields. Clicking it
  calls `handleUpdate({ ...action, giver: receiver, receiver: giver })`; since
  the renderer's `value` flows back through `VariableAutocomplete`, both fields
  update in place. The button is `tabIndex={-1}` (mouse-only) so it stays out of
  the in-row Tab order added for item 3 — the Giver → Receiver → Item Tab E2E
  still passes.
- **Item 2 — auto-fill Item from condition:** seeding happens in the action
  factory. `actionFactory.createAction` gained a `giveInventoryItems` branch that
  calls a new `findHasItemConditionItem(semanticModel, dialogName)` helper:
  resolve the dialog instance (`semanticModel.dialogs[dialogName]`, tolerating a
  stray `_Info` suffix), read its condition function name from
  `properties.condition`, and return the `item` of the first
  `NpcHasItemsCondition` on that function. When found, the Item is seeded and the
  giver/receiver template defaults are kept; otherwise the plain default template
  (`ItMi_Gold`) is used. `semanticModel` is now threaded through both creation
  paths — `createActionAfterIndex` (inline "+", via `useActionManagement`) gained
  an optional `semanticModel` arg, and `useDialogEditorCommands.addActionToEnd`
  passes it in its context.
- **Tests:**
  - Jest `tests/giveInventoryItems.test.tsx` (5 tests): swap button swaps
    giver/receiver and is `tabIndex=-1`; factory seeds the Item from an
    `NpcHasItemsCondition`, and falls back to `ItMi_Gold` when there is no such
    condition / no dialog context. Verified discriminating (3 fail before the
    implementation; the two fallback cases pass on the pre-existing template).
  - E2E `tests/e2e/action-content-types.spec.ts` →
    `Give Inventory Items: swap button flips Giver and Receiver` (clicks the real
    button and asserts the inputs swap). The existing item-3 Tab test and the new
    swap test use `getByLabel('Giver'/'Receiver', { exact: true })` so the swap
    button's accessible name (which contains "giver"/"receiver") is excluded.
  - Item 2 has no E2E: the browser mock parser only understands `AI_Output`, so
    an `Npc_HasItems` condition cannot be seeded from source — the factory Jest
    test is the discriminating check (same constraint noted for #182).

## #118 — resolution notes (Tab into choice sub-editor)

- **Request:** after inserting a Choice, pressing Tab should dive straight into
  the choice's sub-dialog for editing instead of forcing a mouse trip through
  the sidebar / navigate button.
- **Behaviour added:** forward **Tab** while the "Choice Text" field is focused
  now (a) expands the inline `InlineChoiceEditor` accordion and (b) moves focus
  to the first line of the sub-dialog — which is the Hero line auto-seeded by
  #181, so there is always something to land on. Since the new Choice already
  auto-focuses its Choice Text field on creation
  (`useActionManagement` → `focusAction`), one Tab takes the user from "just
  created a choice" to "typing the first sub-dialog line".
- **Implementation:**
  - `ChoiceRenderer.tsx` — the Choice Text field used to delegate every key to
    the card-level `handleKeyDown` (which `preventDefault`s Tab and jumps to the
    next action card). It now uses `handleChoiceTextKeyDown`: forward Tab (no
    Shift) with an existing target function is consumed to `setExpanded(true)`
    and bump a `focusInnerNonce`; Shift+Tab, Enter/Escape, and Tab when the
    sub-function does not exist yet still fall back to `handleKeyDown`. Mouse
    toggling the chevron (`handleToggleExpand`) resets the nonce to 0 so a
    click-expand never steals focus.
  - `InlineChoiceEditor.tsx` — new optional prop `focusFirstActionNonce`
    (default 0). A `useEffect` keyed on the nonce calls `focusAction([0])` on
    its own `useFocusNavigation` instance whenever the nonce is positive and the
    sub-function has at least one action. `focusAction` queues the request, so
    it still lands once the first inner `ActionCard` registers its ref. A nonce
    of 0 (mouse expand) leaves focus untouched.
- **Tests:**
  - Jest `tests/ChoiceRenderer.expand.test.tsx` — Tab on Choice Text expands the
    (mocked) editor and is *not* delegated to the card handler; the focus nonce
    goes positive; mouse-expand keeps the nonce at 0; Shift+Tab and Tab-without-
    a-target-function still delegate to card navigation (5 new tests).
  - Jest `tests/InlineChoiceEditor.nesting.test.tsx` — with the **real**
    ActionsList/ActionCard renderers, a positive `focusFirstActionNonce` focuses
    the first sub-dialog line; a zero nonce leaves focus alone (2 new tests).
  - E2E `tests/e2e/choice-editing.spec.ts` →
    `Tab from Choice Text dives into the choice sub-dialog (issue #118)`. Creates
    a choice in project mode, focuses Choice Text, presses Tab, and asserts the
    chevron flips to "Collapse choice actions" and the seeded sub-dialog line
    (`getByLabel('Text', { exact: true }).nth(1)`) holds focus. Verified
    discriminating — reverting the Choice Text `onKeyDown` back to `handleKeyDown`
    makes the expand assertion fail (the sub-editor never opens).

## #111 — resolution notes (accordion-style choice context)

- **Request:** choices were shown in isolation (a bare link into the sub-dialog
  function). The reporter asked that the preceding dialog stay visible while a
  choice is viewed — preferred approach an accordion that expands the choice's
  sub-dialog in place; split-screen named as the fallback alternative. The
  comment thread bundled several Create Topic / Log Entry QOL items plus
  drag-and-drop line reordering.
- **Already implemented (verified, not newly built):** the accordion is the
  `InlineChoiceEditor` rendered by `ChoiceRenderer` behind the expand chevron
  (`6ef4e25`, 2026-03-16 — post-dating the issue, shipped alongside #182).
  Expanding a choice keeps every preceding action card rendered above it and
  shows the choice's target function indented below, so the preceding dialog and
  the sub-dialog are on screen at the same time. Nesting is recursive (a choice
  inside a sub-dialog expands the same way), which covers arbitrary depth without
  a split-screen. The bundled comment items were also already done elsewhere:
  - drag-and-drop reordering of dialog lines — `react-beautiful-dnd` in
    `ActionsList`/`ActionCard` (`dragHandleProps`, `DragIndicatorIcon`);
  - `TOPIC_` auto-prefix + spaces→underscores — `CreateTopicRenderer`
    `normalizeTopicName`;
  - auto-insert Log Entry + Log Set Status after Create Topic — see the #140
    notes (`useActionManagement.addActionAfter`).
- **Gap closed:** no test locked in the *context-preserving* property of the
  accordion — that expanding a choice inline keeps the preceding dialog visible
  without navigating away.
- **Regression test:** `tests/e2e/choice-editing.spec.ts` →
  `expanding a choice inline keeps the preceding dialog visible (issue #111)`
  (project mode). Adds a Choice, expands it via the chevron (not the navigate
  button), and asserts the sub-dialog divider (`DIA_ChoiceProj_Test_Choice_1`)
  appears inline, the parent dialog heading is unchanged (no navigation), the
  preceding line keeps its value, and exactly two `Text` fields coexist (parent
  line + seeded sub-dialog line). Verified discriminating — forcing the
  `ChoiceRenderer` `Collapse` closed (`in={false}`) makes it fail (the inline
  sub-dialog never renders).

## #141 — resolution notes (Add NPC removed, EXIT dialog auto-created)

- **Request:** two parts: (1) disable the "+ Add NPC" button — it created NPC
  instances with incorrect parameters (`createNpcInstanceTemplate` emitted a
  bare `C_NPC` instance with only a `name`), and (2) when a new NPC `.d` file
  is manually dropped into the project's NPC folder, auto-create a
  `DIA_<NPC>.d` file with the standard EXIT dialog boilerplate every NPC needs.
- **Part 1 — button removed:** `NPCList` no longer renders the Add NPC
  `IconButton` / "Create NPC" dialog; the `onAddNpc` plumbing was removed from
  `dialogTypes.NPCListProps`, `NpcColumn`, and `ThreeColumnLayout`
  (`handleAddNpc`). `useDialogFactory.createDialogForNpc` stays — it still
  backs the "Add Dialog" flow for existing NPCs.
- **Part 2 — EXIT dialog auto-creation:**
  - NPC classification needs prototype chains (`VLK_…(Npc_Default)`, not
    `C_NPC` directly), which only the project scan can resolve:
    `ProjectService.buildProjectIndex` now also returns `npcPrototypes` (the
    normalized-uppercase prototype names whose parent chain reaches `C_NPC`),
    stored on `projectStore`.
  - New `src/renderer/utils/npcExitDialog.ts` (pure, no I/O):
    `deriveExitDialogName` (`VLK_99099_Robert` → `DIA_Robert_EXIT`, full-name
    fallback on collision or non-standard names), `createExitDialogTemplate`
    (the exact boilerplate from the issue: `nr = 999`, `description = "ENDE"`,
    `permanent = TRUE`, `AI_StopProcessInfos (self)`), and
    `planExitDialogsForAddedFile` (qualifies instances by parent ∈
    {C_NPC} ∪ npcPrototypes, skips NPCs that already have dialogs, targets the
    directory where most indexed dialog files live, else the NPC file's own
    directory).
  - `useFileWatcher.handleFileAdded` runs the plan after indexing a new file:
    skips plans whose target file already exists on disk, writes the template,
    and feeds the generated file back through `handleFileAdded` (editor
    self-writes are suppressed by the watcher), which parses + indexes it — so
    the NPC appears in the NPC list with its EXIT dialog immediately.
- **Tests:**
  - Jest `tests/npcExitDialog.test.ts` (10) — naming, template content,
    template validity against the **real** parser, and planning rules.
    The parser check runs in a child process: the native tree-sitter binding
    cannot be loaded into two Jest module registries in the same worker
    process (whichever of `ProjectService.test.ts` / this suite ran second in
    a shared worker failed with `tree.rootNode` undefined).
  - Jest `tests/useFileWatcher.test.ts` (+3) — add-event writes the EXIT file
    into the dialog directory and indexes it; existing file is never
    overwritten; NPCs with dialogs are skipped. Verified discriminating —
    disabling the `autoCreateExitDialogFiles` call fails the positive test.
  - Jest `tests/ProjectService.test.ts` (+1) — `npcPrototypes` contains
    transitive C_NPC prototypes and excludes item prototypes.
  - Jest `tests/NPCList.test.tsx` — Add NPC button is gone.
  - E2E `tests/e2e/dialog-creation.spec.ts` repurposed — project mode renders
    the NPC pane without an Add NPC button. A watcher-flow E2E is not viable
    in the browser harness: `mockAPI.onFileChanged` is a no-op (same
    constraint noted for #182/#183), so the Jest watcher tests carry the
    wiring coverage.

## #147 — resolution notes (teacher dialog template)

- **Request:** scaffold a complete Gothic teacher ("Lehrer") dialog from a few
  inputs — the skill being taught, its max level, and gold costs — following
  the canonical `DIA_Alrik_Teach` example in the issue.
- **Scope:** the four fight talents the example fully specifies (1H, 2H, Bow,
  Crossbow via `B_TeachFightTalentPercent` / `other.HitChance[…]`). Costs use
  `B_GetLearnCostTalent` exactly as in the example (engine-standard costs)
  rather than a manual gold field. Other skill categories (attributes,
  hunting, alchemy, …) use different teach builtins and can be added to the
  same `TEACHER_SKILLS` table later.
- **UI:** a new School-icon button "Create Teacher Dialog" in the Dialogs pane
  header (project mode only, next to Add Dialog). The form asks for Skill
  (select), Max Level (default 30), and Description (auto-filled per skill,
  e.g. "Trainier mich im Schwertkampf!", editable). The description doubles as
  the hero's opening line comment.
- **Generation** (`src/renderer/utils/teacherDialogTemplate.ts`, pure string
  template following the issue example):
  - `var int <Short>_Merke_<SKILL>;` + permanent `C_INFO` instance
    `DIA_<Short>_Teach` (skill id appended when the name is taken — an NPC can
    teach several skills).
  - Info function: hero line, remember `other.HitChance[<talent>]`,
    `Info_ClearChoices` + `Info_AddChoice` for DIALOG_BACK and the +1/+5 learn
    entries via `B_BuildLearnString(PRINT_Learn…, B_GetLearnCostTalent(…))`.
  - Back function: "kein Anfaenger mehr" at `>= maxLevel`, "schon besser
    geworden" when above the remembered value; per-step teach functions pass
    maxLevel as the `B_TeachFightTalentPercent` cap. The condition returns
    TRUE (the example's `<NPC>_Teach1H` gate references a mod-specific
    variable that would not compile in isolation).
- **Wiring** (`src/renderer/utils/teacherDialogFactory.ts`, deps injected):
  writes `DIA_<Short>_Teach.d` next to the NPC's existing dialog files (else
  the project's dominant dialog directory), refuses to overwrite, then
  registers the file + dialog in `projectStore` and navigates to it —
  same tail as `useDialogFactory`. `ThreeColumnLayout.handleCreateTeacherDialog`
  supplies the real deps; the button is only wired in project mode.
- **Tests:**
  - Jest `tests/teacherDialogTemplate.test.ts` (7) — skill table, instance/
    choices/back/teach-step content, per-skill constants, and full-template
    validity against the **real** parser (child process, same native-binding
    constraint as #141) including extraction of all five functions.
  - Jest `tests/teacherDialogFactory.test.ts` (4) — file placement next to
    NPC dialogs, name collision → `_1H` suffix, dominant-directory fallback,
    refuse-to-overwrite.
  - E2E `tests/e2e/teacher-dialog.spec.ts` — full UI flow in project mode:
    open form, default description for 1H, set Max Level 60, create; asserts
    the dialog appears in the tree and the generated file carries the
    boilerplate with the configured cap.

## #114 — resolution notes (Create Topic → external log files)

- **Request:** when "Create Topic" is used, also register the quest in the
  project-level log files: `const string TOPIC_X = "…"; var int MIS_X;` in
  `LOG_Constants_<project>.d` and `B_CloseTopic (TOPIC_X, MIS_X, <start>,
  <end>);` in `B_CloseTopics<project>.d`, with editable chapter numbers
  (defaults 0 and 2). The triage note flagged a dependency on knowing which
  project files to target.
- **UX:** the Create Topic action card gained a book-icon button "Register
  quest in log files" (project mode, enabled once the topic is named,
  `tabIndex=-1` so the in-row Tab order is untouched). It opens a form with
  Quest Title (defaulted from the topic name, underscores → spaces), Chapter
  Start (0) / Chapter End (2), and the two target files. Registering is an
  explicit action rather than a side effect of inserting the action, because
  the topic name is usually typed *after* insertion.
- **No settings mechanism needed:** target files are suggested from live
  project data — the constants file by ranking files by their number of
  `TOPIC_` constants (same heuristic as `CreateQuestDialog`), the close-topics
  file by scanning parsed files for a `B_CloseTopics…` function or
  `B_CloseTopic` calls. Both fields are free-text (`Autocomplete freeSolo`)
  with the top suggestion pre-selected, so unusual layouts still work.
- **Implementation:**
  - `src/renderer/utils/questLogFiles.ts` (pure): declaration/close-call
    builders, the file suggestions, and `insertIntoCloseTopicsFunction` —
    a brace-matching insert that places the call at the end of the
    `B_CloseTopics…` function body (nested blocks handled), throwing when the
    file has no such function.
  - `projectStore.registerTopicInLogFiles` reuses the `mutateQuestFile` →
    `mergeUpdatedQuestFileModels` pipeline from `createQuest` (read → mutate →
    write with self-write suppression → re-parse → fold into the merged
    model), with an up-front duplicate-declaration guard so no file is touched
    when `TOPIC_X` already exists.
  - `RegisterTopicDialog.tsx` renders the form; `CreateTopicRenderer` hosts
    the button.
- **Tests:**
  - Jest `tests/questLogFiles.test.ts` (5) — brace-aware insert (with a
    nested `if` block and a trailing unrelated function), missing-function
    error, declaration builders, both suggestion heuristics.
  - Jest `tests/registerTopicInLogFiles.test.ts` (2) — the store action
    writes both files (existing content preserved, close call inside the
    function) and folds the re-parsed models into `mergedSemanticModel`;
    duplicate topic rejects before any write.
  - E2E `tests/e2e/register-topic.spec.ts` — full UI flow in project mode:
    insert Create Topic, name the topic, open the form, adjust the title,
    point at the seeded LOG/B_CloseTopics files, register; asserts both
    files' new content and that the close call landed inside the function
    body. (File pickers are typed manually in the test — the browser mock
    parser extracts no constants, so the suggestion lists are empty there.)

## #126 — resolution notes

- **Request:** almost every dialog opens with a line from the Hero, so a newly
  created dialog should seed its first `DialogLine` with the Hero (`other`) as
  speaker rather than the NPC (`self`).
- **Fix (already in `master`):** `useDialogFactory.createDialogForNpc` seeds the
  new info function's first line with `speaker: 'other'` (`f92edf9`, 2026-04-07).
  The action factory already defaulted standalone new dialog lines to `other`
  (`actionFactory.createAction` → `getOppositeSpeaker`/`'other'` fallback).
- **Gap closed:** the `f92edf9` commit shipped the one-line factory change with
  no dedicated test (its tests covered an unrelated `conditionOperator` change).
- **Regression test:** `tests/ThreeColumnLayout.test.tsx` →
  `first line of a new dialog defaults to Hero (other) speaker (issue #126)`.
  Guards the seeded `informationFunction` block in `useDialogFactory.ts`;
  verified to fail when the speaker is reverted to `self` and pass with `other`.
