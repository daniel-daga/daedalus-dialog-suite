# Dialog Playthrough Simulator — Implementation Plan

Status: **active plan**. Implements P1 item 1 from [`docs/feature-suggestions.md`](../feature-suggestions.md).

## Goal

An in-editor "play this conversation" mode. From a selected dialog, the writer
steps through its info function: lines render by speaker, choices appear as
clickable options, `Info_AddChoice`/`Info_ClearChoices` are followed into
sub-functions, and a scratch state of `MIS_*` variables and known infos is
tracked so C_INFO conditions evaluate live. The writer can branch, back up,
and reset — all without starting Gothic 2.

Everything the simulator needs is already in the semantic model
(`DialogLine`, `Choice`, `ClearChoicesAction`, `ConditionalAction`,
`SetVariableAction`, condition types, the `functions` map). This is
**renderer-only, non-mutating** work — no engine integration, no writes to the
model or disk.

## Non-goals

- No engine-accurate simulation. We evaluate the subset of conditions/actions
  the model represents structurally; anything we can't evaluate is shown as an
  explicit "unknown / assumed" state, never silently guessed.
- No mutation of the dialog, semantic model, project, or files. The simulator
  reads the model and keeps its own scratch state. (No undo/redo wiring.)
- No voice playback / WAV lookup (that is P1 item 3).
- No new parser work. If a needed shape is missing we surface it as an
  unsupported node, not a parser change.

## Architecture

Mirror the quest editor's strict three-layer boundary
(`docs/architecture/quest-editor.md`); import direction is one-way
UI → application → domain.

1. **`src/renderer/simulator/domain/`** — pure logic, no React/MUI/Electron.
   The interpreter, its state machine, and the condition evaluator live here.
   Fully Jest-testable in isolation. This is the bulk of the feature.
2. **`src/renderer/simulator/application/`** — a thin `SimulatorSession`
   orchestrator that pulls the live `SemanticModel` for the selected NPC from
   the stores (`useFileStore` in single-file mode, `useProjectStore`
   `mergedSemanticModel` in project mode) and adapts it into the read-only
   inputs the domain needs. No store writes.
3. **`src/renderer/components/Simulator/`** — the UI: a launcher and a
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
interface SimulatorModel {
  functions: { [name: string]: DialogFunction };   // for resolving targets
  dialogsByEntry: DialogMetadata[];                 // C_INFO gate candidates
  variables: { [name: string]: GlobalVariable };    // MIS_* declarations/defaults
  // constants map optional — for resolving symbolic condition RHS values
}
```

Resolution is **case-insensitive** throughout (Daedalus is). Reuse
`daedalus-parser` `name-utils` (`resolveCaseInsensitive`, `namesEqual`) and the
renderer `questIdentity` helpers (`getQuestMisVariableName`,
`isCaseInsensitiveMatch`, `getCanonicalQuestKey`). Never key a plain JS object
by a raw identifier without normalizing.

### Scratch state

```
interface SimState {
  misVars: Map<string, number>;      // canonicalized MIS_ name -> value
  knownInfos: Set<string>;           // canonicalized dialogRefs the player "knows"
  transcript: TranscriptEntry[];     // rendered lines + chosen options, in order
  pendingChoices: SimChoice[];       // current Info_AddChoice set (order preserved)
  status: 'running' | 'awaiting-choice' | 'ended';
  callStack: string[];               // for cycle detection across sub-functions
}
```

`misVars` seed from `variables` defaults where available, else treated as `0`
(shown as "assumed 0" in the inspector). `knownInfos` starts empty; a dialog's
info is marked known when its info function runs to completion (models
`Npc_KnowsInfo` becoming true), matching the analysis pattern in
`quest/domain/analysis.ts`.

### Stepping semantics — an interpreter over `DialogAction[]`

Execute a function's `actions` sequentially. Per action `type`:

| Action | Effect |
|---|---|
| `DialogLine` | push a transcript line: `{ speaker, text, id }`. `speaker` is `'self'`/`'other'`; render as NPC vs. hero. |
| `Choice` (`Info_AddChoice`) | append to `pendingChoices` (`{ text, targetFunction, dialogRef }`). |
| `ClearChoicesAction` (`Info_ClearChoices`) | clear `pendingChoices`. |
| `ConditionalAction` | evaluate `.condition` (raw string, see evaluator); recurse into `thenActions` or `elseActions`. |
| `SetVariableAction` | if `MIS_*`, update `misVars` (respect `operator`); reference `quest/domain/commands/setMisState.ts` semantics. |
| `StopProcessInfosAction` (`AI_StopProcessInfos`) | set `status='ended'`. |
| others (topic/log/inventory/npc actions) | record as a neutral "side-effect" transcript note where useful; no state change. Never crash on an unmodeled action. |

When execution reaches the end of a function with `pendingChoices` non-empty,
`status='awaiting-choice'` and the UI renders the buttons. Selecting a choice
pushes the chosen text to the transcript, clears `pendingChoices` **unless the
sub-function re-adds** (real `Info_AddChoice` semantics: choices persist until
`Info_ClearChoices`), and runs `functions[choice.targetFunction]`.

**Choices nested in `ConditionalAction` branches must be reached** — do not
flat-filter for top-level `Choice` only (the bug latent in
`useFunctionTreeBuilder`'s flat filter). Walk actions recursively; reuse the
`forEachChoice` traversal in `daedalus-parser` `cross-references.ts` as the
reference for descent into `then/elseActions`.

**Cycle safety**: guard `callStack` so a choice graph that loops back
(`cross-references.ts` `collectReachableFunctions` is cycle-guarded — mirror it)
cannot infinite-loop the interpreter.

### Entry-point selection — which dialogs are "available"

Before the writer picks a starting line, the simulator lists the NPC's dialogs
whose C_INFO **condition function passes** against current scratch state,
ordered by `nr` (like the game's info list). The lightweight `ProjectIndex` /
`DialogMetadata` is **insufficient** — it carries only `{dialogName, npc,
filePath}`. The simulator must read the full parsed `SemanticModel`
(`dialogs[name].properties` → `condition`, `information`, `nr`, `important`,
`permanent`) via `useProjectStore.mergedSemanticModel` (project mode) or the
open `FileState.semanticModel` (single-file mode). Normalize
`information`/`condition` with `extractFunctionName` — they may be a string or a
live `DialogFunction`.

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
   (`parseConditionExpressionToConditions`), then evaluate the parsed clauses
   with the same evaluator.

Evaluation is **three-valued**: `true | false | unknown`. `unknown` clauses do
not silently pass or fail — the UI shows the branch as "condition unknown
(assumed true)" with the assumption configurable, so the writer always knows
when they've left modeled territory. This is the core trust property.

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
- **Controls**: Restart, Back one step (pop transcript + restore prior
  `SimState` snapshot — keep a snapshot stack in the session), and the
  available-dialogs picker for choosing a different entry info.
- `data-testid`s on launch, each choice button, transcript lines, and the
  restart control so Playwright can drive the real flow.

## Implementation slices (TDD, each independently green)

Each slice: failing test first → minimal implementation → `npm test` +
`npm run lint` + `npm run typecheck:renderer` green for
`daedalus-dialog-editor`.

1. **Interpreter core over a linear function** → Jest: given a function with
   `DialogLine`s + `SetVariableAction` + `StopProcessInfos`, assert transcript
   order, `misVars`, and `ended`. Verify: `simulatorEngine.test.ts` passes.
2. **Choices + sub-function traversal + ClearChoices** → Jest: `Info_AddChoice`
   into a target function, choosing advances, `Info_ClearChoices` clears;
   include a choice nested in a `ConditionalAction`. Verify: choice-graph test
   passes, incl. cycle guard.
3. **Condition evaluator (structured + raw-string)** → Jest against the
   three-valued table above, including an `unknown` case. Verify:
   `conditionEvaluator.test.ts` passes.
4. **Entry-point gating & ordering** → Jest: from a small multi-dialog model,
   assert the available list respects C_INFO conditions + `nr` order and updates
   as `knownInfos`/`misVars` change. Verify: gating test passes.
5. **Application session adapter** → Jest: `SimulatorSession` reads a mock
   store model and exposes domain inputs without mutating it. Verify: session
   test passes; assert no store setters called.
6. **UI wiring + Playwright** → Per editor TDD rule, write the failing
   **Playwright E2E** first (`tests/e2e/dialog-simulator.spec.ts`) against the
   mock-API browser harness with a fixture dialog that has a branch: launch,
   read the first line, click a choice, assert the branched line appears, reset.
   Then implement `SimulatorDialog` + launcher. **Manually confirm** the spec
   drives the real UI (harness note: mock codegen round-trips only properties +
   AI_Output lines, so assert on rendered transcript/DOM, not saved bytes).
7. **Full-suite gate** → `pnpm --filter daedalus-dialog-editor test`, `lint`,
   `typecheck:renderer`, and `test:e2e` green.

## Extension (out of scope for v1, noted for design headroom)

"Simulate this quest path" from the quest graph (feature-suggestions item 1
extension): the domain interpreter is graph-agnostic, so a future adapter can
feed it a quest's ordered dialog entries. Keep the domain free of any
dialog-editor-specific assumptions so this stays a pure application-layer add.

## Risks / gotchas (from codebase survey)

- **Case-insensitivity** everywhere — use `name-utils` / `questIdentity`, never
  raw object keys.
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

- Domain + application + UI landed under the three-layer boundary.
- Jest unit tests for interpreter, evaluator, gating, session; one verified
  Playwright E2E driving the real branch-and-choose flow.
- `test` / `lint` / `typecheck:renderer` / `test:e2e` green for the editor.
- On completion, extract the durable design (three-layer boundary, three-valued
  evaluation contract) into `docs/architecture/` and delete this plan file, per
  repo documentation hygiene.
