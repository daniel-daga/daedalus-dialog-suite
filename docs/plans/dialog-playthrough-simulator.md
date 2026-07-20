# Dialog Playthrough Simulator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

Status: **active plan**. Implements P1 item 1 from [`docs/feature-suggestions.md`](../feature-suggestions.md).

## Goal

An in-editor "play this conversation" mode. From a selected dialog, the writer
steps through its info function: lines render by speaker, choices appear as
clickable options, `Info_AddChoice`/`Info_ClearChoices` are followed into
sub-functions, and a scratch state of `MIS_*` variables and known infos is
tracked so C_INFO conditions evaluate live. The writer can branch, back up,
and reset — all without starting Gothic 2.

The semantic model carries the data needed for the supported subset
(`DialogLine`, `Choice`, `ClearChoicesAction`, `ConditionalAction`,
`SetVariableAction`, condition types, the `functions` map). This is
**renderer-only, non-mutating** work — no engine integration, no writes to the
model or disk.
The semantic model has no variable initializer field, so declared `MIS_*`
variables always start as an explicit **assumed 0**.

## Non-goals

- No engine-accurate simulation. We evaluate the subset of conditions/actions
  the model represents structurally; anything we can't evaluate is shown as an
  explicit "unknown / assumed" state, never silently guessed.
- No mutation of the dialog, semantic model, project, or files. The simulator
  reads the model and keeps its own scratch state. (No undo/redo wiring.)
- No voice playback / WAV lookup (that is P1 item 3).
- No new parser work. If a needed shape is missing we surface it as an
  unsupported node, not a parser change.
- No execution of arbitrary Daedalus helper functions or side effects.
- No automatic execution of `important` dialogs in v1; show an explicit badge
  so this simulator simplification remains visible.

## Architecture

Mirror the quest editor's strict three-layer boundary
(`docs/architecture/quest-editor.md`); import direction is one-way
UI → application → domain.

1. **`src/renderer/simulator/domain/`** — pure logic, no React/MUI/Electron.
   The interpreter, its state machine, and the condition evaluator live here.
   Fully Jest-testable in isolation. This is the bulk of the feature.
2. **`src/renderer/simulator/application/`** — a thin `SimulatorSession`
   orchestrator that accepts an already-created read-only `SimulatorModel` and
   owns scratch state, the unknown-assumption policy, and history. It does not
   import or read Zustand stores.
3. **`src/renderer/components/Simulator/`** — selects the live semantic-model
   snapshot from `useFileStore` or `useProjectStore`, projects it once through
   `createSimulatorModel`, and renders a launcher plus a
   `SimulatorDialog` (MUI modal, copy the `QuestDiffPreviewDialog.tsx`
   template) with a transcript pane, choice buttons, and a scratch-state
   inspector.

### Why a modal, not a fourth `MainLayout` view

The simulator is launched *from a specific dialog the writer is editing*, is
transient, and reads a snapshot. A modal (like `QuestDiffPreviewDialog`) keeps
it renderer-only, avoids `activeView` state churn, and needs no left-rail
plumbing. Launch it from the dialog editor toolbar (`DialogDetailsEditor` /
`EditorColumn` in `ThreeColumnLayout.tsx`) with the current
NPC + dialog as the entry point. Revisit the modal-vs-view choice only if the
"simulate this quest path" extension (below) lands.

## Domain design (`simulator/domain/`)

### Inputs (read-only projection of the model)

```
interface SimDialogEntry {
  name: string;
  npc: string;
  nr: number;
  conditionFunction?: string;
  informationFunction?: string;
  important: boolean;
  permanent: boolean;
}

interface SimulatorModel {
  functions: ReadonlyMap<string, DialogFunction>; // canonical function name
  dialogs: readonly SimDialogEntry[];
  declaredMisVariables: ReadonlySet<string>;
  constants: ReadonlyMap<string, string | number | boolean>;
}
```

Resolution is **case-insensitive** throughout. Add a pure
`simulator/domain/identifier.ts` helper whose canonical form is
`value.trim().toLowerCase()`. Do not deep-import `daedalus-parser` `name-utils`:
it is not a public package export, and parser changes are out of scope. The
application projection may reuse renderer `questIdentity` helpers for
TOPIC-to-MIS conversion. Retain original names for display, but key every
simulator map/set by the canonical form.

Project full dialog properties, not the lightweight `DialogMetadata` index.

### Scratch state

```
type UnknownValue = { kind: 'unknown'; expression: string };

interface SimState {
  misVars: Map<string, number | UnknownValue>;
  assumedMisVars: Set<string>;
  knownInfos: Set<string>;           // canonicalized dialogRefs the player "knows"
  transcript: TranscriptEntry[];     // rendered lines + chosen options, in order
  pendingChoices: SimChoice[];       // current Info_AddChoice set (order preserved)
  status: 'running' | 'awaiting-choice' | 'ended';
}
```

Seed every declared `MIS_*` variable to `0` and add it to `assumedMisVars`.
An assignment removes it from that set. `knownInfos` starts empty. Mark the
selected C_INFO known when its information function finishes its initial
synchronous action list, including when that leaves the session awaiting a
choice. Running a choice target does not mark a new C_INFO known.

### Stepping semantics — an interpreter over `DialogAction[]`

Execute a function's `actions` sequentially. Per action `type`:

| Action | Effect |
|---|---|
| `DialogLine` | push a transcript line: `{ speaker, text, id }`. `speaker` is `'self'`/`'other'`; render as NPC vs. hero. |
| `Choice` (`Info_AddChoice`) | append to `pendingChoices` (`{ text, targetFunction, dialogRef }`). |
| `ClearChoicesAction` (`Info_ClearChoices`) | clear `pendingChoices`. |
| `ConditionalAction` | evaluate `.condition` (raw string, see evaluator); recurse into `thenActions` or `elseActions`. |
| `SetVariableAction` | if `MIS_*`, update scratch state for supported numeric operators; unresolved values become `UnknownValue`. |
| `StopProcessInfosAction` (`AI_StopProcessInfos`) | set `status='ended'`. |
| others (topic/log/inventory/npc actions) | record as a neutral "side-effect" transcript note where useful; no state change. Never crash on an unmodeled action. |

Resolve numeric literals, `TRUE`/`FALSE`, built-in `LOG_*` states, and
case-insensitive constants. Support `=`, `+=`, `-=`, `*=`, and `/=` for numeric
operands. Division by zero, unknown operators, and unresolved symbolic values
produce visible `UnknownValue` state. Do not reuse `setMisState.ts` as operator
semantics; that editor command intentionally supports only `=`.
When execution reaches the end of a function with `pendingChoices` non-empty,

`status='awaiting-choice'` and the UI renders the buttons. Selecting a choice:

1. pushes the chosen text to the transcript;
2. preserves the current `pendingChoices`;
3. runs the resolved target function; and
4. applies any `Info_ClearChoices`/`Info_AddChoice` actions it encounters.

Choices persist until an executed `Info_ClearChoices` removes them.

**Choices nested in `ConditionalAction` branches must be reached** — do not
flat-filter for top-level `Choice` only (the bug latent in
`useFunctionTreeBuilder`'s flat filter). Walk actions recursively; reuse the
`forEachChoice` traversal in `daedalus-parser` `cross-references.ts` as the
reference for descent into `then/elseActions`.

**Cycle safety**: do not reject a repeated choice target or graph cycle. Choice
targets run only after user input, so revisiting a menu is valid behavior. Guard
only synchronous recursive action walking with an action budget/depth limit;
do not copy the static traversal's `visited` semantics into the interpreter.

### Entry-point selection — which dialogs are "available"

Before the writer picks a starting line, the simulator lists the NPC's dialogs
whose C_INFO **condition function passes** against current scratch state,
ordered by `nr` (like the game's info list). The lightweight `ProjectIndex` /
`DialogMetadata` is **insufficient** — it carries only `{dialogName, npc,
filePath}`. The simulator must read the full parsed `SemanticModel`
(`dialogs[name].properties` → `condition`, `information`, `nr`, `important`,
`permanent`) via `useProjectStore.mergedSemanticModel` (project mode) or the
open `FileState.semanticModel` (single-file mode). Normalize
`information`/`condition` with `extractFunctionName` — they may be a string or a live `DialogFunction`.

Availability rules, in order:

1. A known non-permanent dialog is unavailable even if its condition passes.
2. A permanent dialog may remain available after becoming known.
3. A missing or unsupported condition is `unknown`, not an implicit pass.
4. Otherwise evaluate the condition function against scratch state.
5. Sort by `nr` ascending and preserve source order for ties.

The picker hides `false` entries. It shows `unknown` entries with their reason
and the current assume-unknown true/false policy. `important` entries receive a
badge but are not auto-run in v1. Recompute availability after known-info,
MIS-state, or assumption-policy changes.

### Condition evaluator (`simulator/domain/conditionEvaluator.ts`)

A pure evaluator over `SimState`. Two shapes to handle:

1. **Structured `DialogCondition[]`** on `DialogFunction.conditions` (the C_INFO
   gate), combined with `conditionOperator` (`AND`/`OR`):
   - `NpcKnowsInfoCondition` → `knownInfos.has(canon(dialogRef))`
   - `VariableCondition` / `QuestStateCondition` → compare `misVars` (map
     `TOPIC_`→`MIS_`, honor `LOG_RUNNING`/`SUCCESS`/`FAILED`/`OBSOLETE` values)
   - `NpcIsDead`/`NpcIsInState`/`NpcHasItems`/distance/talent → **not
     modelable** from scratch state → return `unknown`.
2. **Raw expression strings** on `ConditionalAction.condition` and generic
   `Condition` → parse with the existing
   `quest/domain/commands/conditionExpressionCodec.ts`
   (`parseConditionExpressionToConditions`), then evaluate structured clauses
   with the same evaluator.

If the codec fails, return `unknown` with the parse error. If it returns
`mode: 'generic-expression'`, return `unknown` with the raw expression; do not
feed the unchanged generic `Condition` back into the evaluator. Only structured
clauses are evaluated recursively. Tests must cover mixed `&&`/`||`, negated
calls, custom functions, malformed expressions, and unresolved constants.
Use three-valued AND/OR truth tables before applying the session's explicit
unknown-assumption policy.

Evaluation is **three-valued**: `true | false | unknown`. `unknown` clauses do
not silently pass or fail — the UI shows the branch as "condition unknown
(assumed true)" with the assumption configurable, so the writer always knows
when they've left modeled territory. This is the core trust property.

Use explicit three-valued logic: AND is `false` if any clause is false and
otherwise `unknown` if any clause is unknown; OR is `true` if any clause is true
and otherwise `unknown` if any clause is unknown.

## UI design (`components/Simulator/`)

- **Launcher**: a "▶ Play dialog" button in the dialog editor toolbar
  (`data-testid="simulator-launch"`), enabled when a dialog with an info
  function is selected.
- **`SimulatorDialog`** (MUI `Dialog`, `maxWidth="md"`), three regions:
  1. **Transcript** — scrolling list of speaker-attributed lines (NPC left,
     hero right), plus faint side-effect notes (`MIS_X = 2`, "topic created").
  2. **Choice tray** — buttons for `pendingChoices`, in order; clicking advances.
     When `status==='ended'`, show an "end of dialog" marker + Restart.
  3. **State inspector** (collapsible side panel) — current `MIS_*` values
     (with "assumed" badges), known infos, and the active function name.
- **Controls**: Restart, Back one step (restore the prior complete
  `SimState` snapshot — keep a snapshot stack in the session), and the
  available-dialogs picker for choosing a different entry info.
  Snapshot before launching/switching an entry, selecting a choice, or changing
  an assumption that changes the path. Clone maps/sets; Back restores exactly
  one full snapshot and must not separately pop a transcript entry.
- `data-testid`s on launch, each choice button, transcript lines, and the
  restart control so Playwright can drive the real flow.

## Implementation slices (TDD, each independently green)

Each slice: failing test first → minimal implementation → `npm test` +
`npm run lint` + `npm run typecheck:renderer` green for
`daedalus-dialog-editor`.

1. **Projection + canonical identifiers** → Jest in
   `tests/simulatorModel.test.ts`: project full dialog properties, linked/string
   function refs, canonical maps, constants, and declared MIS variables without
   mutating the source model.
2. **Linear interpreter + assignments** → Jest in
   `tests/simulatorEngine.test.ts`: assert transcript order, assumed-zero state,
   supported numeric operators, unresolved `UnknownValue`, action-budget safety,
   and `StopProcessInfos` termination.
3. **Persistent choices + interactive revisits** → Jest in
   `tests/simulatorChoices.test.ts`: selecting a target that does not clear or
   add choices preserves the menu; clear removes it; clear-then-add replaces it;
   nested choices work; repeatedly revisiting a target remains valid.
4. **Three-valued condition evaluator** → Jest in
   `tests/simulatorConditionEvaluator.test.ts`: cover structured AND/OR truth
   tables, raw structured expressions, generic-expression fallback, malformed
   expressions, mixed operators, negation, and unresolved constants.
5. **Availability** → Jest in `tests/simulatorDialogAvailability.test.ts`:
   cover condition gating, missing-condition unknown, stable `nr` ordering,
   known/non-permanent exclusion, known/permanent inclusion, and recomputation.
6. **Application session** → Jest in `tests/SimulatorSession.test.ts`:
   accept a projected model rather than stores; assert deep snapshot isolation,
   choice/back restoration, entry switching, restart, assumption notes, and zero
   source-model/store mutations.
7. **UI wiring + Playwright** → Write the failing
   `tests/e2e/dialog-simulator.spec.ts` first using the mock API's
   `//__MOCK_MODEL__` seam. Drive launch → persistent menu → choice → Back →
   alternate choice → Restart. Include one unknown condition and one known
   non-permanent entry. Assert rendered DOM/transcript state, not saved bytes.
8. **Full-suite gate** → from the repository root run:

   - `npm test --workspace daedalus-dialog-editor`
   - `npm run lint --workspace daedalus-dialog-editor`
   - `npm run typecheck:renderer --workspace daedalus-dialog-editor`
   - `npm run test:e2e --workspace daedalus-dialog-editor`
   - `npm run build --workspace daedalus-dialog-editor`

## Extension (out of scope for v1, noted for design headroom)

"Simulate this quest path" from the quest graph (feature-suggestions item 1
extension): the domain interpreter is graph-agnostic, so a future adapter can
feed it a quest's ordered dialog entries. Keep the domain free of any
dialog-editor-specific assumptions so this stays a pure application-layer add.

## Risks / gotchas (from codebase survey)

- **Case-insensitivity** everywhere — use the simulator's local canonical
  identifier helper and renderer `questIdentity` utilities, never raw keys or a
  private parser deep import.
- **Choice persistence** — selection does not clear the tray; only an executed
  `Info_ClearChoices` does.
- **Interactive cycles are valid** — guard synchronous action depth, not graph
  revisits after user input.
- **Nested choices** inside `ConditionalAction` — recursive walk, not flat
  filter.
- **`information`/`condition` are `string | DialogFunction`** — normalize with
  `extractFunctionName` / `getDialogProperty`.
- **`DialogLine.id` is the AI_Output voice id** (no separate field); the
  renderer `DialogLineAction` type omits the parser's `listener` field — read
  `speaker` for attribution.
- **No existing runtime interpreter** — this is net-new logic; reuse only the
  static matchers (`analysis.ts`, `guardrails.ts`, `conditionExpressionCodec`)
  and identity helpers, not a pre-built evaluator.
- **`unknown` conditions must be visible**, never silently assumed — this is the
  feature's trust contract.

## Done criteria

- Domain + application + UI landed under the three-layer boundary; the session
  accepts a projected model and has no Zustand dependency.
- Choices persist until `Info_ClearChoices`; interactive graph revisits work.
- Known non-permanent and permanent C_INFO availability follows the specified
  rules, and unsupported conditions/assignments remain visibly `unknown`.
- Back restores one complete deep snapshot without extra transcript mutation.
- Jest unit tests cover projection, interpreter, choices, evaluator, gating,
  and session; Playwright drives branch, Back, alternate choice, and Restart.
- `test` / `lint` / `typecheck:renderer` / `test:e2e` green for the editor.
- On completion, extract the durable design (three-layer boundary, three-valued
  evaluation contract) into `docs/architecture/` and delete this plan file, per
  repo documentation hygiene.
