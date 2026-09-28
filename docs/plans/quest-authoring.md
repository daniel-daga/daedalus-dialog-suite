# Quest authoring — a quest-level interface over topics, entries and `MIS_` state

Proposed 2026-09-28. Nothing is built yet.

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

## Open decision

- **Existing implicit quests** (a `TOPIC_` constant and no `MIS_` variable):
  either leave them as they are, or also offer a one-click upgrade that adds an
  `MIS_` variable. New quests always get an `MIS_` variable either way.

## Phases

### Phase 1 — quest steps and automatic declarations

The action picker gets a Quest group with these actions: Start quest, Add
diary entry, Complete quest, Fail quest, Cancel quest, and Add note.

Each action writes the vanilla lines. Start writes `Log_CreateTopic(TOPIC_X,
LOG_MISSION)`, `Log_SetTopicStatus(TOPIC_X, LOG_RUNNING)`, `B_LogEntry` and
`MIS_X = LOG_RUNNING`. Complete, Fail and Cancel set both `MIS_X` and the topic
status, so the two cannot drift apart. Add note writes
`Log_CreateTopic(TOPIC_X, LOG_NOTE)` + `B_LogEntry`.

A recogniser folds a contiguous run of those lines, in any order, back into
one quest-step card. A run that does not match stays as raw cards. Every
quest-step card has a "show script" toggle that expands it into its raw lines.
The recogniser is pure domain logic in `quest/domain/`. It has to be tested on
the vanilla variants in the parser corpus before anything relies on it.

The quest picker shows diary titles (the `TOPIC_` constant's value) and offers
"New quest…" inline. The first use of a new quest writes `TOPIC_X`, `MIS_X` and
the `B_CloseTopic` registration, using the file choice
`utils/questLogFiles.ts` already makes. The author is asked for a file only
when that choice is empty. This replaces the Create Quest dialog's
method/file form and the separate Register Topic step.

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
