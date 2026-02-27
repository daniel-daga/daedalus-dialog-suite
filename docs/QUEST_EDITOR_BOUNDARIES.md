# Quest Editor Internal Boundary Plan (Monorepo)

## Decision

Keep the node-based quest editor in the current monorepo and enforce stronger internal module boundaries instead of splitting to a new repository.

## Goals

1. Preserve fast iteration between parser/editor/graph UX.
2. Reduce coupling between quest domain logic and React/Electron UI code.
3. Make future extraction possible with low migration cost.

## Target module boundaries

### 1) `quest-domain` (pure logic, no UI)

**Contains:**
- quest graph model building and transforms
- command validation/execution
- guardrail checks
- deterministic diff-generation helpers (data-level)

**Must not import:**
- React / ReactFlow / MUI
- renderer store hooks
- Electron APIs

### 2) `quest-application` (state orchestration)

**Contains:**
- editor store integration adapters
- transaction history wiring (undo/redo)
- autosave and apply/cancel orchestration

**May import:**
- `quest-domain`
- project/editor store contracts

**Must not import:**
- visual node components

### 3) `quest-ui` (renderer view layer)

**Contains:**
- `QuestFlow` and node components
- inspector forms and local UI behavior
- feature-flag driven UX toggles

**May import:**
- `quest-application` interfaces only

**Must not contain:**
- direct semantic model mutations
- core validation/business rules

## Repo-local implementation conventions

1. Place domain/application code under:
   - `daedalus-dialog-editor/src/renderer/quest/domain/*`
   - `daedalus-dialog-editor/src/renderer/quest/application/*`
2. Keep UI-specific code under:
   - `daedalus-dialog-editor/src/renderer/components/QuestEditor/*`
3. Restrict imports by convention:
   - `components/QuestEditor/*` can depend on `quest/application`.
   - `quest/domain/*` cannot depend on `components/*`.
4. Add barrel exports per layer to keep import surfaces intentional.

## Near-term migration slices

### Slice A: Stabilize domain entry points
- Move command types + validators into `quest/domain/commands/*`.
- Move guardrail analysis into `quest/domain/guardrails/*`.
- Keep behavior unchanged; verify with existing quest command/guardrail tests.

### Slice B: Introduce application service facade
- Add `QuestEditingService` in `quest/application` for:
  - `runCommand`
  - `previewChanges`
  - `applyPreview`
  - `undo` / `redo`
- Convert `QuestFlow` to call service methods instead of touching stores directly.

### Slice C: Tighten dependency checks
- Add lint/import rules (or CI grep checks) blocking forbidden cross-layer imports.
- Enforce all new quest edits through the command pipeline.

## Exit criteria

This boundary hardening is complete when:

1. Quest business rules are testable without rendering React components.
2. `QuestFlow` has no direct semantic mutation logic.
3. Import restrictions prevent UI->domain circular coupling.
4. Extracting `quest-domain` to a package is mostly path rewrites and build config.

