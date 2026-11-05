# Quest Editor Architecture

This document captures the durable architecture decisions for quest editing in this monorepo.

## Scope

The quest surface is a quest list and a details panel
(`components/QuestEditor/` — `QuestEditor.tsx`, `QuestList.tsx`,
`QuestDetails.tsx`), backed by pure analysis and graph inference in
`quest/domain/`. The details panel is the
quest's diary (#324): every entry and state change in story order, entries
edited in place, a jump to each writing dialog, and a one-click upgrade for an
implicit quest. Below the diary sits the same quest's named sub-stages (#325):
each stage's kind, its derived counter target, a jump to every write and every
check, and the "declared, never set" / "set, never checked" notes. Its writes go through `components/QuestEditor/questDiarySave.ts`. Its "Create New Quest"
button opens the same create flow as a quest card's "New quest"
(`RegisterTopicDialog` in create mode, #322): only the title is asked for; the
`TOPIC_`/`MIS_` names (from `utils/questLogFiles.questNameFromTitle`), chapters
and target files are prefilled under Details. New quests always get a `MIS_`
variable; the `B_CloseTopic` call is written when a close-topics file exists
(it is a mod convention, not vanilla).

The litegraph-based Flow view (canvas + inspector + command write path) was
**removed** per the production-readiness review (§1 Option B in
`docs/plans/production-readiness-review-findings.md`): it was an incomplete
authoring surface riding on pinned litegraph.js internals, and its write path
(quest commands, guardrails, multi-file batch history) carried most of the
quest code's maintenance cost. With it went the `litegraph.js` and `dagre`
dependencies, the `node-editor.html` playground, the writable-quest feature
flag, and the quest batch history in `historyStore`. Quest content is authored
through the dialog editor; the quest view visualizes what the scripts declare.

## Domain Model

A quest is represented as linked script concepts, not a single object:

- Topic constants (`TOPIC_*` / `Topic_*`) define player-facing quest names.
- Mission variables (`MIS_*`) track lifecycle state (`LOG_RUNNING`, `LOG_SUCCESS`, `LOG_FAILED`, `LOG_OBSOLETE`).
- Quest actions are inferred from dialog/function bodies (for example `Log_CreateTopic`, `Log_SetTopicStatus`, `B_LogEntry`, `Log_AddEntry`, and `MIS_*` assignments).
- Quest flow conditions include dialog knowledge checks and variable/state conditions (including equality and non-equality forms).

## Internal Boundaries

Two layers remain, with a one-way import direction (UI → domain):

1. `quest/domain/` (pure logic)
- Quest analysis, graph inference, and the condition-expression codec.
- Must not import React/MUI/litegraph/dagre, renderer hooks, zustand, or
  Electron APIs. Enforced by `tests/questDomainBoundary.test.ts`, which also
  asserts the command write path stays removed and that `components/QuestEditor/`
  still holds the surface it guards; a future move fails there rather than
  silently weakening the check.

2. Quest UI (`components/QuestEditor/` — `QuestEditor.tsx`, `QuestList.tsx`,
   `QuestDetails.tsx`, `questDiarySave.ts`)
- Reads via `quest/domain` and the project store. Writes through
  `projectStore.registerTopicInLogFiles` (the create flow) and
  `questDiarySave.ts` (#324), which, like a routine save, opens the writing
  function's file model, replaces its actions and saves it with the ordinary
  `saveFile`; the page re-reads it through the store sync. An entry edit is
  refused when the line at its path is no longer the entry the page read.

### Physical Layout

- `graph.ts` — `buildQuestGraph` pipeline entry; stages live in
  `questNodeIdentification.ts`, `questEdgeBuilding.ts`, `questLayout.ts`
  (filtering + node materialization — no visual layout, every node carries a
  zero position), with `questGraphSharedHelpers.ts`,
  `questGraphInternalTypes.ts`, and `questGraphConstants.ts` as shared
  internals.
- `analysis.ts` — quest lifecycle analysis (`analyzeQuest`,
  `getQuestReferences`, `getUsedQuestTopics`) powering the quest list/details.
- `conditionExpressionCodec.ts` — parse/serialize between condition expression
  strings and structured `DialogCondition[]`. Shared: the dialog simulator
  (`simulator/domain/conditionEvaluator.ts`) consumes the parser.
- `questSteps.ts` — quest steps (#322): folds a contiguous run of vanilla
  quest lines (`Log_CreateTopic`, `Log_SetTopicStatus`, `B_LogEntry`,
  `MIS_X = LOG_…`, a trailing `B_GivePlayerXP`) into one step, builds the lines
  for a new step, and edits a step in place. A step is a view over existing
  actions, not a new action type, so an unedited file saves unchanged. Only the
  `LOG_…` constant names count as lifecycle states (`MIS_Counter = 3` is a
  counter), and only runs of two or more lines fold, so a lone line keeps its
  raw card. The dialog editor shows a step as one card: `ActionsList` groups
  the lines into list items (`nestedActionUtils.getActionListItems`) and hands
  the card a synthetic `QuestStep` action that is never stored; the card's
  edits, deletes and moves become list-level patches through
  `ActionLevelPatchContext`, provided per edited function.
- `questConditions.ts` — quest conditions (#323): reads a `MIS_` check as
  "Quest X is running / completed / failed / cancelled / not started / not
  running" and builds the check back. Also a view: the parser hands
  `MIS_X == LOG_…` over as a `VariableCondition`, the card writes one, and
  `conditionRegistry.getConditionType` routes a recognised one to the quest
  card. Recognised: `== LOG_<state>`, `!= LOG_RUNNING`, and `== FALSE`, `== 0`
  or `!MIS_X` for not started; written: `== FALSE` for not started. Any other
  number stays a raw check (it may be a counter). The quest is picked by
  diary title through the topic its `MIS_` name gives (`MIS_X` → `TOPIC_X`),
  so a quest whose two names differ shows "Not declared" on the card.

- `questStages.ts` — named sub-stages (#325): an author-named flag or counter
  inside a running quest. A stage is an ordinary int, `STAGE_<QuestBase>_<Name>`,
  declared beside the quest's `MIS_` through the same `addVariable` call the
  implicit upgrade makes; declared with no initialiser, because an unset int is
  0, which is `FALSE`. **The inventory is a prefix scan of the declared globals**
  — no index, no sidecar — so a stage written in a file the editor never opened
  is still recognised; the quest a stage belongs to is the longest prefix the
  project declares a `MIS_` for. A title is sanitised as a quest name is
  (`questNameFromTitle`), and a name colliding case-insensitively with any
  declared global is refused, since two stages behind one name would merge
  silently. Writing is a **Set Stage** action-menu entry producing one
  `SetVariableAction`: `= TRUE`, `= FALSE` (a reset), or `= STAGE_X_Name + 1`
  (Daedalus has no compound assignment). Reading is a **Stage** condition card
  beside Quest State that writes a `VariableCondition` — `== TRUE`, `== FALSE`,
  `>= N` — never a new condition type, for `questConditions.ts`' reason.
  Recognition accepts only a *declared* stage on both sides; a `STAGE_`-shaped
  name nothing declares keeps the plain card and a "Not declared" hint. A
  counter's target is derived from the largest `N` in its `>= N` / `== N`
  checks, never declared. A quest with no `MIS_` cannot own stages (the key
  would move when it is upgraded), rename is refused, and delete refuses while
  any write or check still names the stage.

- `questDiary.ts` — the quest page as the diary (#324). `buildQuestDiary`
  lists one quest's `B_LogEntry` lines and state changes, through if/else
  branches, with each line's path in its function. A state written twice by
  one function (topic status and `MIS_`, or `Log_CreateTopic`) is one row, and
  `MIS_` counts only for the named `LOG_…` constants, as in `questSteps.ts`.
  Story order is a topological order of `buildQuestGraph`'s edges; where the
  graph leaves functions unordered, a start sorts before entries and entries
  before an ending, then by name, and a cycle is broken at its lowest-ranked
  node. Lines keep their written order within a function. An implicit quest
  (no `MIS_` declared) reads "State inferred from dialog X", X being the
  dialog that starts it; its upgrade appends `var int MIS_X` to the end of the
  file that declares the `TOPIC_` constant, and `withQuestStateAssignments` sets
  `MIS_X` to the same state right after each topic-status line (or a lone mission
  `Log_CreateTopic`) in a list that does not set it already. The declaration is
  written **last**, so a save the project refuses leaves the quest untouched and
  the upgrade still offered (#491). A quest with no
  ending shows "No ending yet", not an error.

The graph node/edge types in `types/questGraph.ts` are editor-owned and carry
no rendering-library dependency. The domain imports only model types
(`types/global`, `types/questGraph`), `utils/questIdentity`, and the pure
`components/actionTypes` module.

## Implemented Outcomes (Consolidated)

From completed quest planning tracks, the surviving baseline is:

- Graph model supports linked topic + `MIS_*` state views with typed node/edge semantics.
- Corpus-driven improvements include:
  - `Log_AddEntry` parsed as first-class `LogEntry` action.
  - Canonical topic identity handling across `TOPIC_*` / `Topic_*` and case variants.
  - `MIS_*` transition-aware quest lifecycle inference and usage analysis.
  - Requires-link support beyond strict equality checks.

## Maintenance Rule

When a quest-related plan finishes, migrate durable decisions into this architecture document (or another canonical reference) and delete the completed plan file.
