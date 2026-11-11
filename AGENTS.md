# Agent instructions

## Start here

- Read `docs/WORKFLOW.md` and the open GitHub issues before starting; they own
  issue selection, ownership, closeout and session handoff. Only `agent-ready`
  issues may be taken unattended; do not change priority or decision labels.
- Read the workspace's `AGENTS.md` before editing the parser or editor.
  `CLAUDE.md` only imports this file; reusable skills live in `.agents/skills/`.
- Use `docs/README.md` to find architecture and behavior references. Keep active
  plans in `docs/plans/`; extract durable decisions and delete completed plans.
  Do not copy issue status or historical implementation summaries into this file.

## Setup and worktrees

- Use Node 20+ and **pnpm 10** (CI pins 10.23.0). pnpm 11 can reject the frozen
  lockfile's overrides; do not regenerate the lockfile to accommodate it.
- Fresh checkout: `bash scripts/setup.sh`. It installs with `CI=1`, builds the
  parser and `zen-world` via postinstall, and warms Electron's binary cache.
  It deliberately **does not build ZenKit**; world/native tests need that addon.
- One agent per worktree; do not share a checkout with another active agent or
  use `git stash`. `npm run wt:new -- <name>` creates `.worktrees/<name>` on
  `agent/<name>` from `master`, seeds native addons, and installs dependencies.
  `--from <ref>` changes the base; `wt:list` and `wt:rm -- <name>` manage them.
  Seeded binaries are copies, not proof they match your changed source.
- `zenkit-node/vendor/ZenKit` is intentionally patched/dirty. Never stage its
  submodule pointer as routine cleanup; stage named paths or use
  `git add -A -- . ':!zenkit-node/vendor/ZenKit'`.
- Preserve contributor git identity; no model/tool co-author trailers, session
  links or generated-by attribution. Enable the hook with
  `git config core.hooksPath .githooks`. Commit finished work as required by
  `docs/WORKFLOW.md`.

## Package boundaries and build artifacts

- `pnpm-workspace.yaml` includes **four** packages. Root `npm run build` and
  `npm test` use npm's workspace list, which includes **only parser and editor**.
  Prefer `pnpm --filter <package> <script>` from the root.
- `daedalus-parser`: `src/core/parser.js` loads the native Tree-sitter parser;
  semantic visitors build the model; `src/codegen/generator.ts` emits source.
  Use exported package subpaths, not cross-package source imports. Semantic
  exports resolve to `dist/`: rebuild with `pnpm --filter daedalus-parser build:ts`
  after TS edits, before testing editor consumers.
- `zen-world` is the pure TS world-editing domain: no React, MUI, Electron or
  native imports. Consumers read `dist/`, not source. Run
  `pnpm --filter zen-world build` after changes **or merging another worktree**,
  before editor tests/typechecks.
- `zenkit-node` owns the N-API binding and fidelity harness. Its `build` runs
  the ZenKit CMake pre-step followed by `node-gyp rebuild`. The pre-step resets
  vendored sources and reapplies `patches/`: save vendor edits as patches
  **before building**. Never substitute `node-gyp build` for `rebuild`.
- Editor main-process wiring is in `src/main/services/serviceRegistry.ts`;
  saves run through `SaveFileFlow.ts`. Parser workers are forked processes;
  `zenkit.worker.ts` is a **thread**, not native-crash isolation.
- Editor world rendering (`src/renderer/world/`) projects domain state into
  Three.js; UI lives in `components/world/`. Quest, Problems and simulator
  domain logic stays independent of React/UI imports.
- `semanticModel` is large and frequently recreated: pass stable sub-properties
  rather than the whole model into deeply memoized components.
- World ops must also reach `assertApplyOpsRequest` and its validator tests.
  Other test layers mock past this boundary. Script-symbol existence checks
  belong in the renderer's project index; an empty index means unknown, not illegal.

## Focused verification

Behavior changes start with a genuinely failing test. New/changed UI workflows
need a Playwright spec; logic/store/component changes can use Jest. Confirm UI
tests actually interact with the feature, not just the mock's stored state.

Run touched tests plus the affected package's lint and typechecks. Full suites
and parser corpus runs belong in CI, not a local session.

| Scope | Commands from the repository root |
|---|---|
| Editor Jest file | `pnpm --filter daedalus-dialog-editor exec jest --runInBand --runTestsByPath tests/<file>.test.ts` |
| Browser UI spec | `pnpm --filter daedalus-dialog-editor exec playwright test tests/e2e/<file>.spec.ts` |
| Real Electron spec | Build editor first, then `pnpm --filter daedalus-dialog-editor exec playwright test -c playwright.electron.config.ts tests/e2e-electron/<file>.spec.ts` |
| Parser test | `pnpm --filter daedalus-parser build:ts`, then `pnpm --filter daedalus-parser exec node --test test/<file>.test.js` |
| World domain test | `pnpm --filter zen-world exec jest --runInBand --runTestsByPath <test-path>` |
| Native test | With addon built: `pnpm --filter zenkit-node exec node --test test/<file>.test.js` |
| Lint | `pnpm --filter <package> lint` |
| Parser/domain types | `pnpm --filter <package> typecheck` |
| Editor types | `pnpm --filter daedalus-dialog-editor build:main`, `typecheck:renderer`, and `typecheck:tests` (run each separately) |
| Docs hygiene | `npm run docs:check` |

- Grammar changes need `pnpm --filter daedalus-parser build` to regenerate C,
  **and a native binding rebuild** before trusting parser tests; see the
  native-build instructions in `docs/reference/environment-hazards.md`.
- Editor Jest uses the real parser, but mocks the ZenKit worker. A green Jest
  run cannot establish native binding compatibility. `ts-jest` only transpiles;
  `typecheck:tests` is required to catch test type errors.
- `test:e2e` / `playwright.config.ts` runs Chromium against a **mock API**, not
  Electron or real parser/codegen. `playwright.electron.config.ts` is the real
  Electron suite and requires built app artifacts; world specs need the addon.
- Windows Jest crash repros: `test:stable:windows` is the baseline;
  `test:matrix:windows` investigates intermittent `3221226505` exits.
- Read `docs/reference/environment-hazards.md` before native builds, retail-world
  roundtrips, container Electron/WebGL tests, or Windows shell encoding work.
  Synthetic fixture roundtrips prove no regression, not retail-world fidelity;
  ZenKit save-path patches also need the documented retail corpus check.

## CI and releases

- No push or PR automatically starts CI. After pushing, dispatch
  `gh workflow run all-tests.yml --ref <branch>` for the full matrix.
  The nightly workflow may test or release master; a push itself is not a release.
- User-facing changes append `- #123: Short description` to `RELEASE_NOTES.md`;
  never reset it. Release notes are the new lines since the published build.
- `build-windows.yml` releases only master and gates packaging on tests plus
  Windows real-Electron checks. Packaging has `npmRebuild: false`: rebuild native
  artifacts first, and never trust an old ignored `dist/` package.
- Renderer CI rejects chunk-size/eval warnings and bundles containing `mockAPI.ts`.
