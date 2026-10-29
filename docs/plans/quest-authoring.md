# Quest authoring — a quest-level interface over topics, entries and `MIS_` state

Agreed 2026-09-28. Phases 1 (#322), 2 (#323) and 3 (#324) have landed; phase 4
(#325) is designed and decided but not built.

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

**Designed and decided 2026-10-29 (#325). Not yet built.** An author-named stage
within a running quest, such as "talked to Greg" or a counter like "3/5 sheep".

**A stage is a script-backed flag or counter, not a new action type and not
editor-side metadata.** It exists rather than a `B_LogEntry` line because a
dialog has to branch on it, and it is a variable rather than a sidecar label
because both the branch and the flag have to read correctly to a person and to
any other tool looking at the scripts.

**Naming: `STAGE_<QuestBase>_<Name>`** — the quest's `MIS_` base, so
`STAGE_VerloreneSchafe_Sheep`. One prefix and two value shapes make the stage
inventory a prefix scan of declared globals: no index, no sidecar, and a stage
written in a file the editor never opened is still recognised. `MIS_` is the
base because it is the quest key every other part of this uses
(`buildQuestDiary`, `questConditions`, the graph); overloading `MIS_` itself is
ruled out concretely, not stylistically — `getQuestMisVariableName` and
`getCanonicalQuestKey` derive quest identity by stripping the prefix, so
`MIS_X_SHEEP` would read as the quest `X_SHEEP` in all of them. The author types
a title and the identifier is sanitised as `questNameFromTitle` does for quests;
a name colliding case-insensitively with any declared global is refused, because
two stages behind one name would merge silently.

**Declaring** goes through `projectStore.addVariable(name, 'int', undefined,
declarationFile, false)` beside the quest's `MIS_` — the call the implicit-quest
upgrade already makes, so this adds no new write path. Unset ints are 0, which is
`FALSE`, so no initialiser is written. A quest with no `MIS_` cannot own stages:
the key would move when the quest is upgraded, orphaning every write, so creating
a stage on an implicit quest offers the existing upgrade first and refuses
otherwise.

**Writing** is a **Set Stage** entry in the add-action menu beside Start Quest,
producing one `SetVariableAction`: `STAGE_X_Name = TRUE;` for a flag,
`STAGE_X_Name = STAGE_X_Name + 1;` for a counter (Daedalus has no compound
assignment), and `= FALSE;` as a reset for a flag. No folding rule changes — a
one-line assignment is already its own card, so phase 1's "only runs of two or
more lines fold" stands. Recognition rides the existing Set Variable card: a
variable that is a *declared* stage renders as a Stage card (quest, stage,
"reached" / "counts up") with the raw line behind show-script, while a
`STAGE_`-looking name that is not declared stays a plain Set Variable with a
"not declared" hint and a register button — the way an undeclared quest on a step
card already behaves. The counter expression needs no text parsing:
`parseLiteralOrIdentifier` falls through to `node.text` for a non-literal right
side, so the model holds `STAGE_X_Name + 1` and round-trips it as written.

**Reading** is a **Stage** condition card beside phase 2's Quest State — quest →
stage → "reached" / "not reached", or "at least N" for a counter — writing a
`VariableCondition` (`== TRUE`, `== FALSE`, `>= 5`) and never a new condition
type, for phase 2's reason: a new type comes back from a reload as a raw check.
Recognition lives in a new `quest/domain/questStages.ts` beside
`questConditions.ts` and accepts only a declared stage. "Not reached" is written
`== FALSE`, matching "not started".

**A counter's target is derived, not declared** (decided 2026-10-29): the
largest `N` in a `>= N` / `== N` check of that stage anywhere in the project, and
the page shows where it was read. No `MAX_`-style constant is invented — a helper
constant vanilla does not have is what this plan's first decision rejects. A
counter nothing compares shows "no target", which is a legitimate counter.

**The quest page** gets a **Stages** section in `QuestDetails` (after the diary,
before "Checked by"), built by `buildQuestStages` in the diary's manner: each
stage with its kind, a jump to every write and every read through the same
function/path machinery as `QuestDiaryItem`, and two page-level notes —
*declared, never set* and *set, never checked*. Notes, not Problems findings: a
stage the player only ever meets in a log entry is legitimate, and the
project-wide "declared but never written is dead code" question is later and
different. The page shows only static facts (where it is set, how many sites
increment it, the target); "3 of 5" is a runtime value and the only place it
could come from is the dialog simulator, which is out of scope here.

**Rename is refused in the first slice** (decided 2026-10-29). A rename touches
the declaration, every writer and every reader across files, one save at a time;
the implicit-quest upgrade shows the per-file failure contract such a rename
would inherit, and a half-renamed quest is the one state the page could not
explain. The author adds the new stage and repoints the writes. **Delete**
removes the declaration and refuses while any write or read still names the
stage, and never edits a dialog on its own — silently deleting branches is worse
than an error. All other writes are ordinary action edits through the existing
save, re-read by the store sync.

Slices: **1** — `questStages.ts` (inventory and write recognition), the
`addVariable` path, the Set Stage menu entry and Stage card, the Stages section
with its notes, for flags and counters together (counters are not a later
slice: decided 2026-10-29). **2** — the Stage condition card, its recogniser,
renderer and `conditionRegistry` routing (same phase, not a separate issue).
Rename is not scheduled.

