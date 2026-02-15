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
- Status: `todo`
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
- Status: `todo`
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
- Status: `todo`
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
- Status: `todo`
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
- Status: `todo`
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
- Status: `todo`
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
- Status: `todo`
- Goal: reversible editing workflow.
- Files: command layer + editor store history state
- Deliverables:
  - History stack for quest-graph commands
- Acceptance:
  - Multi-step sessions can undo/redo safely

### QE-08 Guardrails for Real-World Patterns
- Status: `todo`
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
- Status: `todo`
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
- Status: `todo`
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
1. Deliver `QE-01` + `QE-02` + read-only inspector shell from `QE-04`
2. Add first write path: `setMisState` from `QE-03` + diff preview path from `QE-06`

