# Quest Editor Architecture

This document captures the durable architecture decisions for quest editing in this monorepo.

## Scope

The quest surface is **read-only**: a quest list, a details panel, and a
create-quest dialog (`components/QuestEditor.tsx`, `QuestList.tsx`,
`QuestDetails.tsx`, `CreateQuestDialog.tsx`), backed by pure analysis and graph
inference in `quest/domain/`.

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
  asserts the command write path stays removed.

2. Quest UI (`components/QuestEditor.tsx`, `QuestList.tsx`, `QuestDetails.tsx`,
   `CreateQuestDialog.tsx`)
- Reads via `quest/domain` and the project store; performs no quest-model
  mutation beyond `projectStore.createQuest`.

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
