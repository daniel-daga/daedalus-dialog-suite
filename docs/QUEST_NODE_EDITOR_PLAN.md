# Quest Node Editor Plan

## Purpose
Track the quest node view cleanup and transition from read-only graph to writable node editor, based on real-world `mdk` quest patterns.

## Corpus Notes (MDK baseline)
- `*.d` files scanned: `1719`
- `Log_CreateTopic` hits: `448`
- `Log_SetTopicStatus` hits: `332`
- `B_LogEntry` / `Log_AddEntry` hits: `993`
- Key implication: quests are not purely linear and often mix `TOPIC_*` log flow with `MIS_*` state flow in the same dialogs/functions.

## Backlog

### QE-01 Graph Domain Model v2
- Status: `done`
- Goal: represent quest data as two linked layers (`TOPIC_*` log layer + `MIS_*` state layer).
- Files:
  - `daedalus-dialog-editor/src/renderer/components/QuestEditor/questGraphUtils.tsx`
  - shared graph type location (`src/renderer/types/...` or existing global types)
- Deliverables:
  - Node kinds: `topic`, `topicStatus`, `misState`, `logEntry`, `dialog`, `condition`
  - Edge kinds: `writes`, `requires`, `transitions`, `references`
  - Provenance metadata: `filePath`, function/dialog name, line hint (if available)
- Acceptance:
  - Existing read-only graph still renders
  - A mixed quest shows both `TOPIC_*` and `MIS_*` relations

### QE-02 Flow Readability Pass
- Status: `done`
- Goal: reduce confusion in node view before write support.
- Files:
  - `daedalus-dialog-editor/src/renderer/components/QuestFlow.tsx`
  - `daedalus-dialog-editor/src/renderer/components/QuestEditor/Nodes/*`
- Deliverables:
  - Swimlane grouping (NPC or source grouping)
  - Explicit edge labels (`sets LOG_RUNNING`, `requires MIS_X == LOG_RUNNING`)
  - Filters: `Only selected quest`, `Hide inferred edges`, `Show conditions`
- Acceptance:
  - Dense quest flows are navigable
  - Direct vs inferred links can be isolated quickly

### QE-03 Graph Command Layer (Write API)
- Status: `done`
- Goal: all edits are commands (no direct UI mutation).
- Files:
  - `daedalus-dialog-editor/src/renderer/components/QuestEditor/commands/*` (new)
  - `daedalus-dialog-editor/src/renderer/store/editorStore.ts`
  - `daedalus-dialog-editor/src/renderer/store/projectStore.ts`
- Deliverables:
  - Commands: `addTopicStatus`, `setMisState`, `addLogEntry`, `connectCondition`, `removeTransition`, `moveNode`
  - Validation responses with actionable errors
- Acceptance:
  - Commands unit-testable without React
  - `QuestFlow` uses command dispatch only

### QE-04 Node Inspector (Editable)
- Status: `done`
- Goal: side panel for node/edge details and edits.
- Files:
  - `daedalus-dialog-editor/src/renderer/components/QuestFlow.tsx`
  - `daedalus-dialog-editor/src/renderer/components/QuestEditor/Inspector/*` (new)
- Deliverables:
  - Edit forms for topic status, MIS state, log entry text, simple MIS condition
  - Read-only badges for unsupported complex expressions
- Acceptance:
  - Edit updates semantic model and graph refreshes
  - Unsupported constructs stay visible with reason

### QE-05 Edge Creation UX
- Status: `done`
- Goal: create/change dependencies directly in graph.
- Files:
  - `daedalus-dialog-editor/src/renderer/components/QuestFlow.tsx`
  - node components under `QuestEditor/Nodes`
- Deliverables:
  - Drag-connect or explicit connect mode
  - Inline validation feedback
- Acceptance:
  - Valid transitions can be authored without source view
  - Invalid edges are blocked with specific messages

### QE-06 Semantic Write-Back + Diff Preview
- Status: `done`
- Goal: safe persistence with source-of-truth in semantic model/codegen.
- Files:
  - `daedalus-dialog-editor/src/renderer/store/editorStore.ts`
  - `daedalus-dialog-editor/src/renderer/store/projectStore.ts`
  - diff preview component (new)
- Deliverables:
  - Graph command -> semantic update -> generated script diff preview -> apply
  - Compatibility with dirty state/autosave
- Acceptance:
  - Deterministic script update output
  - Cancel leaves files unchanged

### QE-07 Undo/Redo for Graph Edits
- Status: `done`
- Goal: reversible editing workflow.
- Files: command layer + editor store history state
- Deliverables:
  - History stack for quest-graph commands
- Acceptance:
  - Multi-step sessions can undo/redo safely

### QE-08 Guardrails for Real-World Patterns
- Status: `done`
- Goal: protect against risky edits seen in corpus.
- Files: validation layer + quest analysis utilities
- Deliverables:
  - Warnings for multi-topic side effects in one function
  - Warnings for shared `MIS_*` dependencies across quests
  - Preserve `LOG_OBSOLETE` / `LOG_FAILED` semantics
- Acceptance:
  - Branch-heavy quest edits are validated
  - Non-happy-path statuses are retained

### QE-09 Test Coverage
- Status: `done`
- Goal: lock behavior while adding writable graph.
- Files:
  - `daedalus-dialog-editor/tests/questGraphUtils*.test.tsx`
  - new command/inspector tests
- Deliverables:
  - Unit tests for command -> semantic transforms
  - Integration tests for inspector and edit flows
  - Regression tests with representative MDK structures
- Acceptance:
  - Existing quest analysis tests remain green
  - New editing pathways are covered

### QE-10 Rollout Flag + Fallback
- Status: `done`
- Goal: safe deployment.
- Files: feature flag location + `daedalus-dialog-editor/src/renderer/components/MainLayout.tsx`
- Deliverables:
  - Writable quest editor flag
  - Fallback to read-only mode
- Acceptance:
  - Writable mode can be disabled quickly without breaking quest view

## Execution Order
1. `QE-01` -> `QE-02` -> `QE-03`
2. `QE-04` -> `QE-05` -> `QE-06`
3. `QE-07` -> `QE-08` -> `QE-09`
4. `QE-10`

## First Implementation Slice
1. Deliver `QE-01` + `QE-02` + read-only inspector shell from `QE-04` ✅
2. Add first write path: `setMisState` from `QE-03` + diff preview path from `QE-06` ✅

## Current Implementation Notes
- `setMisState`, `addTopicStatus`, and `addLogEntry` commands are implemented and unit-tested via `QuestEditor/commands`.
- Command execution now flows through inspector -> command validation -> generated script diff preview -> apply.
- Diff preview/apply pipeline now supports batched file updates (multi-file command apply infrastructure via `applyQuestModelsWithHistory`), while still rendering a single combined preview.
- Diff preview now renders per-file sections for multi-file command updates (in addition to combined preview compatibility path).
- Diff preview now supports blocking guardrail warnings (apply disabled for newly introduced high-risk warning types such as `failure-status-preservation`).
- Guardrail delta analysis now detects regression cases where edits remove existing `LOG_FAILED` / `LOG_OBSOLETE` paths (`failure-status-regression`), and marks these as blocking in diff preview.
- Added branch-heavy MDK-like guardrail regression fixtures (`questGuardrails.regression.test.ts`) to verify mixed-topic side effects, shared MIS dependencies, and non-happy-path regression detection.
- Added branch-heavy MDK-like command regression fixtures (`questCommands.regression.test.ts`) to lock transition/remove/update branch safety and exact-match condition cleanup behavior.
- Added end-to-end quest flow preview regression coverage for blocking guardrail apply-gating when a command introduces `failure-status-regression` (`QuestFlow.commandPreview.test.tsx`).
- Added quest flow regressions for multi-file preview cancel/no-apply, invalid-edge validation messaging, preserved failure-status coverage non-blocking behavior, and deterministic repeated diff-preview output (`QuestFlow.commandPreview.test.tsx`).
- In project mode, command file ownership now resolves deterministically when function names collide across files (prefers active file, otherwise most recently parsed file).
- Cross-file command execution no longer requires both source/target functions to exist in the same single-file semantic snapshot (transition commands validate/mutate source side; requires-link commands validate/mutate target side).
- Cross-file transition creation now performs real multi-file mutation: adds `Choice` on source function and (when source dialog can be resolved) adds `NpcKnowsInfoCondition` requirement on target function via `addKnowsInfoRequirement`.
- Cross-file transition removal now performs symmetric multi-file mutation: removes `Choice` from source function and removes matching `NpcKnowsInfoCondition` from target function via `removeKnowsInfoRequirement`.
- Cross-file transition text updates now also run through multi-file composition: updates `Choice.text` on source and ensures paired target-side `NpcKnowsInfoCondition` exists.
- Quest flow now supports filters for `Only selected quest`, `Hide inferred edges`, and `Show conditions`.
- Inspector supports editable MIS state, topic status, and log entry updates; complex conditions remain read-only.
- Connect mode is available in quest flow; drag-connect creates transition commands with validation and diff preview.
- Transition edges can be removed from the inspector via `removeTransition`.
- Connect mode now supports variable-condition links (`requires`) in addition to transitions.
- Requires edges have inline inspector editing (`updateConditionLink`) and removal (`removeConditionLink`) with diff preview.
- Requires edges that are not simple `VARIABLE == VALUE` expressions now show explicit read-only messaging in inspector (no invalid edit/remove actions).
- Connect mode now has explicit mode selection (`Transition` vs `Condition Link`) before creating edges.
- Transition edges support inline text editing via inspector (`updateTransitionText`) with diff preview.
- `moveNode` is now implemented as a validated graph-layout command with persisted per-quest node position overrides.
- Undo/redo foundation for quest command applies is available in editor store and exposed in quest flow toolbar.
- Undo/redo history now snapshots both semantic model and quest node position overrides; `moveNode` drag operations are undoable/redoable.
- Quest toolbar undo/redo now supports transaction-level batch history, so multi-file quest applies can be reverted/redone as a single operation.
- Quest history stack behavior now has unit test coverage in `editorStore.questHistory.test.ts`.
- Autosave compatibility for quest batch editing is now covered in `autoSave.test.ts` (multi-file `applyQuestModelsWithHistory` and `undoLastQuestBatch` -> autosave of reverted model).
- Writable quest editor can now be toggled off via `VITE_WRITABLE_QUEST_EDITOR` (or `localStorage.feature.writableQuestEditor`) with read-only fallback.
- Quest flow now surfaces guardrail warnings for multi-topic side effects, shared `MIS_*` dependencies, and failure/obsolete status preservation.
- Diff preview now highlights newly introduced guardrail warnings before apply.
- Guardrail warnings now include function/variable provenance and warning-delta detection between pre/post command states.
- Added integration-style UI tests for quest flow read-only/connect-mode behavior and diff preview warning rendering.
- Added dedicated inspector tests for editable vs read-only requires edges (`QuestInspectorPanel.test.tsx`).
