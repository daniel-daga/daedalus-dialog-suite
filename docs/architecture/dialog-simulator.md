# Dialog Simulator Architecture

The dialog simulator is a renderer-only, read-only playthrough environment for
the supported subset of Daedalus dialog actions and conditions. It lets writers
exercise C_INFO functions, persistent choice menus, and scratch quest state
without changing the semantic model or writing files.

## Layer boundary

Imports flow in one direction:

1. `src/renderer/components/Simulator/` owns the modal UI and adapts the live
   semantic-model snapshot supplied by the editor.
2. `src/renderer/simulator/application/` owns a `SimulatorSession`, explicit
   unknown-condition policy, entry selection, restart baselines, and Back
   snapshots. It has no Zustand dependency.
3. `src/renderer/simulator/domain/` owns projection, canonical identifiers,
   availability, condition evaluation, and action interpretation. It has no
   React, MUI, Electron, or store dependency.

The UI projects the selected full `SemanticModel` once with
`createSimulatorModel`. Project mode and single-file mode therefore use the
same simulator behavior, and the lightweight project dialog index is never
used as an execution source.

## Identity and projection

Daedalus identifiers are compared case-insensitively. Simulator maps and sets
use `trim().toLowerCase()` keys while projected entries retain original names
for display. Dialog `condition` and `information` properties may be strings or
linked function objects; projection normalizes both forms.

The projection holds read-only references to dialog functions and copies only
its own maps, sets, and dialog-entry records. It includes full C_INFO metadata,
constants, and declared `MIS_*` variables. Source semantic models are never
mutated.

## Scratch state and execution

Every declared `MIS_*` variable starts at an explicit assumed value of zero.
Assignments remove the assumed marker. The interpreter supports numeric
`=`, `+=`, `-=`, `*=`, and `/=` operators, built-in Boolean and `LOG_*` values,
and case-insensitive constants. Unresolved operands, invalid operators, and
division by zero become visible unknown values rather than guessed results.

Choice menus persist across a selected target. Only an executed
`Info_ClearChoices` clears them, so a target may return to the same menu or
replace it with a clear-then-add sequence. Conditional branches are walked
recursively, including nested choices. User-driven revisits are valid; a shared
per-execution action budget protects only synchronous action walking.

Execution records why it terminated (`completed`, `stopped`, budget exceeded,
or missing function). This prevents safety aborts and broken references from
being mistaken for a completed C_INFO. Choices are executable only while the
state is awaiting input.

## Three-valued conditions

Condition evaluation returns `true`, `false`, or `unknown`. AND returns false
when any clause is false, otherwise unknown when any clause is unknown. OR
returns true when any clause is true, otherwise unknown when any clause is
unknown.

Structured MIS/quest-state comparisons and known-info checks are modeled.
World-dependent checks and generic expressions are unknown. Raw conditional
expressions first pass through the quest condition-expression codec; only its
structured result is evaluated. Codec failures and generic fallbacks retain a
reason for display.

Unknowns are never silently coerced by the evaluator. The session owns the
explicit assume-unknown policy. When an unknown C_INFO gate or branch is taken,
the transcript records the assumption and reason.

## Availability and history

Available dialogs are filtered by NPC, ordered by `nr` with source order as the
tie-breaker, and reevaluated against current scratch state. Known non-permanent
entries are excluded; known permanent entries remain eligible. False entries
are hidden, while unknown entries remain visible with their reason and current
policy.

The selected C_INFO becomes known only after its initial information function
completes normally or explicitly stops processing. Choice target functions do
not teach additional C_INFO entries.

Before entry launch/switch, choice selection, or an assumption-policy change,
the session stores a complete deep snapshot. Back restores exactly one snapshot
without separately editing the transcript. Restart replays the current entry
from its prelaunch scratch-state baseline and clears branch history.

## UI and verification

`DialogDetailsEditor` supplies the current full semantic model and selected
dialog to a modal simulator. The modal renders speaker-attributed transcript
lines, persistent choices, visible condition assumptions, available entries,
and a scratch-state inspector. It does not save or dispatch editor history.

Jest suites cover projection, execution, choices, condition truth tables,
availability, and session snapshots. The browser Playwright fixture uses the
`//__MOCK_MODEL__` seam to verify launch, persistent choices, Back, alternate
branch selection, known-info availability, and Restart through the real UI.

## Deliberate limitations

- No arbitrary Daedalus helper execution or world-state simulation.
- No inventory, NPC, distance, talent, or other engine-side effects.
- No voice playback.
- Important dialogs are labeled but are not auto-run.
- Quest-path orchestration is a future adapter over the same domain layer.
