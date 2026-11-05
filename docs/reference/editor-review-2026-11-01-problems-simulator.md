# Editor review — 2026-11-01, slice 7: Problems and the simulator

Slice: `src/renderer/problems/domain/` (`types`, `walk`, `fileFacts`,
`projectView`, `runRules`, all twelve files in `rules/`),
`problems/application/scanProject.ts`, `src/renderer/store/problemsStore.ts`,
`components/Problems/` (`ProblemsPanel`, `ProblemsList`),
`src/renderer/simulator/domain/` (`model`, `identifier`, `values`, `engine`,
`conditionEvaluator`, `dialogAvailability`),
`simulator/application/SimulatorSession.ts`, and
`components/Simulator/SimulatorDialog.tsx`. Judged against one invariant: a
finding points at a real locus, and the simulator reads a condition the way the
parser does.

Commit reviewed: `b105f6c`. Date: 2026-11-01.

**Load assumed.** A project of 890 dialog files with the index already built and
every file ingested into `parsedFiles`, then a re-scan after each save (debounced
300 ms) while the Problems list — hundreds of rows, no filter, no virtualization
(`docs/architecture/problems-panel.md:147-152`) — is the view on screen; a world
open behind it, so the waypoint, spawn, routine and portal rules all have their
reference data; and a simulator session walking a real dialog tree whose
conditions mix `Npc_KnowsInfo`, `Npc_HasItems`, negations and `||`. Judged against
that: `problemsStore` holds under it (cached facts per model, one deferred scan
across ingestion, then a debounce), the world-absent rules stay silent rather
than calling every site dangling, and the simulator's three-valued evaluation is
honest on real parser output — I walked `daedalus-parser/examples/DIA_Arog_SLD_99005.d`
(a real Gothic 2 dialog file) end to end: nine C_INFOs, three crisply available,
one launched, five choices, a chosen target, all correct. The defects are all on
the Problems side, and two of them are the same shape: **a rule reads a narrower
slice of the model than the question it claims to answer.**

**What this slice does.** The Problems panel projects each parsed file's model
into per-file facts in one walk, folds those plus the project index's
whole-project maps (waypoint sites, spawn sites, routine sites, NPCs with
dialog) and the open world's reference data into one `ProjectView`, runs twelve
pure rules over it, and turns each finding into a row with a locus and an id.
The simulator projects the semantic model into canonical-keyed maps, evaluates
C_INFO condition functions and raw `if` bodies with three-valued logic, and
replays an information function's actions against disposable scratch state.

Checks run: the focused suites `problemsVoiceId`, `problemsKnowsInfoDangling`,
`problemsOrphanedFunction`, `problemsProjectView`, `problemsOutputUnitDrift`,
`problemsWaypointNotInWorld`, `problemsDuplicateSpawn`,
`simulatorConditionEvaluator`, `simulatorDialogAvailability`,
`simulatorParserIntegration`, `simulatorEngine`, `simulatorModel`,
`SimulatorSession` (104 tests, all pass), plus six throwaway probes in a scratch
directory — three drive the real tree-sitter parser through the real rule
modules, one walks the simulator over a real dialog file — and a micro-benchmark
of the two loops in finding 6. Findings 1, 2, 3 and 4 below are each reproduced
by one of them, not inferred. No repository file was edited except this report.

## What already holds, and the test that would fail if it broke

| Rule | Test |
|---|---|
| a re-scan reuses the per-file facts of every model whose identity did not change | `tests/problemsStore.scanScheduling.test.ts:128`, `:160` |
| a scan during ingestion is deferred to exactly one scan when ingestion ends, and debounced after that | `tests/problemsStore.scanScheduling.test.ts:60`, `:84`, `tests/ProblemsPanel.scanScheduling.test.tsx` |
| the world-dependent rules say nothing when no world is open | `tests/problemsWaypointNotInWorld.test.ts:32` |
| a free point matches the way the engine matches one, the empty name matches nothing, and an ordinary waypoint does not fragment-match | `tests/problemsWaypointNotInWorld.test.ts:104`, `:115`, `:124`, `:138`, `:154` |
| a rule fed by the index emits one row per site, not one per call | `tests/problemsWaypointNotInWorld.test.ts:81`, `tests/problemsDuplicateSpawn.test.ts:93` |
| `duplicate-spawn` fires for a character and stays silent for a monster template | `tests/problemsDuplicateSpawn.test.ts:38`, `:61`, `:72` |
| a row the merged model cannot resolve still opens the file it names | `tests/ProblemsPanel.navigation.test.tsx:58` |
| a script finding names the finest construct it is about, not the declaration | `tests/problemsSourceLine.test.ts` |
| the simulator reads real parser output: a raw-mode condition function is unknown, and a negated `Npc_KnowsInfo` is honoured both ways | `tests/simulatorParserIntegration.test.ts:97`, `:121` |
| three-valued AND/OR, codec-structured raw expressions, and unknown staying unknown | `tests/simulatorConditionEvaluator.test.ts:76`, `:139`, `:157` |
| an unknown gate is visible with its reason, never crisply available, and an empty condition list is only trusted when the body is empty too | `tests/simulatorDialogAvailability.test.ts:105`, `:125` |
| Back, Restart and a policy change restore a complete snapshot | `tests/SimulatorSession.test.ts` |
| the modal is pinned to the model it opened on, so a reparse does not wipe the session | `tests/simulatorDialog.test.tsx` |
| the real UI plays a choice menu, backs up, takes another branch and restarts | `tests/e2e/dialog-simulator.spec.ts:32` |

## Must fix

1. **`knowsinfo-dangling` only sees a `Npc_KnowsInfo` the parser extracted as a
   top-level condition, so the same check written inside an `if` — the shape the
   simulator tests and the repository's own fixture use — is never reported**
   (`src/renderer/problems/domain/fileFacts.ts:44-55`;
   `src/renderer/problems/domain/rules/knowsInfoDangling.ts:14-29`; the parser
   shapes it is up against: `daedalus-parser/src/semantic/visitors/linking-visitor.ts:352-405`)
   - **What this is:** `knowsInfoRefs` is built by reading `func.conditions`, and
     only `NpcKnowsInfoCondition` entries there. The parser produces that type in
     exactly one shape: a condition function whose whole body is one `if
     (clauses) { return TRUE; };`. Anything else — the same `if` followed by
     `return FALSE;`, a local `var`, an `if/else`, or an `if` inside an
     information function — becomes either one raw `Action` holding the source
     text or a `ConditionalAction` whose `condition` is a raw string. Two of
     those three carry the reference in plain text, where this rule does not look.
   - **Problem:** reproduced with the real parser on
     `daedalus-parser/test/fixtures/corpus/condition-idioms.d`, whose
     `DIA_Foo_Condition` is `if (Npc_KnowsInfo (other, DIA_Foo)) { return TRUE; };
     return FALSE;` and lands in raw mode — `conditions: []`, one `Action` whose
     text contains the call. `DIA_Foo` is not declared anywhere in that fixture,
     and the rule reports **nothing** (0 problems for the file). The same probe
     with `if (Npc_KnowsInfo (other, DIA_Missing))` inside a `func void Info_X`
     reports nothing either, while the two structured condition functions in
     `examples/DIA_Arog_SLD_99005.d` are reported correctly — so the rule works,
     on one shape of the idiom. `tests/simulatorParserIntegration.test.ts:97`
     asserts that this very fixture is raw mode, which is the proof that the
     simulator and the lint rule disagree about the same file: the simulator
     evaluates that `if` body through the quest codec
     (`conditionEvaluator.ts:105-116`, `engine.ts:136-148`) and the lint rule
     cannot see it.
   - **What the user loses:** the only project-wide check on the references
     #484 shows going stale. A renamed or mistyped `DIA_` in an `if` guard gates the
     dialog forever — the NPC's branch silently never runs — and the panel says
     the project is clean. #484's rename path leaves exactly these references
     behind, by its own diagnosis.
   - **Test that does not exist:** `extractFileFacts` over
     `condition-idioms.d`'s real model, asserting two `knowsInfoRefs`
     (`DIA_Foo_Condition` and `DIA_Baz_Condition`);
     `tests/problemsKnowsInfoDangling.test.ts` hand-builds `conditions` arrays and
     never parses a file.
   - **Minimal fix:** in `extractFileFacts`, after the `conditions` pass, visit
     every action with the existing `forEachAction` and scan two texts with one
     shared regex — `ConditionalAction.condition` (the `if` in an information
     function) and `Action.action` (the whole raw body of a condition function) —
     using the knows-info pattern the codec already owns
     (`conditionExpressionCodec.ts:100-102`), unanchored and global. Carry a
     per-reference key (condition index or line) instead of assuming the index,
     so the id becomes `…:${key}`; that also closes finding 3 for this rule. The
     same walk belongs in `docs/architecture/problems-panel.md`'s note about raw
     text.
   - **If we skip it:** the panel's error-severity rules keep missing the most
     common way a `Npc_KnowsInfo` is written, and nothing else in the app checks
     it.

2. **`orphaned-function` counts only dialog properties, choice targets and
   `calls` as references, so every function an NPC instance names — a routine
   via `daily_routine`, a start state via `start_aistate` — is reported as
   unreferenced** (`src/renderer/problems/domain/rules/orphanedFunction.ts:12-52`;
   the facts it is fed, `src/renderer/problems/domain/fileFacts.ts:16-80`)
   - **What this is:** `addRef` is called from dialogs' `information`/`condition`
     and from functions' choice targets and `calls`. `FileFacts` has no input
     from `model.instances` except the NPC names, so a function the *engine*
     reaches through a C_NPC property is in no set at all.
   - **Problem:** reproduced with the real parser on the repository's own
     reference scripts. `examples/DEV_2130_Szmyk.d:12` writes `daily_routine =
     Rtn_Start_2130;` and line 15 declares that function; the rule says
     `Function "Rtn_Start_2130" is not referenced by any dialog, choice, or
     function call.` `reference/SLD_99003_Farim.d:46` does the same for
     `Rtn_Start_99003`. A probe with `start_aistate = ZS_Test;` reports
     `ZS_Test` the same way. That is one finding per NPC routine in the project:
     the routine rule's own comment measures **1,154 routines** in retail Gothic
     II (`routineOverlap.ts:37-39`), and every one of them is named by
     `daily_routine` and by nothing else.
   - **What the user loses:** the panel. At the assumed load this rule pushes
     something on the order of a thousand false warnings into a list that has no
     filter and no virtualization, and the real orphans — the ones this rule
     exists to find — are buried in it. The row itself is also unusable: it
     points at the routine's declaration and tells the user to delete a function
     the game calls every morning.
   - **Test that does not exist:** an instance with `daily_routine = Rtn_X`
     beside `func void Rtn_X` in one file, asserting no `orphaned-function`.
     `tests/problemsOrphanedFunction.test.ts` covers only dialogs, choices and
     calls, which is the reference set the rule was written against.
   - **Minimal fix:** add `instanceRefs: string[]` to `FileFacts`, filled from
     each `model.instances` entry's `dailyRoutine` plus the identifiers in its
     `sourceText`'s `= <Ident>` values, and fold it into `referencedKeys`. The
     facts are extracted once per model and cached, so the cost is one regex per
     instance body on the scan that follows a parse.
   - **If we skip it:** the rule's warnings are dominated by false rows at any
     real project size, and the panel's warning count stops meaning anything.

## Should fix

3. **Four rules give two findings one `Problem.id` when a function repeats a
   line, and the list keys rows by that id**
   (`src/renderer/problems/domain/rules/voiceId.ts:56`, `:70`;
   `src/renderer/problems/domain/rules/outputUnitDrift.ts:40`, `:51`;
   `src/renderer/components/Problems/ProblemsList.tsx:101-106`)
   - **What this is:** the ids are `rule:filePath:functionName:<upper id>` with no
     per-occurrence part, while the occurrence list they are built from is one
     entry per `AI_Output`. Two lines with the same id in one function — the
     shape a duplicated voice line takes — produce two identical ids and two
     identical messages.
   - **Problem:** reproduced by calling both rules on a function with two
     `AI_Output (self, other, "DIA_Test_15_00")` lines: `voice-id-duplicate`
     returns two problems with one unique id, `output-unit-stale` two with
     different messages and one unique id. `ProblemsList` uses `problem.id` as
     the React key, so React warns and reconciles the two rows as one; the user
     sees two rows that cannot be told apart unless they read the line number in
     the secondary text. The repository already treats this as an invariant —
     `waypointNotInWorld.ts:36-44` and `duplicateSpawn.ts:50-58` both carry a
     `seen` set with a comment saying the id is what `ProblemsList` keys on, and
     `knowsInfoDangling` puts the condition index in its id.
   - **What the user loses:** the distinction between two occurrences of one
     mistake, and a duplicate React key on the panel.
   - **Test that does not exist:** one function, two lines with the same id,
     asserting `new Set(problems.map(p => p.id)).size === problems.length`.
     `tests/problemsVoiceId.test.ts:50-72` and its output-unit twin use distinct
     functions for the two occurrences.
   - **Minimal fix:** append `:${line ?? ''}` to the four ids, as the knows-info
     rule's fix in finding 1 does with its key.
   - **If we skip it:** the panel keeps emitting rows React cannot tell apart,
     which is exactly what the other three rules were fixed not to do.

4. **`voice-id-malformed` reports every trialogue voice line, whose ids are
   `AI_Output` ids that do not end `_<number>_<number>`**
   (`src/renderer/problems/domain/rules/voiceId.ts:12-13`, `:65-76`)
   - **What this is:** `VANILLA_PATTERN = /_\d+_\d+$/` with the claim, in the
     comment, that "vanilla voice ids end in `_<number>_<number>`". Gothic 2's
     trialogue lines are written `AI_Output (other, self, "TRIA_ArogAlchemist_00")`
     and end in a single number.
   - **Problem:** measured on `daedalus-parser/examples/DIA_Arog_SLD_99005.d`, a
     real dialog file: 136 literal voice ids, 15 of them `TRIA_*`, and **all 15
     of the file's malformed findings are those lines**. Nothing is wrong with
     them — they are what the trialogue mechanism plays.
   - **What the user loses:** one warning per trialogue line in any project that
     uses them, on a rule whose only value is catching typos, and the credence of
     the warning count above it.
   - **Test that does not exist:** a `DialogLine` id `TRIA_X_00` asserting no
     `voice-id-malformed`. `tests/problemsVoiceId.test.ts` only uses `_15_00`
     shapes.
   - **Minimal fix:** accept `_\d+$` as well as `_\d+_\d+$` (`/_\d+(?:_\d+)?$/`),
     or skip ids whose prefix is `TRIA`. Which of the two is right depends on
     whether the maintainer wants the rule to speak about trialogues at all —
     that is the one decision here.
   - **If we skip it:** a whole voice-line family is permanently flagged, and
     every such project learns to ignore the rule.

5. **`docs/architecture/problems-panel.md` lists 10 of the panel's 18 rule ids
   and two of the nine inputs the scan joins** (`docs/architecture/problems-panel.md:26-42`,
   `:44-58`)
   - **What this is:** the Rules table documents parse-error, npc-not-found,
     knowsinfo-dangling, choice-no-clearchoices, orphaned-function, both voice-id
     kinds, waypoint-not-in-world, duplicate-spawn and routine-mob-missing. It
     omits `output-unit-stale`, `output-unit-missing`, `routine-overlap` and the
     five `portal-*` kinds (`src/renderer/problems/domain/types.ts:16-38` lists
     all of them). The "Scan input
     and aggregation" section says the scan is joined by "two pieces of reference
     data … `waypointSiteIndex` … and `worldStore.waynetNames`"; `buildProjectView`
     also takes `spawnSites`, `npcsWithDialogs`, `outputUnits`, `parseErrors`,
     `routineSites`, `routinePlaces` and `portalFindings`
     (`projectView.ts:31-44`, `problemsStore.ts:125-138`).
   - **Problem:** the doc is the claimed behaviour this slice is judged against,
     and a reader checking what the panel reports, or adding a rule, works from a
     list that omits the only two rules that *write to disk* (the "Update OUs"
     half) and everything world-side. It is also the reason finding 1's blind spot
     reads as covered: the table names the condition type, not where it is looked
     for.
   - **What the user loses:** nothing at runtime; the next reviewer re-derives
     this from the code, as I did.
   - **Fix:** extend the table with the eight missing ids and their severities, and
     say in the inputs paragraph that the view joins six index passes plus the
     world and the OU database, each absent-means-nothing-is-known. Fold in the
     raw-text limit of finding 1 in the same edit.
   - **If we skip it:** the panel's durable doc drifts further from what the panel
     does, one rule at a time.

6. **Matching a free point is a linear scan of the world's free-point list per
   naming site, so one rule costs about 40 ms per scan at retail scale**
   (`src/renderer/problems/domain/types.ts:295-304`)
   - **What this is:** `worldHasPoint` asks `freePointNames.some((p) => p.includes(upper))`
     for every site whose name is not a waypoint. Both inputs are retail-sized:
     the doc measures 2,254 `zCVobSpot` VOBs in NewWorld and 874 `FP_` sites in
     the scripts (`types.ts:264-275`).
   - **Problem:** measured: 874 sites against 2,254 free points, `some(includes)`,
     is **43 ms** in Node's V8 on this machine — per scan, on the renderer's main
     thread, and a scan runs after every save and every world change while the
     panel is mounted (`storeSync.ts:44-50`). It is the largest single cost in a
     scan whose facts are otherwise cached.
   - **What the user loses:** about 40 ms of dropped frame per save while the
     list is being watched. Not a freeze; not free.
   - **Test that does not exist:** none needed for a pure speed change — the
     behavioural tests at `tests/problemsWaypointNotInWorld.test.ts:96-160` must
     stay green, which is the guard.
   - **Minimal fix:** join the list once into `freePointNames.join('\n')` and ask
     `joined.includes(upper)`. A name cannot contain `\n`, so the join cannot
     match across a boundary and the answer is unchanged; it is 874 scans of a
     45 kB string instead of 1.97 M string compares.
   - **If we skip it:** every scan pays it, and the cost grows with the world's
     spot count rather than with the project.

## Verdict

Verdict: fix 1 and 2 first. Both are the same fault — a rule reading a narrower
slice of the model than its question — and both are quiet: one loses findings the
user needed (the backstop for #484), the other adds a thousand the user cannot
use, in the panel that has no filter to hide them. 1 is the one that matters most,
because it is the only check that would catch a broken `Npc_KnowsInfo` and it
currently depends on how the condition function was typed. 3 through 6 are each a
few lines; 4 is the one that needs a decision before it needs code.

Lean: no deletions of substance in this slice. `values.ts` is the consolidation
the simulator review's L3 asked for, and every rule has a live caller in
`runRules.ts`. Two small drifts: `walk.ts`'s own comment says `forEachAction` is
"shared by the choice and voice-id rules", but both now read the facts
`fileFacts.ts` extracted, so it has one caller (`fileFacts.ts:30`) — the comment
should say so, and finding 1 gives it a second caller; and `WorldLocus.vob`
(`types.ts:82-83`) with its row branch (`ProblemsList.tsx:35`) is set by no rule.
Neither is worth an issue; delete the field, or leave it.

Not checked: no real project on this machine, so the routine and trialogue counts
are extrapolated from the 1,154 routines and the one real dialog file named above,
not counted over 890 files; the world-side inputs (`waynetNames`, `portalFindings`,
`routinePlaces`) are read as the store hands them over and belong to slice 9; the
`output-unit` write path's main-process half is slice 1's; and
`docs/plans/dialog-simulator-review-findings.md` is closed ground, so the raw-text
`!Npc_KnowsInfo` gap it names at H2 is taken as a decision, not re-reported.
