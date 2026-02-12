# Editor Component Code Review

Scope reviewed:
- `daedalus-dialog-editor/src/renderer/components/EditorPane.tsx`
- `daedalus-dialog-editor/src/renderer/components/DialogDetailsEditor.tsx`
- `daedalus-dialog-editor/src/renderer/components/hooks/useDialogEditorCommands.ts`
- `daedalus-dialog-editor/src/renderer/components/actionRenderers/index.tsx`

Focus areas:
- Code smells
- Maintainability
- Duplication

## Executive summary

The dialog editor architecture is in a **better state** than before: responsibility boundaries are now clearer (`DialogDetailsEditor` composes specialized hooks/sections rather than doing everything inline). The highest remaining maintainability risk is concentrated in small but central integration points (renderer registry typing, update command coupling to store internals, and repeated ad-hoc UI metadata).

## Findings

### 1) `EditorPane` had duplicated fallback shells and tab-height magic values (Low) ✅ Addressed

**Issue:** Early-return branches repeated near-identical container/layout wrappers and hardcoded tab height values.

**Impact:** Style drift risk and extra maintenance cost for simple UX/layout changes.

**Status:** Refactored to shared shell renderer and named constants.

---

### 2) Renderer registry still relies on `any` for key integration functions (Medium)

**Evidence:**
- `getRendererForAction(action: any)`
- `getActionTypeLabel(action: any)`

**Why this matters:**
These are central integration points used by action rendering. `any` weakens compiler guarantees and makes renderer breakages easier to miss during refactors.

**Recommendation:**
Introduce a strict action union (or a shared `UnknownDialogAction`) and replace `any` signatures in the registry.

---

### 3) Store-coupled command hook mixes command orchestration and state access strategy (Medium)

**Evidence:**
`useDialogEditorCommands` accepts store actions but also reaches into store state (`getFileState`) and model-level mutation (`updateModel`) for specific flows.

**Why this matters:**
The hook is mostly clean, but blending command orchestration with state retrieval policy can make testing/state-timing behavior harder to reason about over time.

**Recommendation:**
Expose explicit store commands for these complex mutations (`renameFunction`, `updateConditionFunction`, etc.) so the hook remains a pure command wiring layer.

---

### 4) Action insertion UX metadata is partially centralized (Low)

**Evidence:**
`DialogActionsSection` centralizes "extra" actions in `EXTRA_ACTION_ITEMS`, but primary actions (`Add Line`, `Add Choice`) remain inline.

**Why this matters:**
The split isn't severe, but a single source-of-truth for action menu/button metadata would further reduce UI drift and simplify extension.

**Recommendation:**
Move primary and overflow actions into one typed configuration with optional `variant`/`priority` fields and render from that config.

## Positive patterns worth preserving

- `DialogDetailsEditor` now delegates behavior to focused hooks (`useDialogEditorCommands`, `useActionManagement`, `useDialogEditorUIState`, `useFocusNavigation`).
- Section-level composition (`DialogPropertiesSection`, `ConditionSection`, `DialogActionsSection`) keeps main editor JSX readable.
- The action overflow menu already uses data-driven rendering via `EXTRA_ACTION_ITEMS`.

## Suggested next refactors (incremental)

1. Remove remaining `any` in action renderer registry APIs.
2. Move rename/condition/property complex mutations behind explicit store command methods.
3. Unify primary + extra action-add UI into one typed action command config.
