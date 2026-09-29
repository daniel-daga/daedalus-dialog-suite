# Quest authoring — a quest-level interface over topics, entries and `MIS_` state

Agreed 2026-09-28. Phase 1 (#322) has landed; phases 2–4 are #323–#325.

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

Conditions read "Quest *X* is running / completed / failed / cancelled / not
started / not running" instead of `MIS_X == LOG_…`. "Not running" also answers
#320. Each one has a "show script" toggle as well.

### Phase 3 — quest page as the diary

`QuestDetails` lists every diary entry and state change of a quest across all
dialogs, in story order from the existing graph inference. Entry text can be
edited in place, and each entry jumps to the dialog that writes it.

### Phase 4 — named sub-stages

An author-named stage within a running quest, such as "talked to Greg" or a
counter like "3/5 sheep". The editor creates the variable behind it. How
stages are declared and recognised is designed when this phase starts.
