# CLAUDE.md

At the start of every session, read `AGENTS.md` in the repository root and follow all instructions there. Also read the relevant workspace-level `AGENTS.md` when working inside `daedalus-dialog-editor/` or `daedalus-parser/`.

---

## Repository Overview

**Daedalus Dialog Suite** is a monorepo for tooling around the Daedalus scripting language used in Gothic 2. It contains:

- `daedalus-parser/` — Tree-sitter parser + semantic model + code generator library
- `daedalus-dialog-editor/` — Electron + React visual editor for dialog/quest content

**Package manager:** pnpm (see `pnpm-workspace.yaml`)

---

## Monorepo Structure

```
daedalus-dialog-suite/
├── daedalus-parser/          Parser and semantic tooling
├── daedalus-dialog-editor/   Electron desktop editor
├── docs/                     Canonical documentation
│   ├── architecture/         Durable design decisions
│   ├── reference/            Behavior references
│   ├── plans/                Active implementation plans only
│   └── refactoring-targets.md  Known god-component and concern-split targets
├── doc/                      Internal artifacts (non-canonical)
├── gh-pages/                 GitHub Pages landing page
├── .github/workflows/        CI pipelines
├── AGENTS.md                 Root agent instructions
└── package.json              Root monorepo scripts
```

---

## Root Commands

| Command | Description |
|---|---|
| `npm run build` | Build all workspaces |
| `npm run test` | Run tests across all workspaces |
| `npm run test:roundtrip-corpus` | Parser corpus roundtrip validation |

---

## Workspace: `daedalus-parser/`

### Purpose

High-performance Tree-sitter parser for the Gothic 2 Daedalus scripting language. Exports a semantic model API and code generator for programmatic creation and transformation of dialog/quest scripts.

### Architecture (staged pipeline)

1. **Tree-sitter parsing** — `grammar.js` defines the grammar; `src/core/parser.js` is the main entry
2. **Semantic visitor passes** — Two-pass model builder in `src/semantic/visitors/`
   - Pass 1 (`declaration-visitor.ts`): create skeleton objects from declarations
   - Pass 2 (`linking-visitor.ts`): link references, resolve symbols, analyze
   - Error pass (`error-visitor.ts`): collect syntax errors
3. **Code generation** — `src/codegen/generator.ts` emits Daedalus source from semantic structures

### Key Source Paths

| Path | Role |
|---|---|
| `grammar.js` | Tree-sitter grammar definition |
| `src/core/parser.js` | Main parser entry point |
| `src/semantic/semantic-model.ts` | Core model classes (`Dialog`, `DialogFunction`, etc.) |
| `src/semantic/semantic-visitor.ts` | Visitor orchestrator |
| `src/semantic/semantic-visitor-index.ts` | Visitor re-exports |
| `src/semantic/semanticModelInterfaces.ts` | Type definitions |
| `src/semantic/dialogActions.ts` | `DialogLine`, `Choice` action types |
| `src/semantic/inventoryActions.ts` | Inventory action types |
| `src/semantic/npcActions.ts` | NPC behavior action types |
| `src/semantic/conditionTypes.ts` | Condition type definitions |
| `src/semantic/cross-references.ts` | Cross-reference resolution helpers |
| `src/semantic/parsers/` | AST extraction helpers |
| `src/semantic/visitors/` | `declaration-visitor.ts`, `linking-visitor.ts`, `error-visitor.ts` |
| `src/codegen/generator.ts` | `SemanticCodeGenerator` class |
| `test/` | 21 test files covering all subsystems |

### Exported Subpaths

- `.` — Main parser (`daedalus-parser`)
- `./types` — TypeScript type declarations only
- `./semantic-visitor` — `SemanticModelBuilderVisitor`
- `./semantic-model` — Model classes and types
- `./semantic-code-generator` — `SemanticCodeGenerator`
- `./bindings/node` — Node native bindings

### SemanticModel Shape

```typescript
interface SemanticModel {
  dialogs: { [name: string]: Dialog };
  functions: { [name: string]: DialogFunction };
  declarationOrder?: Array<{ type: 'dialog' | 'function'; name: string }>;
  constants?: { [name: string]: GlobalConstant };
  variables?: { [name: string]: GlobalVariable };
  instances?: { [name: string]: GlobalInstance };
  items?: { [name: string]: GlobalInstance };
  npcs?: { [name: string]: GlobalInstance };
  animations?: { [name: string]: GlobalInstance };
  errors?: SyntaxError[];
  hasErrors?: boolean;
}
```

### Development Rules

1. **TDD required**: write a failing test first, then implement the minimal fix. Tests must genuinely exercise the feature — do not write tests that pass trivially or exist only to satisfy coverage. A test that can pass without the feature being correctly implemented is not acceptable.
2. Do not use temporary test files; add meaningful tests to `test/*.test.js`.
3. Keep generation logic string-template and semantic-model driven.
4. When `grammar.js` changes: run `npm run build` to regenerate the parser, then `npm test`.
5. Before claiming completion, run:
   ```
   npm test
   npm run lint
   npm run typecheck
   ```

### Parser Commands

| Command | Description |
|---|---|
| `npm run build` | Regenerate Tree-sitter parser from grammar |
| `npm run build:ts` | Compile TypeScript |
| `npm test` | Build + typecheck + run all tests |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check only |
| `npm run parse <file>` | Parse a `.d` file (CLI) |
| `npm run semantic <file>` | Run semantic visitor (CLI) |
| `npm run format <file>` | Generate code from semantic model (CLI) |

### Documentation Hygiene (parser)

- `README.md` — usage and workflows
- `API.md` — API/interface reference
- Active plans live in `../docs/plans/`; extract durable outcomes to canonical docs when complete, then delete the plan file
- Import examples must use package-facing paths (`daedalus-parser`, exported subpaths), not internal source paths

---

## Workspace: `daedalus-dialog-editor/`

### Purpose

Visual desktop editor (Electron + React) for editing, validating, and generating Daedalus dialog and quest content. Consumes `daedalus-parser` as a workspace dependency.

### Stack

- **Electron 29** — main process (`src/main/`)
- **React 18 + TypeScript** — renderer process (`src/renderer/`)
- **Vite** — bundler for renderer
- **Zustand + Immer** — state management (`src/renderer/store/`)
- **MUI (Material UI)** — component library and theming
- **Reactflow** — node graph visualization
- **Monaco Editor** — code editing
- **Playwright** — E2E tests (active in CI, sharded across 4 workers)
- **Jest** — unit/integration tests

### Key Source Paths

| Path | Role |
|---|---|
| `src/shared/types.ts` | Shared types: `DialogMetadata`, `ProjectIndex`, etc. |
| `src/shared/updater-types.ts` | In-app updater type contracts |
| `src/renderer/store/` | Zustand stores (editor, file, history, project, search, UI) |
| `src/renderer/components/` | React UI components |
| `src/renderer/components/hooks/` | Custom hooks for editor logic |
| `src/renderer/components/conditions/` | Condition field components per condition type |
| `src/renderer/components/actionRenderers/` | Per-action-type render components |
| `src/renderer/components/common/` | Shared UI primitives (`VariableAutocomplete`, `autocompletePolicies.ts`, etc.) |
| `src/renderer/components/QuestEditor/` | Quest graph editor (Nodes, Inspector, commands) |
| `src/renderer/quest/domain/` | Pure quest logic (graph model, commands, guardrails) |
| `src/renderer/quest/application/` | Orchestration layer (`QuestEditingService.ts`) |
| `src/renderer/types/questGraph.ts` | Quest graph type definitions |
| `src/main/services/` | Main-process services (File, Parser, Project, Updater, etc.) |
| `src/main/workers/` | Worker threads (`metadata.worker.ts`, `parser.worker.ts`) |
| `tests/e2e/` | 19 Playwright E2E spec files |

### State Management Stores

| Store | Responsibility |
|---|---|
| `editorStore.ts` | Active dialog/function editing state |
| `fileStore.ts` | File I/O and project loading |
| `historyStore.ts` | Undo/redo management |
| `historyActions.ts` | History action creators |
| `projectStore.ts` | Project-level index and metadata |
| `searchStore.ts` | Search state |
| `uiSelectionStore.ts` | UI selection state |
| `storeSync.ts` | Cross-store synchronization |

### Main-Process Services

| Service | Responsibility |
|---|---|
| `FileService.ts` | File read/write, encoding |
| `ParserService.ts` | Daedalus parsing, semantic model |
| `ProjectService.ts` | Project folder loading and indexing |
| `CodeGeneratorService.ts` | Code generation from semantic model |
| `FileWatcherService.ts` | File-change watching (chokidar) |
| `MetadataWorkerPool.ts` | Parallel metadata extraction |
| `ValidationService.ts` | Dialog/script validation |
| `PathValidationService.ts` | File path validation |
| `SettingsService.ts` | App settings persistence |
| `UpdaterService.ts` | In-app update checking and download |

### Quest Editor Architecture

The quest editor follows a strict three-layer boundary (see `docs/architecture/quest-editor.md`):

1. `src/renderer/quest/domain/` — pure logic: graph model transforms, command validation, guardrails. No React/MUI/Electron imports.
2. `src/renderer/quest/application/` — orchestration: store adapters, history wiring, apply/cancel flow.
3. `src/renderer/components/QuestEditor/` — UI: `QuestFlow`, node renderers (`Nodes/`), inspector (`Inspector/`), commands (`commands/`).

Import direction is one-way: UI → application → domain.

### Development Rules

1. **TDD required**: add or update a failing test before implementing. Tests must genuinely exercise the feature — do not write tests that pass trivially or exist only to satisfy coverage. A test that can pass without the feature being correctly implemented is not acceptable.
   - For new or changed **UI workflows** (user-facing flows in the Electron app), write a failing **Playwright E2E test** (`tests/e2e/`) first, then implement.
   - For logic, store, or component-level changes without a new end-to-end flow, a Jest test is sufficient.
   - **Playwright tests must be verified**: after writing and running a Playwright E2E test, manually confirm it exercises the actual UI behavior — not just that it passes. A green Playwright test that doesn't interact with the real feature is not acceptable.
2. Run focused tests during iteration; run full workspace checks before completion.
3. When changing node editor UI, do a smoke pass:
   - Start with `npm run dev:node-editor`
   - Open `http://localhost:5173/node-editor.html`
   - Confirm key controls render (e.g. `data-testid="node-editor-quest-select"`)
4. **Performance**: `semanticModel` is large and recreated frequently — do not pass the full object to deeply memoized components; prefer stable sub-properties and granular comparisons with `React.memo`.

### Editor Commands

| Command | Description |
|---|---|
| `npm run dev` | Full dev environment (main + renderer) |
| `npm run dev:node-editor` | Node editor playground (Vite only) |
| `npm run build` | Compile main + renderer |
| `npm run build:main` | Compile main process only |
| `npm run typecheck:renderer` | TypeScript check renderer only |
| `npm test` | Jest unit/integration tests |
| `npm run test:mocked` | Jest with mocks |
| `npm run test:stable:windows` | Recommended local Windows baseline |
| `npm run test:matrix:windows` | Repro matrix for intermittent `3221226505` exits |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run test:e2e:ui` | Playwright with interactive UI |
| `npm run package` | Electron builder packaging |
| `npm run start` | Run Electron app |

### Documentation Hygiene (editor)

- Architecture and design decisions → `../docs/architecture/`
- Behavior references → `../docs/reference/`
- Active plans only → `../docs/plans/`
- When a plan is complete: extract durable decisions into canonical docs, delete the plan file
- When changing commands, workflows, or constraints, update the relevant docs in the same change

---

## CI Pipelines

| Workflow | Jobs |
|---|---|
| `all-tests.yml` | `editor-tests` (typecheck + Jest + renderer build), `editor-e2e-tests` (Playwright, sharded 4×), `editor-e2e-merge-reports`, `parser-tests` (tests + lint + typecheck) |
| `build-windows.yml` | Windows Electron build + installer |
| `deploy-pages.yml` | GitHub Pages deployment |

Notes:
- `editor-e2e-tests` runs in CI as 4 parallel shards; blob reports are merged into a single HTML artifact
- `roundtrip-corpus` job is disabled (`if: false`) in CI
- Editor CI typechecks both main process and renderer separately
- Editor CI build is guarded against chunk-size and `eval` warnings (litegraph.js eval is whitelisted)

---

## Active Plans (`docs/plans/`)

| Plan | Scope | Status |
|---|---|---|
| `daedalus-parser-stabilization.md` | Parser API alignment, lint recovery, CLI reliability, doc sync | In progress |
| `dialog-or-conditions.md` | OR-grouped conditions in parser + editor + quest graph | Draft |
| `in-app-updater.md` | Custom lightweight updater via GitHub Releases API | In progress |
| `parser-roundtrip-scope-f4-f5-f6.md` | Model local var declarations, function parameters, and global emission (review findings F4–F6) | Draft |
| `playwright-e2e-tests.md` | Gap analysis and coverage expansion for E2E tests | Draft |

When a plan is complete, extract durable decisions into canonical docs and delete the plan file.

---

## General Conventions

- **TDD everywhere**: failing test → minimal implementation → green. Tests must genuinely exercise the feature — a test that passes without the feature being correctly implemented is not acceptable. For Playwright E2E tests, manually verify the test interacts with the real UI behavior, not just that it passes.
- **A feature is not done until tests and linter pass**: after implementing any feature, run the full test suite and linter for the affected workspace. A clean codebase (`npm test` + `npm run lint`) is a prerequisite for declaring the feature complete — not an optional follow-up.
- Keep changes focused and minimal; no unnecessary docs, scaffolding, or helper abstractions.
- Do not add error handling for scenarios that cannot happen; trust framework guarantees.
- Validate at system boundaries only (user input, external APIs).
- Do not create new files unless strictly required; prefer editing existing ones.
- After any change, verify with workspace-level commands (`npm test`, `npm run lint`, `npm run typecheck`) before claiming completion.
- Active implementation plans belong in `docs/plans/`; completed plans are deleted after extracting durable outcomes.
- Known god-component and concern-split refactoring targets are tracked in `docs/refactoring-targets.md`.

---

## Sandbox Notes

In Codex sandbox environments, `npm run build --workspace daedalus-dialog-editor` may fail during Vite startup with `Error: spawn EPERM` (from `esbuild` process spawn). Rerun with elevated permissions; the build succeeds outside the sandbox.

---

## Behavioral Guidelines (Karpathy)

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
