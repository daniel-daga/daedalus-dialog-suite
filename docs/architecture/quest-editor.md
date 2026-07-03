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

### Physical Layout

The pure quest logic physically lives under `quest/domain/*`:

- `graph.ts` — `buildQuestGraph` pipeline entry; stages live in
  `questNodeIdentification.ts`, `questEdgeBuilding.ts`, `questLayout.ts`, with
  `questGraphSharedHelpers.ts`, `questGraphInternalTypes.ts`, and
  `questGraphConstants.ts` as shared internals.
- `commands/` — command types, per-command executors, and the condition
  expression codec.
- `analysis.ts` / `guardrails.ts` — quest analysis and guardrail checks.
- `quest/application/QuestEditingService.ts` is a thin wrapper over the domain
  command executor.

The graph node/edge types in `types/questGraph.ts` are editor-owned and carry
no rendering-library dependency (`reactflow` was removed entirely). The domain
imports only model types (`types/global`, `types/questGraph`), `dagre`, and the
pure `components/actionTypes` module. The boundary is enforced by
`tests/questDomainBoundary.test.ts`, which fails on any UI-library or
`components/QuestEditor` import from the domain.

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

## Canvas Interaction Contract (litegraph 0.7.18)

The quest graph renders on a vendored, pinned litegraph.js 0.7.18 canvas
(`components/QuestEditor/QuestLiteGraphCanvas.tsx`). These behavior contracts hold
and are covered by Playwright specs (`tests/e2e/quest-editor-canvas.spec.ts`); a
litegraph upgrade must re-verify them.

- **Mount-once canvas lifecycle.** Exactly one `LGraph`/`LGraphCanvas` is created per
  mounted `<canvas>`: the init effect keeps deps `[]`. Callback props flow through a
  `callbacksRef` kept current by a tiny effect, so prop churn (new `semanticModel`,
  edits, ingestion) never tears down or recreates the canvas — pan/zoom (`ds`) and
  selection survive model rebuilds automatically. Teardown calls `stopRendering()` then
  `setCanvas(null)` (removes the `document keyup` + canvas listeners; the move/up
  listeners survive litegraph's 0.7.18 `unbindEvents` bug but die with the discarded
  canvas element). `graph.start()` is never called — rendering is driven by
  `startRendering()`; the exec loop is unused. Reactive deps must never be re-added to
  the init effect.
- **Link-click selection.** Edge selection uses litegraph's own left-mousedown link hit
  test, which invokes the instance-overridable `showLinkMenu(link)` — overridden to fire
  the edge-selection callback and `return false`, suppressing the stock "Add Node /
  Delete" context menu (whose Delete would desync runtime graph from the semantic
  model). An enlarged 12 px squared-distance hit test in the `onMouse` handler scans
  `graphCanvas.visible_links` (each link's center is `link._pos`, populated only for
  links drawn in the viewport) so edges are a usable primary target. `allow_searchbox`
  is `false`, so double-clicking empty canvas never opens litegraph's node search box.
  These rely on vendored 0.7.18 internals: `visible_links`, `link._pos`, `showLinkMenu`.
- **IF-chip selection + inspector editing.** Dialog nodes paint an inline "IF" condition
  panel. Clicking it selects the node via a per-node `onMouseDown` hit test against the
  panel rect; the actual condition-expression editing happens in the inspector (real
  DOM), which is the single editing surface for every quest edit. Node `size` must be
  assigned **after** all `addInput`/`addOutput` calls — those each run
  `setSize(computeSize())` and would otherwise shrink the node so the painted panel juts
  below the body and becomes unclickable.
- **Apply-time guardrail gate.** All quest edits commit through
  `QuestEditingService.applyQuestUpdates`, which recomputes guardrail delta warnings
  against the **current** fileStore model (closing the preview→apply TOCTOU) and refuses
  the whole batch if any warning is blocking. The diff dialog's disabled Apply button is
  UX only; `applyQuestModelsWithHistory` is the raw, validation-free primitive and quest
  UI must never call it directly.
- **Domain copy-on-write.** Command executors mutate through
  `withUpdatedFunction(model, name, update)` (shallow-copy model + `functions`,
  deep-clone only the target function). Untouched subtrees stay reference-shared with the
  input model, keeping history snapshot memory proportional to one function per edit, not
  the whole model. `moveNode` performs no clone (its result model is discarded).
- **Batch-undo identity guard (interim).** Quest batch history records the exact snapshot
  identity pushed per file; `undo/redoLastQuestBatch` refuse as a whole if any file's
  top-of-stack is not that snapshot (an interleaved dialog edit landed on top), surfacing
  an explanatory message instead of reverting the wrong edit. This is a fail-safe guard;
  slice 5 replaces it with a unified per-file timeline.

### Test-only surfaces (dev/test builds only)

- `window.__questGraphDebug` — exposed by the canvas when
  `window.__questGraphDebugEnabled` is set (the Vite entries set it from
  `import.meta.env.DEV || MODE==='test'`; absent in production `vite build`). Returns
  CSS-pixel page coordinates (viewport-relative, matching Playwright's mouse space)
  computed from `ds` + the canvas bounding rect, plus node/edge maps, viewport, a
  `fitAll()` helper, and render/build counters (the render counter is flat when idle,
  which is how the no-render-storm assertion is made).
- `window.__questApplyDiff` — the real QuestFlow apply handler, exposed under the same
  gate so E2E can exercise the apply-time guardrail refusal without fighting React's
  disabled-button event filtering.
- Mock harness model seam: `mockAPI.parseSource` returns a hand-authored `SemanticModel`
  when a seeded file begins a line with `//__MOCK_MODEL__<json>` (the regex mock parser
  cannot synthesise quest data); files carrying a `TOPIC_*` constant are reported as
  `questFiles` so `loadQuestData` merges them for the quest list.

## Maintenance Rule

When a quest-related plan finishes, migrate durable decisions into this architecture document (or another canonical reference) and delete the completed plan file.
