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
│   └── plans/                Active implementation plans only
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
| `src/semantic/semanticModelInterfaces.ts` | Type definitions |
| `src/semantic/dialogActions.ts` | `DialogLine`, `Choice` action types |
| `src/semantic/inventoryActions.ts` | Inventory action types |
| `src/semantic/npcActions.ts` | NPC behavior action types |
| `src/semantic/conditionTypes.ts` | Condition type definitions |
| `src/semantic/parsers/` | AST extraction helpers |
| `src/codegen/generator.ts` | `SemanticCodeGenerator` class |
| `test/` | 21 test files covering all subsystems |

### Exported Subpaths

- `.` — Main parser (`daedalus-parser`)
- `./semantic-visitor` — `SemanticModelBuilderVisitor`
- `./semantic-model` — Model classes and types
- `./semantic-code-generator` — `SemanticCodeGenerator`
- `./bindings/node` — Node native bindings

### SemanticModel Shape

```typescript
interface SemanticModel {
  dialogs: { [name: string]: Dialog };
  functions: { [name: string]: DialogFunction };
  declarationOrder?: Declaration[];
  constants?: { [name: string]: GlobalConstant };
  variables?: { [name: string]: GlobalVariable };
  instances?: { [name: string]: GlobalInstance };
  items?: { [name: string]: any };
  hasErrors?: boolean;
  errors?: SyntaxError[];
}
```

### Development Rules

1. **TDD required**: write a failing test first, then implement the minimal fix.
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
- **Playwright** — E2E tests (currently disabled in CI)
- **Jest** — unit/integration tests

### Key Source Paths

| Path | Role |
|---|---|
| `src/shared/types.ts` | Shared types: `DialogMetadata`, `ProjectIndex`, etc. |
| `src/renderer/store/` | Zustand stores (editor, file, history, project, search, UI) |
| `src/renderer/components/` | React UI components |
| `src/renderer/components/hooks/` | Custom hooks for editor logic |
| `src/renderer/components/conditions/` | Condition field components per condition type |
| `src/renderer/components/QuestEditor/` | Quest graph editor (Nodes, Inspector, commands) |
| `src/quest/domain/` | Pure quest logic |
| `src/quest/application/` | Orchestration layer |

### State Management Stores

| Store | Responsibility |
|---|---|
| `editorStore.ts` | Active dialog/function editing state |
| `fileStore.ts` | File I/O and project loading |
| `historyStore.ts` | Undo/redo management |
| `projectStore.ts` | Project-level index and metadata |
| `searchStore.ts` | Search state |
| `uiSelectionStore.ts` | UI selection state |
| `storeSync.ts` | Cross-store synchronization |

### Development Rules

1. **TDD required**: add or update a failing test before implementing.
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
| `npm test` | Jest unit/integration tests |
| `npm run test:mocked` | Jest with mocks |
| `npm run test:stable:windows` | Recommended local Windows baseline |
| `npm run test:matrix:windows` | Repro matrix for intermittent `3221226505` exits |
| `npm run test:e2e` | Playwright E2E tests |
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
| `all-tests.yml` | `editor-tests` (typecheck + Jest), `parser-tests` (tests + lint + typecheck) |
| `build-windows.yml` | Windows Electron build + installer |
| `deploy-pages.yml` | GitHub Pages deployment |

Notes:
- `editor-e2e-tests` and `roundtrip-corpus` jobs are currently disabled (`if: false`) in CI
- Editor CI typechecks both main process and renderer separately
- Editor CI build is guarded against chunk-size and `eval` warnings

---

## General Conventions

- **TDD everywhere**: failing test → minimal implementation → green.
- Keep changes focused and minimal; no unnecessary docs, scaffolding, or helper abstractions.
- Do not add error handling for scenarios that cannot happen; trust framework guarantees.
- Validate at system boundaries only (user input, external APIs).
- Do not create new files unless strictly required; prefer editing existing ones.
- After any change, verify with workspace-level commands (`npm test`, `npm run lint`, `npm run typecheck`) before claiming completion.
- Active implementation plans belong in `docs/plans/`; completed plans are deleted after extracting durable outcomes.

---

## Sandbox Notes

In Codex sandbox environments, `npm run build --workspace daedalus-dialog-editor` may fail during Vite startup with `Error: spawn EPERM` (from `esbuild` process spawn). Rerun with elevated permissions; the build succeeds outside the sandbox.
