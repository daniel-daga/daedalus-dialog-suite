# Editor review — 2026-11-01, slice 6: quest, routine and NPC authoring

Slice: `src/renderer/quest/domain/` (`analysis`, `graph`, `questDiary`,
`questSteps`, `questConditions`, `conditionExpressionCodec`, the graph
pipeline), `components/QuestEditor.tsx`, `QuestList.tsx`, `QuestDetails.tsx`,
`questDiarySave.ts`, `src/renderer/routines/` (`routineEntries`,
`routineSchedule`, `routineDraft`, `waynetRoute`), `components/RoutineEditor.tsx`,
`routineSave.ts`, `src/renderer/npc/` (`npcForm`, `npcTemplate`, `npcAssets`,
`npcRoutines`, `npcVisual`, `npcItemCategories`, `spawnNpcVisuals`), and
`components/NpcEditorDialog.tsx`, `NpcColumn.tsx`, `NPCList.tsx`,
`CreateNpcDialog.tsx`, `NpcVisualPreview.tsx`, `NpcRoutineSourceDialog.tsx`,
`npcWorldJump.ts`. Judged against one invariant: a patch-in-place save keeps the
file valid and the declaration the same shape the reader saw.

Commit reviewed: `0390307`. Date: 2026-11-01.

**Load assumed.** The project index and a world loaded, one NPC editor open over
an NPC whose file other surfaces also reach; a routine function shared by many
NPCs, opened both in the World surface's routine mode (which stays mounted while
the Dialog view is used, `MainLayout.tsx:204-210`) and in the NPC editor's
modal; a quest diary entry that is also `MIS_`-backed, read in project mode where
the page is handed `getQuestUsage(selectedQuest)` rather than a file model; a
second editor or a `git checkout` touching the same file while a form holds a
read of it; and a user who cannot tell that a save rewrote a line they did not
touch. Judged against that: the writers themselves hold — tokens are rewritten
in place, an unfillable layout is refused, an unedited file saves byte-identical,
and the diary's entry edit has a staleness guard — and the defects are all the
same shape: **a read of the file is carried across an `await` and applied by
position without checking it still describes the file.**

**What this slice does.** The quest page is a list of `TOPIC_` constants and a
details panel that folds a quest's `B_LogEntry` and state lines into a story
diary, read through `getQuestUsage` in project mode; its entry edit and its
implicit-quest upgrade open the writing file's model, replace one
function's actions and run the ordinary `saveFile`. A routine is read out of a
function's verbatim `Action` statements into entries addressed by action index,
edited in a draft with its own undo, and written back by rewriting only the
tokens that changed inside those actions. The NPC editor extracts one instance's
body through `npc-definition`, shows a form over it, and on save asks the
parser's writer to patch the statement each changed control reads, addressing
repeated calls by occurrence.

Checks run: the focused suites `routineEntries`, `routineDraft`, `questDiary`,
`questSteps`, `questAnalysis`, `npcForm` (95 tests, all pass), plus three
throwaway probes in a scratch directory — findings 1, 2 and 3 below are each
reproduced by one, not inferred. No repository file was edited except this
report.

## What already holds, and the test that would fail if it broke

| Rule | Test |
|---|---|
| a routine save rewrites only the tokens an edit changed, keeping tabs, `08` against `8` and comments | `tests/routineEntries.test.ts:68`, `:73`, `:105` |
| a call whose time or waypoint is not a literal is left out of the entries and survives the save | `tests/routineEntries.test.ts:55` |
| an hour-only layout refuses a minute, and a layout an entry cannot fill is refused by name | `tests/routineEntries.test.ts:145`, `:153` |
| a new routine goes last in the declaration order and a name the file already has is refused | `tests/routineEntries.test.ts:173`, `:184` |
| the routine draft never opens a gap or overlap by accident, and never makes a window empty | `tests/routineDraft.test.ts` |
| an unedited NPC body round-trips byte-identical; an edit changes one line | `daedalus-parser/test/npc-definition.test.js` (parser side, reviewed separately) |
| the form turns "nothing changed" into no edits, writes strings back quoted, and keeps a constant that stood there as a constant | `tests/npcForm.test.ts:50`, `:74` |
| a partly filled visual is refused rather than written | `tests/npcForm.test.ts:117` |
| the melee/ranged controls address their `EquipItem` by occurrence and leave a second weapon alone | `tests/npcForm.test.ts:154`, `:173` |
| the NPC editor's edits reach disk and reparse through the real parser | `tests/e2e-electron/npc-editor-disk-truth.spec.ts` |
| the diary reads lines inside an if/else with a path into the branch | `tests/questDiary.test.ts:204` |
| the implicit-quest upgrade sets `MIS_` after each topic-status line and leaves a list that already sets it alone | `tests/questDiary.test.ts:242`, `:252`, `:258` |
| an unedited quest file saves unchanged — a step is a view over actions, not a new type | `tests/questSteps.test.ts` |
| the quest domain imports no React/MUI/Electron | `tests/questDomainBoundary.test.ts` |

The one guard that exists in a save path — the diary's "the line at this path is
no longer the entry the page read" (`questDiarySave.ts:36-38`) — has no test, and
is what findings 2 and 3 propose copying.

## Must fix

1. **The quest page and the quest analysis never look inside an `if`, so a
   conditional ending is invisible and the upgrade does not write its `MIS_`**
   (`src/renderer/utils/questAnalyzer.ts:86-101`, `src/renderer/quest/domain/analysis.ts:106-124`,
   `:266-296`, `:371-403`, `:428-434`; the walk that does recurse is
   `src/renderer/quest/domain/questDiary.ts:63-88`)
   - **What this is:** Five scans read `func.actions` one level deep: which
     functions belong to a quest (`getQuestUsage`), the lifecycle signals
     (`analyzeQuest`, `analyzeQuests`), the reference list and the "Used"
     filter. `buildQuestDiary` and `questSteps` both recurse into
     `ConditionalAction`'s branches; these do not. In project mode the details
     panel is handed `getQuestUsage(selectedQuest)` (`QuestEditor.tsx:35-44`),
     so a function dropped there is dropped from the diary entirely.
   - **Problem:** Reproduced on real parser output: a quest that starts at top
     level and completes inside `if (Npc_HasItems (other, ItMi_Nugget) >= 5)`
     gives `["running", "success"]` over the file model but only `["running"]`
     through `getQuestUsage`; `analyzeQuest` on the *same file* returns
     `status: 'wip', hasSuccess: false`. So the list says "In Progress", the
     details page says "No ending yet", and the diary omits the completion —
     for a quest that is finished. A function whose only quest lines are
     conditional (the shape `tests/questDiary.test.ts`'s own `IMPLICIT` fixture
     uses) is dropped whole, and then the page says "Nothing writes to this
     quest's diary yet". The upgrade inherits it: `upgradeImplicitQuest` walks
     the diary for state lines (`questDiarySave.ts:54-67`), so the `MIS_`
     assignment is written only where a *top-level* state line exists. The quest
     is declared `MIS_`-backed and never set on the branch that finishes it.
   - **What the user loses:** the ending of their quest, on the page whose job
     is to show it; the edit and jump affordances for those lines; and, on
     upgrade, a `MIS_` that no code path assigns — the quest reads "not started"
     in the simulator and in any mod that checks it.
   - **Test that does not exist:** the `IMPLICIT` fixture pushed through
     `getQuestUsage` and then `buildQuestDiary`; the diary must still list both
     branch states. `tests/questAnalysis.test.ts` and
     `tests/projectStore.questUsage.test.ts` both cover only flat action lists.
   - **Minimal fix:** lift the recursion `collectLines`
     (`questDiary.ts:63-88`) already does into one exported walker beside it and
     use it in the five scans; each becomes "visit every action at any depth".
     No behaviour changes for flat lists, which is what every test pins.
   - **If we skip it:** the two panels keep disagreeing about the same file, and
     the upgrade keeps shipping quests whose state is never set.

2. **A routine save applies its draft by position, so any change to the function
   since the draft was read rewrites the wrong lines and deletes one**
   (`src/renderer/routines/routineEntries.ts:27-29`, `:197-211`, `:229-243`;
   `src/renderer/components/routineSave.ts:47-58`;
   `src/renderer/components/RoutineEditor.tsx:333-352`)
   - **What this is:** `RoutineEntry.source` is a bare `actionIndex` into the
     function's action list, captured when the panel loaded the draft. On save,
     `writeRoutine` patches the action now sitting at that index and treats every
     sourced index no entry names any more as a deleted entry (`:236-237`).
   - **Problem:** The draft lives in component state and is loaded once per
     routine (`RoutineEditor.tsx:333-352`), while the model is re-read at save
     time (`routineSave.ts:48`). If the function grew or shrank in between, the
     indices no longer mean what they did. Reproduced: a draft read from
     `[Sit, Sleep]`, then a `TA_Guard` inserted at the top of the list, then a
     save that changed only Sleep's waypoint, writes
     `["TA_Sit_Throne (07,00,22,00,\"WP_SIT\")", "TA_Sleep (22,00,07,00,\"WP_BED_2\")"]`
     — the guard line is overwritten by the first draft activity, and the real
     Sleep line is deleted as "removed". Nothing errors. The ways in are
     ordinary: routine mode is a panel in the World surface that stays mounted
     while the user switches to the Dialog view and edits the same file; the
     NPC editor's routine dialog is modal but the file stays open and *clean*
     (the draft is not the model), so the watcher reloads an external change in
     place without a conflict; and the editor's own refusal message tells the
     user to "write it in the script" for a layout it cannot fill — after which
     returning to the panel and pressing Save destroys that line.
   - **What the user loses:** activities they did not touch, and the one they
     added elsewhere, in the file that decides where an NPC stands all day.
   - **Test that does not exist:** read entries from a list, hand `writeRoutine`
     the same list with one action inserted, assert it throws (or at least
     changes nothing). The only component test mocks `routineSave`
     (`tests/RoutineEditor.waypoints.test.tsx:14`), so nothing in Jest runs this
     path at all; `tests/e2e/routine-editor.spec.ts` saves a happy path.
   - **Minimal fix:** carry the original text — `source: { actionIndex, text }` —
     and in `writeRoutine` throw when `actions[index].action !== source.text`
     ("the routine changed since it was opened; reopen it"). That is the guard
     `saveDiaryEntryText` already applies to the quest diary. Two small edits,
     no new state.
   - **If we skip it:** the routine editor is safe only while nobody else writes
     the function, which is not a property the app enforces anywhere.

3. **The NPC editor applies edits computed from the body it read when the form
   opened, so an occurrence-addressed edit can land on the wrong call**
   (`src/renderer/components/NpcEditorDialog.tsx:255-284`, `:364-380`;
   `src/renderer/npc/npcForm.ts:198-227`)
   - **What this is:** `definition` is extracted once, when the dialog opens.
     Save computes `editsBetween(definition, initial, values)` from that read and
     applies the result to `instance.sourceText!` as it is *now*.
   - **Problem:** Field edits are addressed by name and survive a changed body;
     the equipment and overlay edits are addressed by occurrence, and the
     visual edit rewrites the whole `B_SetNpcVisual` call from the values the old
     read produced. Reproduced with the real parser writer: an NPC with
     `[ItMw_1H_Sword, ItRw_Bow]`, the user changes the melee weapon, and a
     dagger has been inserted ahead of the sword in the meantime — the save
     produces `[ItMw_2H_Axe, ItMw_1H_Sword, ItRw_Bow]`. The dagger is gone, the
     sword is still equipped, and the NPC now carries two "melee" entries, one
     of which the form no longer shows. `saveFile` cannot catch it: the store
     model is whatever the reload left, and `externalConflict` is only raised for
     a *dirty* file, so this needs no conflict to be shown. The parser's writer
     also turns an out-of-range occurrence into an added call
     (`daedalus-parser/src/semantic/npc-definition.ts:227-233`), so "change this weapon" can quietly become
     "add another".
   - **What the user loses:** equipment they never selected, and the removal of
     equipment they never opened — visible only in game, since the form's
     covered statements are the ones the writer rewrote.
   - **Test that does not exist:** extract a definition, change a weapon, apply
     the edits to a body with one more `EquipItem` at the front, assert refusal
     (or that the sword ends up replaced, not duplicated). `tests/npcForm.test.ts`
     covers only the unchanged body it was read from.
   - **Minimal fix:** in `handleSave`, re-extract the instance and refuse when
     its `sourceText` differs from the one the form was read from, with the
     reason the diary uses; `extractNpc` is one IPC call that the dialog already
     makes. A refinement that keeps saves possible: recompute `initial` from the
     fresh definition so untouched controls produce no edit, and refuse only the
     occurrence-addressed ones that moved.
   - **If we skip it:** the NPC editor's promise is "edit an NPC that already
     exists without losing a line of it", and one reload while it is open breaks
     that promise silently.

## Should fix

4. **The implicit-quest upgrade declares `MIS_` before it can set it, and cannot
   finish or undo the declaration**
   (`src/renderer/components/questDiarySave.ts:47-68`;
   `src/renderer/store/projectStore.ts:1124-1150`)
   - **What this is:** the upgrade writes and saves `var int MIS_X;` first
     (`:52`), then saves the assignments per file (`:59-68`). Each step is its
     own disk write; there is no rollback and no "continue" affordance.
   - **Problem:** if any later `saveFunctions` refuses — an external conflict on
     a writing file, a validation refusal, a file that will not open — the
     caller shows the error but the declaration is already on disk. The page
     then hides the banner, because `misVariableExists` is now true, so the one
     control that could finish the job is gone: the quest is `MIS_`-backed from
     the analysis's point of view and nothing assigns it. `addVariable` also
     appends with no duplicate check (`projectStore.ts:1138-1141`), so the
     recovery a user would try by hand — clicking again if the banner is still
     there after a reload — writes a second `var int MIS_X;`.
   - **What the user loses:** a half-upgraded quest, whose diary reads as
     explicit and whose state never changes in game.
   - **Test that does not exist:** `upgradeImplicitQuest` with a
     `saveFunctions` that throws — assert either nothing was written or the
     variable exists exactly once. There is no test for either export of
     `questDiarySave.ts`.
   - **Minimal fix:** prepare the per-file action lists first and save them
     before declaring the variable (so a refusal writes nothing), or declare it
     last; and refuse in `addVariable` when the file already declares the name,
     as `appendTopicDeclaration` does for `TOPIC_`.
   - **If we skip it:** a failed upgrade leaves a state neither the user nor the
     editor knows how to finish.

5. **An NPC-editor save does not re-index the file it wrote, so the routines it
   changed stay stale for the session**
   (`src/renderer/components/NpcEditorDialog.tsx:364-397`; the readers:
   `:323-331`, `src/renderer/components/RoutineEditor.tsx:285-297`)
   - **What this is:** the save updates the file model and calls `saveFile`, then
     closes. `routineSave.ts:63` and `:120` follow the same save with
     `reindexFiles([filePath])`; this one does not, and the watcher suppresses
     the editor's own write, so nothing re-reads the file.
   - **Problem:** `daily_routine`, `id` and the routine functions can all be
     changed through this form (`npcForm.ts:51,57`). After such a save,
     `routineNpcIndex`, `routineSiteIndex` and `npcIdIndex` still hold the old
     facts: the NPC editor's own Routines section lists the routine the NPC no
     longer declares, the routine editor opens on it, and the World surface's
     routine lens keeps placing the NPC by the old day — until the project is
     reopened. This is the mirror of #429 (which is the dropdown *before* the
     choice going stale) and is not covered by it: #429's cause is the `options`
     memo keyed on `parseGeneration` (`NpcEditorDialog.tsx:286-290`), which
     neither `registerRoutine` nor `reindexFiles` bumps. Worth folding into the
     same fix if the maintainer prefers one issue.
   - **What the user loses:** the routine they just set, everywhere except the
     script.
   - **Test that does not exist:** save a `daily_routine` change and assert
     `routineNpcIndex` names the new routine. `tests/projectStore.reindexRoutines.test.ts`
     covers the routine editor's own save only.
   - **Minimal fix:** `await useProjectStore.getState().reindexFiles([filePath])`
     after the successful save, as `saveRoutine` does.
   - **If we skip it:** the editor's index and its files disagree for the rest of
     the session.

6. **`buildQuestGraph` derives the `MIS_` name with a case-sensitive replace**
   (`src/renderer/quest/domain/graph.ts:23`; the rule is
   `src/renderer/utils/questIdentity.ts:14-16`)
   - **What this is:** `questName.replace('TOPIC_', 'MIS_')` instead of
     `getQuestMisVariableName`, which is `/^topic_/i`. A quest declared
     `Topic_Schafe` — which the quest list's policy accepts
     (`questIdentity.ts:25-28`) and `tests/projectStore.questUsage.test.ts:67`
     explicitly supports — keeps its topic name as the "MIS variable".
   - **Problem:** `identifyQuestNodes`/`buildQuestEdges` then look for assignments
     to a variable nothing declares, so the MIS-requirement edges are never
     built. The diary is a topological order over those edges
     (`questDiary.ts:96-119`), so for a `Topic_` quest story order silently
     degrades to "starts first, then by name" — the order the doc says the graph
     exists to supersede.
   - **What the user loses:** the diary's story order on `Topic_`-named quests,
     i.e. which entry comes before which.
   - **Test that does not exist:** `buildQuestDiary` over the
     `Topic_`-spelled fixture in `tests/projectStore.questUsage.test.ts`, with
     two functions whose order only the MIS edge gets right.
   - **Minimal fix:** one import and one call.
   - **If we skip it:** a whole spelling of quest name gets a silently worse
     diary, and no test says so.

7. **A quest title edit fails with nothing on screen**
   (`src/renderer/components/QuestDetails.tsx:116-120`)
   - **What this is:** `handleSaveTitle` awaits `updateGlobalConstant`, which
     rethrows on any failure (`projectStore.ts:1152-1181`), in an `onClick`
     handler with no `catch` — unlike the entry edit and the upgrade beside it,
     which both go through the `write` wrapper (`:81-93`) that shows the error.
   - **Problem:** a refused write — an external change to the constants file, a
     version conflict, a title the generator would break — leaves the field open
     with no message and a console rejection. The user presses save again, or
     gives up believing it was saved.
   - **What the user loses:** the knowledge that the title did not save.
   - **Test that does not exist:** a title save whose `updateGlobalConstant`
     rejects renders an error. There is no test for `QuestDetails` writes.
   - **Minimal fix:** `await write(() => updateGlobalConstant(...))`, then close
     the field only when it returned true.
   - **If we skip it:** one of the three write paths on the quest page is the
     silent one.

8. **Two documents describe behaviour the code does not have**
   (`docs/architecture/quest-editor.md:104-106`;
   `docs/plans/editor-review-2026-11-01.md:25`)
   - **What this is:** the architecture doc says the implicit-quest upgrade
     "declares `var int MIS_X` beside the `TOPIC_` constant"; `addVariable`
     appends it at the end of the file (`projectStore.ts:1138-1141`). The slice
     plan lists `components/CreateQuestDialog.tsx`, which does not exist — the
     create flow is `RegisterTopicDialog` in create mode
     (`QuestList.tsx:284-286`).
   - **Problem:** a reader checking whether the declaration lands in the right
     place, or looking for a file by the documented name, is sent to something
     that is not there. Whether the *code* should put the declaration beside the
     constant is a separate question — the doc's claim is not wrong because
     appending is, it is wrong because it is not what happens.
   - **Fix:** one sentence in `quest-editor.md` saying the variable is appended
     to the declaring file, and one line in the slice plan naming
     `RegisterTopicDialog`.
   - **If we skip it:** the next review re-derives this from the code.

## Verdict

Verdict: fix 1, 2 and 3 first. 2 is the one that destroys script text: it turns
a draft into line-level damage as soon as anything else writes the function, and
the editor's own "write it in the script" message invites that. 3 is the same
fault on the NPC form, one reload away. 1 is a read that stops one level too
early and makes the quest page contradict itself and the upgrade incomplete —
the widest blast radius of the three, and the smallest diff to fix. 4, 5 and 6
are each a handful of lines and each closes a "the editor and its own index
disagree" gap; 7 and 8 are tidiness with a user-visible edge.

Lean: no deletions found in this slice. The graph pipeline still earns its place
(the diary's story order is its only consumer) and every domain module has a
live caller.

Not checked: no real project (the 890-file corpus and the MDK scripts are not on
this machine), so "how often a `Topic_` quest or a conditional-only quest step
occurs" is judged from the fixtures and the retail idioms, not counted; the
World surface's own handling of routine mode and NPC placement is slice 9; and
the parser half of `npc-definition` is
`docs/reference/parser-review-2026-11-01-npc-edits.md`, so finding 3's
occurrence semantics are quoted from that writer, not reviewed here.
