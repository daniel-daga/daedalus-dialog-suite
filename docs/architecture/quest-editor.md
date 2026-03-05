# Quest Editor Architecture

This document captures the durable architecture decisions for quest editing in this monorepo.

## Domain Model

A quest is represented as linked script concepts, not a single object:

- Topic constants (`TOPIC_*` / `Topic_*`) define player-facing quest names.
- Mission variables (`MIS_*`) track lifecycle state (`LOG_RUNNING`, `LOG_SUCCESS`, `LOG_FAILED`, `LOG_OBSOLETE`).
- Quest actions are inferred from dialog/function bodies (for example `Log_CreateTopic`, `Log_SetTopicStatus`, `B_LogEntry`, `Log_AddEntry`, and `MIS_*` assignments).
- Quest flow conditions include dialog knowledge checks and variable/state conditions (including equality and non-equality forms).

## Internal Boundaries

The quest editor stays inside the monorepo with strict internal layers:

1. `quest-domain` (pure logic)
- Contains graph model transforms, command validation/execution, guardrails, deterministic diff helpers.
- Must not import React/ReactFlow/MUI, renderer hooks, or Electron APIs.

2. `quest-application` (orchestration)
- Contains store adapters, history wiring, apply/cancel orchestration, autosave flow.
- May depend on `quest-domain` and store contracts.
- Must not contain visual node components.

3. `quest-ui` (renderer layer)
- Contains `QuestFlow`, node renderers, inspector forms, local UI interaction state.
- Must call application services/interfaces instead of mutating semantic model directly.

### Repository Conventions

- Domain/application code lives under `daedalus-dialog-editor/src/renderer/quest/domain/*` and `.../quest/application/*`.
- Quest editor UI code stays under `daedalus-dialog-editor/src/renderer/components/QuestEditor/*`.
- Import direction is one-way: UI -> application -> domain.

## Implemented Outcomes (Consolidated)

From completed quest planning tracks, the implemented baseline is:

- Graph model supports linked topic + `MIS_*` state views with typed node/edge semantics.
- Flow readability includes explicit edge labeling and filtering for dense quest graphs.
- Editing is command-based (no direct UI mutation path) with validation feedback.
- Inspector and edge-creation UX support practical in-graph editing flows.
- Undo/redo and guardrail checks are integrated with quest editing operations.
- Corpus-driven improvements include:
  - `Log_AddEntry` parsed as first-class `LogEntry` action.
  - Canonical topic identity handling across `TOPIC_*` / `Topic_*` and case variants.
  - `MIS_*` transition-aware quest lifecycle inference and usage analysis.
  - Requires-link support beyond strict equality checks.

## Maintenance Rule

When a quest-related plan finishes, migrate durable decisions into this architecture document (or another canonical reference) and delete the completed plan file.
