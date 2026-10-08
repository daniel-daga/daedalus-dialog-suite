# Quest authoring — a quest-level interface over topics, entries and `MIS_` state

Agreed 2026-09-28. Phases 1 (#322), 2 (#323) and 3 (#324) have landed; phase 4 is #325.

## Problem

Writing a quest today means working with the raw script pieces. The Create
Quest dialog asks for "Method A: Implicit / Method B: Explicit" and a file for
each declaration. `RegisterTopicDialog` is a separate step. A quest start in a
dialog is four hand-placed cards (`CreateTopic`, `LogSetTopicStatus`,
`LogEntry`, `SetVariable MIS_X = LOG_RUNNING`), and conditions show `MIS_…` and
`LOG_…` directly. The diary topic status and `MIS_` are two separate records of
the same state and can drift apart (`analysis.ts` `hasLifecycleConflict`).

## Goal

The author works with quests, their states and their diary entries. The editor
writes the vanilla Gothic code and manages the declarations. The raw cards and
the Variable Manager stay available but are never required.

## Decisions (settled 2026-09-28)

- **Recognise vanilla patterns; add no helper functions.** The output is the
  plain Gothic 2 code other modders already read, and existing scripts are
  shown as quest steps without migrating them.
- **XP is optional.** "Complete quest" has an XP toggle, off by default. When
  it is on, the editor writes `B_GivePlayerXP(XP_X)`, and the author can use an
  existing `XP_` constant, let the editor create one, or enter a literal
  number.
- **Completing a quest is optional.** A quest that is only started, or that
  never reaches a final state, is valid. The quest page shows it as
  "no ending yet" (it is not treated as an error).
- **Notes (`LOG_NOTE`) are included from phase 1.** "Add note" works the same
  way as a quest, but notes have no states and no `MIS_` variable.
- **Named sub-stages come in a later phase** (see phase 4).
- **Existing implicit quests** (a `TOPIC_` constant, no `MIS_` variable) stay
  readable as they are: their state is shown as "inferred from dialog X". The
  quest page offers a one-click upgrade that declares `MIS_X` and sets it at
  the quest's start and end points. New quests always get an `MIS_` variable.

## Phases

### Phase 1 — quest steps and automatic declarations

**Landed:** the add-action menu has Start Quest, Complete Quest, Fail Quest,
Cancel Quest and Note. Each one writes the vanilla lines. Start writes
`Log_CreateTopic(TOPIC_X, LOG_MISSION)`, `Log_SetTopicStatus(TOPIC_X,
LOG_RUNNING)`, `B_LogEntry` and `MIS_X = LOG_RUNNING`. Complete, Fail and Cancel
set both `MIS_X` and the topic status, so the two cannot drift apart; Complete
has an optional XP field. Note writes `Log_CreateTopic(TOPIC_X, LOG_NOTE)` +
`B_LogEntry`.

A recogniser (`quest/domain/questSteps.ts`) folds a contiguous run of those
lines, in any order, into one quest step card. Its edits, deletes and moves
change all of its lines. The card has a "show script" view that shows the lines
(read-only; the raw lines are edited in the source view). Decided while
building:

- **Only runs of two or more lines fold.** A lone line keeps its raw card, so
  Log Entry (already titled with its diary name), Set Variable and Create Topic
  stay reachable. "Add diary entry" is therefore the existing Log Entry card,
  not a step of its own.
- **The Create Topic menu entry writes only its own line** (it used to add a
  status and an entry line too); Start Quest does the full start.
**Landed:** the quest picker and the automatic declarations. A step card
picks its quest by diary title (`components/common/QuestPicker.tsx`); a title
no quest has becomes `New quest "…"`, which in a project opens
`RegisterTopicDialog` in create mode: only the title is asked for, and the
names (`questNameFromTitle`: "Die verlorenen Schafe" → `DieVerlorenenSchafe`),
chapters and files are prefilled under Details, which opens by itself only
when no definition file can be suggested. Without a project the step just
takes the name. The quest panel's "Create New Quest" uses the same flow, and
the old Create Quest dialog (Method A/B, file pickers) is gone. The
`B_CloseTopic` call is optional when creating: vanilla has no `B_CloseTopics`
function, so a project without one still gets `TOPIC_` + `MIS_`. An
undeclared quest name on a card shows "Not declared" and a register button.

### Phase 2 — plain-language conditions

**Landed:** conditions read "Quest *X* is running / completed / failed /
cancelled / not started / not running" instead of `MIS_X == LOG_…`, with the
quest picked by diary title and a "show script" toggle. "Not running" answers
#320. The Add-condition entry is "Quest State". The recogniser and what it
accepts are in `docs/architecture/quest-editor.md` (`questConditions.ts`).
Decided while building:

- **The card writes a `VariableCondition`, not the parser's
  `QuestStateCondition`.** The parser never produces the latter, and it can
  only express `==`, so a check written as one came back from a reload as a
  raw variable check. The editor no longer creates it.
- **"Not started" is written `MIS_X == FALSE`** (an unset int is 0).
- **A quest whose `MIS_` and `TOPIC_` names differ is not linked.** The
  picker derives the topic from the variable name, so such a check shows the
  derived name as "Not declared". Linking the two needs a `MIS_`/`TOPIC_`
  pairing the editor does not keep yet; it is not guessed here.

### Phase 3 — quest page as the diary

**Landed:** `QuestDetails` lists every diary entry and state change of a quest
across all dialogs, in story order from the existing graph inference, with
entries edited in place and a jump to each writing dialog. An implicit quest
reads "State inferred from dialog X" and offers "Add MIS_X". The rules (what
counts as a state change, how ties in story order break, where the upgrade
writes) are in `docs/architecture/quest-editor.md` (`questDiary.ts`). Decided
while building:

- **State changes are rows, not steps.** A function that writes the same
  state through the topic status and `MIS_` shows it once; a branch that ends
  the quest two ways shows both.
- **`MIS_X` is declared beside the `TOPIC_` constant**, as the create flow
  does, so the upgrade is refused (button disabled) for a quest with no
  `TOPIC_` declaration.
- **The upgrade declares first, then edits the dialogs**, so the saves never
  write an undeclared name. A save that fails part-way leaves the variable
  declared and the page no longer implicit; the remaining assignments are then
  written by hand or with the quest step cards.
- **The page's chips still say "Method B: Explicit" and "Logic:
  Unknown/Diary Only"**, phase 1's old vocabulary; the advice panel with the
  Method A/B text is gone.

### Phase 4 — named sub-stages

An author-named stage within a running quest, such as "talked to Greg" or a
counter like "3/5 sheep". The editor creates the variable behind it. How
stages are declared and recognised is designed when this phase starts.
