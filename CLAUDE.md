# CLAUDE.md

At the start of every session, read [`docs/BOARD.md`](docs/BOARD.md) — what is in flight, who owns it, and the state of the tree — and then `AGENTS.md` in the repository root, following all instructions there. Also read the relevant workspace-level `AGENTS.md` when working inside `daedalus-dialog-editor/` or `daedalus-parser/`.

**Update the board at the end of a session.** It replaces the long handover prompts: a card is one line and an owner, and nothing goes on it that `git log`, the plan, this file or [`docs/reference/environment-hazards.md`](docs/reference/environment-hazards.md) already holds.

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
├── zenkit-node/              N-API binding around ZenKit (ZenGin worlds) + fidelity harness
├── zen-world/                Pure TS level-editor domain — no React/MUI/Electron/native imports
├── docs/                     Canonical documentation
│   ├── architecture/         Durable design decisions
│   ├── reference/            Behavior references
│   ├── plans/                Active implementation plans only
│   └── refactoring-targets.md  Known god-component and concern-split targets
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

## Agent Shell Conventions

- **One agent, one worktree.** `npm run wt:new -- <name>` gives you
  `.worktrees/<name>` on `agent/<name>`, installed and with the native addons
  copied in (no C++ build). `wt:list` / `wt:rm -- <name>` manage them. Do not
  share the main checkout with another agent — see AGENTS.md, "Worktrees for
  Parallel Agents".
- Prefer `pnpm --filter <package> <script>` (e.g. `pnpm --filter daedalus-dialog-editor test`, `pnpm --filter daedalus-parser build`) run from the repo root over `cd`/`Set-Location` into a workspace directory — it runs the script with the correct working directory without ever leaving the root.
- Minimize directory changes generally: a shell's working directory persists across commands within a session, so change directory once per context switch rather than prepending `cd`/`Set-Location` to every command.

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
| `test/` | 26 test files covering all subsystems |

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
  declarationOrder?: Array<{ type: 'dialog' | 'function' | 'constant' | 'variable' | 'instance'; name: string }>;
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

- **Electron 43** — main process (`src/main/`)
- **React 18 + TypeScript** — renderer process (`src/renderer/`)
- **Vite** — bundler for renderer
- **Zustand + Immer** — state management (`src/renderer/store/`)
- **MUI (Material UI)** — component library and theming
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
| `src/renderer/quest/domain/` | Pure quest logic (analysis, graph inference, condition codec) |
| `src/renderer/problems/domain/` | Pure Problems rules (seven of them) — no React/MUI/Electron imports |
| `src/renderer/simulator/` | Dialog simulator domain and session state |
| `src/renderer/types/questGraph.ts` | Quest graph type definitions |
| `src/main/services/` | Main-process services (File, Parser, Project, Updater, etc.) |
| `src/main/workers/` | Worker threads (`metadata.worker.ts`, `parser.worker.ts`, `zenkit.worker.ts`) |
| `src/renderer/world/` | Three.js projection of a world (`WorldScene`, `VobPicker`, `BvhBuilder`, `cameraNav`) — no React |
| `src/renderer/components/world/` | The World surface (`WorldSurface`, `WorldViewport`), lazily loaded |
| `tests/e2e/` | Playwright browser-harness spec files |

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
| `problemsStore.ts` | Problems panel: rule inputs and the scan they feed |
| `worldStore.ts` | World summary + selection. No `immer`: the summary carries `ArrayBuffer` columns |
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
| `WorldService.ts` | Owns the one stateful `zenkit.worker` holding a ZenGin world |
| `ValidationService.ts` | Dialog/script validation |
| `PathValidationService.ts` | File path validation |
| `serviceRegistry.ts` | Constructs the main-process services (MCP plan's Phase 0) |
| `SaveFileFlow.ts` | The `generator:saveFile` body, lifted out of the IPC handler |
| `LogService.ts` | Main-process logging |
| `SettingsService.ts` | App settings persistence |
| `UpdaterService.ts` | In-app update checking and download |

### Quest Editor Architecture

The quest surface is read-only — list/details/create backed by pure analysis
(see `docs/architecture/quest-editor.md`; the litegraph Flow view was removed):

1. `src/renderer/quest/domain/` — pure logic: analysis, graph inference, condition-expression codec. No React/MUI/Electron imports.
2. `src/renderer/components/QuestEditor.tsx` + `QuestList.tsx` / `QuestDetails.tsx` / `CreateQuestDialog.tsx` — UI.

Import direction is one-way: UI → domain.

### Development Rules

1. **TDD required**: add or update a failing test before implementing. Tests must genuinely exercise the feature — do not write tests that pass trivially or exist only to satisfy coverage. A test that can pass without the feature being correctly implemented is not acceptable.
   - For new or changed **UI workflows** (user-facing flows in the Electron app), write a failing **Playwright E2E test** (`tests/e2e/`) first, then implement.
   - For logic, store, or component-level changes without a new end-to-end flow, a Jest test is sufficient.
   - **Playwright tests must be verified**: after writing and running a Playwright E2E test, manually confirm it exercises the actual UI behavior — not just that it passes. A green Playwright test that doesn't interact with the real feature is not acceptable.
2. Run focused tests during iteration; run full workspace checks before completion.
3. **Performance**: `semanticModel` is large and recreated frequently — do not pass the full object to deeply memoized components; prefer stable sub-properties and granular comparisons with `React.memo`.

### Editor Commands

| Command | Description |
|---|---|
| `npm run dev` | Full dev environment (main + renderer) |
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
| `all-tests.yml` | `zen-world-tests` (jest + typecheck + lint), `editor-tests` (typecheck main + renderer, renderer build warning-guard, Jest, lint), `editor-ui-tests` (browser-harness Playwright, sharded 4×), `editor-ui-merge-reports`, `editor-e2e-electron` (real Electron, xvfb on ubuntu), `parser-tests` (tests + lint + typecheck), `roundtrip-corpus` (fixture corpus via `--root test/fixtures/corpus --strict`, uploads report artifacts) |
| `build-windows.yml` | **`workflow_dispatch` only — a push to master publishes nothing.** Windows Electron build + installer; `build` job needs both the full `all-tests.yml` matrix (via `workflow_call`, job `tests`) and `e2e-electron-windows`; guarded to `refs/heads/master`, so a non-master dispatch skips the build rather than releasing; publishes serialized via `concurrency` group; stale re-runs rejected by comparing `github.sha` to live master head. Two packaged-app smokes gate the artifact: the exe starts, and (via `DDE_SMOKE_OPEN_WORLD`) it opens a committed fixture world through `WorldService` — which is what proves the packaged native addon actually loads, since `npmRebuild: false` |
| `zenkit-node.yml` | The native addon: builds ZenKit + the binding and runs its suite, windows-2022 only. **Not part of `all-tests.yml`, so it does not gate a release**, and path-filtered to `zenkit-node/**` on push/PR to master — a change in `zen-world/` or the editor's `zenkit.worker.ts` that breaks the binding contract never runs it. Has `workflow_dispatch` |
| `deploy-pages.yml` | GitHub Pages deployment; path-filtered to `gh-pages/index.html` |

Notes:
- `all-tests.yml` triggers include `workflow_call` so it can gate releases
- Editor CI typechecks both main process and renderer separately
- Editor CI build is guarded against chunk-size and `eval` warnings
- The real-Electron world-render spec (`tests/e2e-electron/world-render.spec.ts`) needs the dev-build addon, which `zenkit-node`'s install script skips by default in CI: `build-windows.yml`'s `e2e-electron-windows` job sets `ZENKIT_NODE_FORCE_BUILD=1` before install so the spec runs there; the ubuntu `editor-e2e-electron` job does not, so the spec self-skips — that platform doesn't ship, so it is not the gate
- `node tools/check-board.js` (root `npm run board:check`, run in `zen-world-tests`) enforces the board's card-line budget and §16's closed-card flush rule

---

## Code Review Remediation

The code-review remediation effort is complete — all code landed and CI-green. Durable outcomes live in `docs/architecture/` (`parser-fidelity.md`, `save-pipeline.md`, `worker-reliability.md`, `quest-editor.md`, `dialog-editor.md`, `render-performance.md`, `security-model.md`). The historical review findings are in `docs/plans/code-review-findings.md` and the closeout record is `docs/plans/code-review-remediation.md`.

Production-hardening work that only matters at first release (code signing, strict update verifier, release-dispatch QA, manual desktop passes) is parked in `docs/release-checklist.md`.

**Proposed plan:** [`docs/plans/mcp-server.md`](docs/plans/mcp-server.md) — built-in MCP server so AI clients can verify, create, and control dialog/quest content through the editor's validated pipelines. No server code exists; only its Phase 0 prerequisite has landed — main-process service construction is now `src/main/services/serviceRegistry.ts` and the `generator:saveFile` body is `src/main/services/SaveFileFlow.ts`.

**Active plan:** [`docs/plans/level-editor.md`](docs/plans/level-editor.md) — ZenGin level editor as new monorepo subprojects (`zenkit-node` N-API binding + `zen-world` domain + a World surface in the editor), answering [`docs/plans/level-editor-design-brief.md`](docs/plans/level-editor-design-brief.md), with Phase 0 broken down in [`docs/plans/level-editor-phase-0.md`](docs/plans/level-editor-phase-0.md). **Its settled architecture is [`docs/architecture/level-editor.md`](docs/architecture/level-editor.md)** — the UI base decision, the binding, the round-trip strategy, the workspace layout and the process/data-flow architecture (§3–§10, §13); the plan keeps the phasing, the Spacer parity backlog and the open findings (§16). The two files hold disjoint section numbers, so a bare `§7` resolves either way.

Phase 0 (binding + round-trip fidelity gate + the in-engine acceptance pass) is **closed** — record in [`zenkit-node/docs/engine-acceptance-2026-08-25.md`](zenkit-node/docs/engine-acceptance-2026-08-25.md). Phase 1a (read-only world viewer) landed; Phase 1b (VOB editing) is in progress. **Which ops exist and what is in flight is not repeated here** — the board holds what is in flight, the plan holds the op-by-op state and the decisions behind it, including the Spacer parity inventory (§14), the undo bar (§15) and the long form of every open board card (§16 — the board itself carries one line and a pointer per card). Gate 2 passed for the ops it tested (2026-08-27), and **Gate 2b** (2026-08-28/29) served the seven that had landed since. Its first pass established that every op — `DeleteVob` on a subtree, all five waynet ops including a delete that renumbers 2,895 waypoints, `SetVobClassProp`, plus `SetVobProp`'s new keys and `AddVob` authoring 27 classes — produces a world the engine **loads and plays**. Its second pass, `06-minimal-frame`, cleared the spawn's frame and witnessed the writes themselves: red fog from an authored `zCZoneZFog`, a sound carried 3,000 units by a written `radius`, and an authored `oCMobContainer` the player opens. **`SetVobClassProp` has its engine witness.** Its third pass, `07` (2026-08-30), closed the last two rows: the torch subtree wholly gone, NPC routines surviving the renumber. What is still unwitnessed is narrow: the seven decal fields are in no candidate, no enum write has been played, `oCZoneMusic.volume` is dropped by decision, and 5 of the 27 authorable classes have been seen in an engine. Say that, not "everything is verified". Gate 2's checklist is §8 of the acceptance record; Gate 2b's results are its three *"Gate 2b"* sections.

Note for anyone extending the op set: **`assertApplyOpsRequest` is where a new op reaches the world, and it is the one layer every test mocks past** — the renderer suite stubs the IPC, the op suite injects a fake binding, the binding suite calls C++. `ReparentVob` shipped refused there, green everywhere. Add the validator branch and its cases in the same change as the op.

But know what that layer **cannot** check: the main process holds no semantic model of the project. `ProjectIndex` carries npcs, dialogs, routines and voice ids but no instances; `ProjectService.primedModels` is a take-once hand-off cache that deletes as it reads; `ParserService` is stateless. So a validation that needs script symbols — `oCItem.instance` was the first — is a *shape* check in `assertApplyOpsRequest` and an *existence* check in the renderer, which is the only side holding the index. It also cannot be a hard refusal: a world may legitimately be edited with no script project open, so an empty index means "nothing is known", never "nothing is legal".

**Active plan:** [`docs/plans/production-readiness-review-findings.md`](docs/plans/production-readiness-review-findings.md) — production-readiness / performance / UI-UX review, including the decision to deprecate the quest Flow view (Option A and Option B both landed: the litegraph Flow view has been removed; the quest surface is the read-only list/details/create panel). §3 Performance is closed down to P3 (the P0, P1, and P2 items all landed; durable outcomes in `docs/architecture/render-performance.md`), and the §5 post-release fast-follows are all landed too (F2 dead source-view cleanup, F6 Ctrl+F scoping, and a strict `default-src 'self'` CSP — which moved Monaco off the jsdelivr CDN to the app's own origin; see `docs/architecture/security-model.md`). Its §5 tracks what has landed and what remains.

**Active plan:** [`docs/plans/vob-folders.md`](docs/plans/vob-folders.md) — user-created VOB folders in the World scene tree: a virtual, editor-only grouping (never a VOB, never touching the `.zen` file) persisted as a `<worldname>.folders.json` sidecar beside the world file. Landed 2026-08-31 — create/rename/delete a folder, add/remove VOBs via the context menu, a new Folders tab; no nesting, no undo/redo, no drag-and-drop-in by design. Awaiting real-world use before extraction into `docs/architecture/level-editor.md`.

When a plan is complete, extract durable decisions into canonical docs and delete the plan file.

---

## Talking to Daniel

Write replies short and plain. Lead with the answer, then only what changes a
decision. No status theatre, no restating what the diff already says, no
paragraph where a sentence does. Prose, not nested bullet trees. Long form goes
in the plan or the board, which is what they are for — a reply that has to be
skimmed is too long.

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
