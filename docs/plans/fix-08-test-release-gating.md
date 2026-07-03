# Fix Plan 08 — Test Truthfulness & Release Gating

Source: [`code-review-findings.md`](./code-review-findings.md) §8 (QA infrastructure) + S5 (release gating / crash logging half).
Scope: `daedalus-dialog-editor` test harnesses (`playwright.config.ts`, `tests/e2e/`, `jest.config.js`), `.github/workflows/all-tests.yml` + `build-windows.yml`, `src/main/main.ts` + a new logging service, editor ESLint bootstrap, CI wiring for the fix-01 fidelity corpus.
Status: plan only — no implementation in this pass.

Interlocking plans: [fix-01-parser-fidelity.md](./fix-01-parser-fidelity.md) §3 owns the corpus redesign + fixtures (this plan owns the CI job wiring, per fix-01 §3 "flipping the standalone `roundtrip-corpus` workflow job … is slice 8's call"). [fix-06-security-updates.md](./fix-06-security-updates.md) §2.1/§4 owns update-meta sha256 + release sequencing (this plan absorbs its `workflow_dispatch` ref-guard and post-publish hash assertion into the gating work, per fix-06 §4 "whoever lands first adds it" — slice 8 claims both).

---

## 1. Scope & findings

### Verified as reported

| ID | Status | Notes from deep-dive |
|----|--------|----------------------|
| T1 | **Verified** | The Playwright suite never launches Electron. `playwright.config.ts` runs `webServer: npm run dev:browser` (plain Vite) against a chromium-only project; `src/renderer/main.tsx:11-13` injects `mockEditorAPI` whenever `window.editorAPI` is absent. All specs seed state via `page.evaluate(() => localStorage.setItem('mockapi_file_<name>', content))` and drive `mockAPI.ts`'s localStorage-backed fake of the entire main process (dialogs are `window.prompt`, watcher/updater are no-ops). `grep _electron tests/` → zero hits. Correction to the review: **26** spec files (~2,800 lines), not 25. |
| T2 | **Verified, sharpened** | `roundtrip-corpus` CI job is `if: false` (`all-tests.yml:171-173`). Sharpened: flipping the flag alone **cannot work** — the script's default root is `<repo>/mdk/Content/Story/Dialoge` (`roundtrip-corpus.js:431`), which is gitignored and absent in CI checkouts, so the job would exit 1 immediately ("Corpus root does not exist"). Re-enabling requires the committed fixture corpus from fix-01 §3 plus an explicit `--root`. |
| T3 | **Verified** | `build-windows.yml` is `workflow_dispatch`-only with zero test steps and no `needs`; it stamps a version, builds, runs an 8-second "did it not exit" smoke (`:90-105`), and overwrites the public rolling release `windows-latest` — from **any ref** (fix-06 N1). No `concurrency` group either: two simultaneous dispatches can interleave asset uploads onto the same release. |
| T4 | **Verified** | No crash visibility at all: zero hits in `src/` for `uncaughtException`, `unhandledRejection`, `window.onerror`, `unhandledrejection`, `render-process-gone`, or any logging library. Every main-process failure path is `console.error` (invisible in a packaged Windows app); renderer errors vanish entirely. |
| T5 | **Verified, quantified** | Editor has no ESLint config, devDependency, or `lint` script — CLAUDE.md's completion gate ("npm run lint") is unsatisfiable in this workspace and CI lints only the parser. Quantified this pass by running the parser's rule baseline (`@eslint/js` recommended + `typescript-eslint` recommended, non-type-checked) against the editor: **`src/**` = 13 errors + 129 `no-explicit-any`; `tests/**` = 73 errors + 342 warnings; full run ~3 s.** Error breakdown for `src`: 4 `no-unused-vars`, 3 `no-require-imports`, 2 `ban-ts-comment`, 1 `no-useless-escape`, 3 stale `eslint-disable` directives referencing `react-hooks/*` rules (proof a lint setup was once intended — the directives are dead today). |
| T6 | **Verified** | `jest.config.js:16-20` silently maps `daedalus-parser/semantic-code-generator` and `daedalus-parser/semantic-model` to `tests/mocks/*` whenever `node_modules/daedalus-parser` is missing (e.g. broken/partial install), announced only by a `console.log`. The whole "real-parser" suite then passes green against mocks. An explicit opt-in already exists (`jest.mocked.config.js` / `npm run test:mocked`), so the silent fallback is pure hazard with no unique value. |

### New findings from this pass

| ID | Finding | Location |
|----|---------|----------|
| T7 | The mock harness's code generator emits **only DialogLine actions** (`mockAPI.ts:296-304` skips everything without `speaker/text/id`) and its "parser" is a regex that returns a canned model for anything containing `DIA_Example_Hello`. Consequence: mock specs that assert "saved content" (`content-persistence.spec.ts`, save paths in `project-mode-editing.spec.ts`) validate the *mock's* codegen, not the product's — a CreateTopic action "saved" in the mock silently disappears and the test can still pass. Any assertion about bytes-after-save is only meaningful in the real-Electron suite. | `src/renderer/utils/mockAPI.ts` |
| T8 | The packaged-app smoke test starts the exe and asserts it hasn't exited after 8 s — it never confirms a window rendered, the preload bridged, or the native parser loaded. A main process stuck before `createWindow()` passes. | `build-windows.yml:90-105` |
| T9 | Real-Electron E2E needs two tiny production seams: (a) settings/userData isolation — `SettingsService` resolves `app.getPath('userData')` in its constructor at module top-level (`main.ts:19`), before any test code can run, so isolation requires an env-guarded `app.setPath('userData', …)` at the very top of `main.ts`; (b) nothing else — `dialog.showOpenDialog` is called at call time on the shared `electron` module object (`FileService.ts:254,284`, `main.ts:259`), so Playwright's `electronApp.evaluate` can stub it with **zero** app changes. | `src/main/main.ts`, `FileService.ts` |

---

## 2. Real-Electron E2E vs. browser-mock harness — the split

### What the mock harness is (and stays) for

The existing suite is genuinely valuable: 26 behavioral specs that run in ~minutes with no build step, exercising real React/MUI/Zustand rendering in real Chromium. **Keep all of it** for UI-flow iteration: action/choice/condition editing, drag-reorder, dialog properties, focus management, search, variable manager, theming, view switching, reload-confirmation UX, node-editor playground. These test renderer behavior where the backend is irrelevant.

Honesty measures (S):

- Rename the CI job `editor-e2e-tests` → `editor-ui-tests (browser harness)` and retitle the `playwright.config.ts` header comment; the word "E2E" is reserved for the Electron suite.
- Add a short `tests/e2e/README.md` stating the harness contract: mock parser/codegen (T7), so **no spec here may assert generated/saved file content beyond AI_Output lines** — such assertions belong in `tests/e2e-electron/`. Audit the two specs that currently do (`content-persistence`, `project-mode-editing`) and either narrow their assertions or move the save-verification halves to the Electron suite.

### The real-Electron suite

New `tests/e2e-electron/` + `playwright.electron.config.ts` (separate config: different testDir, no webServer, `workers: 1`, `retries: process.env.CI ? 1 : 0`, timeout 60 s, trace on-first-retry).

Mechanics (all verified feasible against the current code):

- **Launch**: `const app = await _electron.launch({ args: ['.', '--no-sandbox'], cwd: <editor dir>, env: { ...process.env, NODE_ENV: 'production', DDE_E2E_USER_DATA: tmpUserDataDir } })`. Playwright `@playwright/test@1.56` already ships `_electron`; no new dependency. Requires `build:main` + `build:renderer` first (production branch of `main.ts` loads `dist/renderer/index.html`).
- **userData isolation** (T9a): guarded seam at the top of `main.ts`, before service construction: `if (process.env.DDE_E2E_USER_DATA) app.setPath('userData', process.env.DDE_E2E_USER_DATA);`. ~3 lines, inert in production.
- **Dialog driving** (T9b): `await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); })` — mutates the same module object `FileService`/`main.ts` call at call time. Same pattern for `showSaveDialog`.
- **Fixtures**: per-test `fs.mkdtemp` project dir seeded by copying `tests/fixtures/*.d`; add one **windows-1252-encoded** fixture (umlauts) for the encoding spec. Disk assertions read bytes directly from the test process.
- **Helper**: one `tests/e2e-electron/harness.ts` exporting `launchApp({ projectDir })` that wires all of the above; specs stay short.

### Critical-path spec list (the real-E2E contract)

| # | Spec | Asserts | Interlocks |
|---|------|---------|-----------|
| 1 | `app-launch-and-ipc.spec.ts` | Window opens, title renders, `window.editorAPI` is the **preload bridge** (not the mock — e.g. `getAppVersion()` returns package version, not `0.0.0-mock`), a `parseSource` IPC round-trip through the real native parser returns a model. Replaces the meaning of the 8 s smoke (T8). | — |
| 2 | `open-project-edit-save.spec.ts` | Open real project folder (stubbed dialog) → NPC/dialog tree populates from the real metadata workers → edit a dialog line → save → **read the file from disk** and assert the edited text is present and the file reparses cleanly via the parser package. | slice 2 (save pipeline), slice 3 (workers) |
| 3 | `save-fidelity-no-edit.spec.ts` | Open a fixture file, save with zero edits → bytes on disk are token-identical to the original (fix-01 Tier-1 definition). Starts as a **ratchet**: assert on the fixture subset already fidelity-clean under fix-01's progress, expand to all fixtures as fix-01 lands. | fix-01 |
| 4 | `encoding-roundtrip.spec.ts` | Open the windows-1252 fixture, edit, save → umlauts survive on disk byte-for-byte (guards E6 regression). | slice 2 |
| 5 | `undo-redo-save.spec.ts` | Edit → Ctrl+Z → Ctrl+Y → save → disk reflects the final (redone) state; undo-to-clean then save reflects original. | slice 5 |
| 6 | `external-change-reload.spec.ts` | Modify the open file on disk from the test process → real chokidar watcher fires → clean file reloads in the UI; dirty-file variant asserts whatever conflict behavior slice 2 specifies (no silent clobber). | slice 2 (E4) |
| 7 | `parse-error-save-guard.spec.ts` | Open a file with syntax errors → visual edit → auto-save/save does **not** write generated-from-partial-model output; the error is surfaced in the UI. | fix-01 P7 + slice 2 E3 |
| 8 | `window-security.spec.ts` | `window.open` is denied and `will-navigate` to external URLs is blocked in the real app — the spec fix-06 §3 explicitly delegates to this slice. Lands together with fix-06's handler. | fix-06 S4 |
| 9 | `crash-logging.spec.ts` | Force a renderer error via `page.evaluate(() => setTimeout(() => { throw new Error('e2e-probe') }))` → the main-process log file contains the forwarded entry. This is the failing-first test for §5. | this plan |

Out of scope here: quest-editor real-browser interaction specs — slice 4 owns them (its findings Q1/Q2 need product fixes first); this harness is where they will live, noted for fix-04.

### CI wiring

New job `editor-e2e-electron` in `all-tests.yml` (ubuntu-latest): install, `pnpm --filter daedalus-dialog-editor run build`, then `xvfb-run --auto-servernum pnpm --filter daedalus-dialog-editor exec playwright test -c playwright.electron.config.ts` (Electron needs a display on Linux; ubuntu runners ship xvfb). Upload report artifact. Budget: suite ≤ ~5 min at 9 specs / 1 worker. No sharding — the suite must stay small; growth pressure goes to the mock harness or Jest.

Phase 2 (optional, after stable): run the same suite on `windows-latest` **inside `build-windows.yml` before packaging** — the shipped platform is Windows, and this catches encoding/path/NSIS-adjacent regressions where they matter. Not part of the initial land.

**Flakiness budget**: `retries: 1` in CI, never higher. A spec failing >~2% of runs is quarantined (`test.fixme` + tracking issue) within a week; a quarantined critical-path spec blocks the next release until reinstated. Watcher/timing specs (#6) must poll with `expect.toPass` rather than fixed sleeps.

---

## 3. Fidelity corpus in CI (wiring for fix-01 §3)

Prerequisite: fix-01 step 0 lands `daedalus-parser/test/fixtures/corpus/` (~20 committed MIT-safe `.d` files), Tier-1 token-fidelity in `roundtrip-corpus.js`, and the `roundtrip-corpus-smoke.test.js` ratchet that already gates PRs via the normal `parser-tests` job.

This plan's wiring:

1. Replace the `if: false` job in `all-tests.yml` with a real `roundtrip-corpus` job running on push/PR:
   `pnpm run test:roundtrip-corpus -- --root test/fixtures/corpus --strict` (the root script already forwards `--` args to the parser workspace; the path is relative to `daedalus-parser/`). Keep the report-artifact upload steps exactly as written — the details JSON is the debugging payload for drift failures.
2. Green-from-day-one: until fix-01's ratchet reaches "all fixtures strict", the job runs the same per-fixture strict set as the smoke test (fix-01 §4.1's plain reviewable array) — the job must never be red for known-unfixed findings, or it will be ignored/disabled again.
3. Keep `--root` override untouched so maintainers run the real MDK corpus locally: `npm run test:roundtrip-corpus -- --root <mdk path>`; document this in `daedalus-parser/README.md` when flipping the job.
4. The job joins the release gate automatically via §4 (build-windows calls all-tests, which now includes it).

Redundancy note, made deliberately: the smoke test inside `parser-tests` and this job overlap. The standalone job earns its keep through the uploaded drift reports and through being individually visible in the release gate; if it ever diverges from the smoke test's fixture set, the smoke test is the source of truth.

---

## 4. Release gating — `build-windows.yml`

### Gate on the full test matrix (reusable workflow)

Smallest-diff mechanism, no duplication:

1. Add `workflow_call:` to `all-tests.yml`'s `on:` block (three lines; the workflow is unchanged otherwise and keeps running on push/PR).
2. In `build-windows.yml`:
   ```yaml
   jobs:
     tests:
       uses: ./.github/workflows/all-tests.yml
     build:
       needs: tests
       runs-on: windows-latest
       ...
   ```
   The gate then includes: editor typecheck+Jest+build guard, browser-harness Playwright (4 shards), the new Electron E2E job, parser tests/lint/typecheck, and the corpus job — releasing from a red main becomes structurally impossible.
3. No manual escape hatch (`skip_tests` input). The break-glass path for a genuine emergency is reverting the offending commit on main — anything softer will be used routinely and re-creates S5.

Cost: a dispatch now waits ~the all-tests wall time before building. Accepted; the E2E budget in §2 exists partly to keep this bounded.

### Ref guard (absorbs fix-06 N1)

- Job-level guard on `build`: `if: github.ref == 'refs/heads/main'` (workflow-level `on: workflow_dispatch` stays, but non-main dispatches produce a skipped build instead of a published release).
- Stale-run guard as a step before publishing: fail unless `github.sha` equals the current remote head (`git ls-remote origin refs/heads/main`), so **re-running an old workflow run** cannot republish old bits (and, per fix-06 N1, cannot publish old-schema `update-meta.json` that would brick strict verifiers).

### Publishing hygiene + cheap versioning wins

- `concurrency: { group: build-windows-release, cancel-in-progress: false }` — serialize publishes to the mutable rolling release.
- Add `commit: "${{ github.sha }}"` to `update-meta.json` and the release body. Additive JSON field; `UpdaterService` ignores unknown fields (verified: it reads named properties only). Coordinate with fix-06, which owns the same file's `sha256`/`size` additions — land as one schema change if timing allows.
- **Post-publish hash assertion** (absorbs fix-06 §3 producer verification): after the release step, re-download `update-meta.json` + installer from the just-published release, recompute sha256, and fail the workflow on mismatch. Guarded to skip (with a warning) while `sha256` is absent from the metadata, so this step can land before fix-06 R1 and self-activates when R1's producer lands. Note the failure mode is *loud after the fact* — the release is already public — so on failure the step must also print explicit "delete/replace the release" remediation.

---

## 5. Crash logging — local file only, no telemetry

Privacy stance (explicit, non-negotiable in this design): **no network reporting, no telemetry, no automatic submission.** One local log file the user can attach to a bug report. Log messages and stacks only — never file contents or project paths beyond what an error message itself contains.

### Design

1. **`src/main/services/LogService.ts`** (new, ~80 lines, zero new dependencies — the codebase minimizes deps and the need is tiny; `electron-log` was considered and rejected as scope, revisit only if requirements grow):
   - Target: `path.join(app.getPath('userData'), 'logs', 'main.log')`.
   - `log(level, source, message, stack?)` → single-line timestamped entries; `fs.appendFileSync` (crash paths must survive imminent process death; volume is far too low for sync writes to matter).
   - Size-capped rotation: at ~1 MiB rename to `main.log.1` (keep one predecessor).
   - Startup banner on first write per session: app version, Electron version, platform/arch — the bug-report header.
2. **Main-process handlers** (in `main.ts`, wired before `app.whenReady()`):
   - `process.on('uncaughtException', …)` and `process.on('unhandledRejection', …)` → log. Deliberately **log-only, no `process.exit`, no dialog**: minimal behavior change; deciding hard-fail semantics belongs with slice 2/3's error-surfacing work.
   - `app.on('render-process-gone')` and `app.on('child-process-gone')` → log with `details.reason/exitCode` — this is the only way the Q-class renderer crashes and worker deaths (slice 3) become visible post-mortem.
3. **Renderer forwarding**:
   - Preload: `logRendererError: (payload) => ipcRenderer.invoke('log:rendererError', payload)`.
   - Main handler validates at the boundary (strings only, message ≤ 2 000 chars, stack ≤ 8 000, drop anything else) → `LogService.log('error', 'renderer', …)`.
   - Renderer entry (`main.tsx`): `window.onerror` + `window.addEventListener('unhandledrejection')` forwarding via `window.editorAPI.logRendererError` when the function exists (mock provides a no-op so the browser harness is unaffected).
4. **Discoverability** (S, do it — an unfindable log is not attachable): `app:getLogPath` IPC + a "Show log file" affordance in the existing settings/about surface that calls `shell.showItemInFolder` (main-side).

---

## 6. Editor ESLint bootstrap

- **Dependencies** (editor devDeps): `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals`. Skip `eslint-plugin-react` initially — TS already covers most JSX correctness; add later if wanted.
- **Config**: flat `eslint.config.js` modeled directly on the parser's TS block for cross-workspace consistency:
  - `js.configs.recommended` + `tseslint.configs.recommended` (non-type-checked — type-checked lint is a follow-up, not bootstrap) over `src/**/*.{ts,tsx}` and `tests/**/*.{ts,tsx}`; ignores for `dist/`, `node_modules/`, `playwright-report/`, `blob-report/`.
  - Environments: `globals.browser` for `src/renderer`, `globals.node` for `src/main` + `scripts/`, jest globals for `tests/`.
  - `@typescript-eslint/no-unused-vars` with `^_` ignore (parser parity); `@typescript-eslint/no-explicit-any: 'off'` with the same TODO comment convention the parser uses (129 hits in src / 342 in tests — a ratchet project, not a bootstrap blocker).
  - `react-hooks` plugin recommended rules with `exhaustive-deps: 'warn'` initially: the three existing (currently dead) disable directives become live, and the unknown number of new warnings must **not** be auto-fixed — deps-array changes interact with findings Q3/PF1-3 and belong to slices 4/7. Ratchet to `error` after those slices land.
- **Burden to fix in the bootstrap PR** (measured, §1 T5): 13 src errors + 73 test errors, nearly all mechanical (`no-unused-vars`, `no-require-imports`, `ban-ts-comment`, stale directives). Fix them; do not add suppressions beyond the two documented `off`s.
- **Scripts + CI**: `"lint": "eslint . --max-warnings 0"`? No — `exhaustive-deps` warnings would fail it. Use `"lint": "eslint ."` (errors fail, warnings visible) at bootstrap, and flip to `--max-warnings 0` in the same change that promotes `exhaustive-deps` to error. Add a `Lint editor` step to the `editor-tests` job. This finally makes CLAUDE.md's editor completion gate (`npm test` + `npm run lint`) real.

---

## 7. Jest parser-mock fallback

Change `jest.config.js` to **fail loudly**: when `node_modules/daedalus-parser` is missing, `throw new Error('daedalus-parser is not installed — run pnpm install. For the mocked suite use npm run test:mocked.')` instead of silently mapping mocks. Delete the conditional mapping entirely; `jest.mocked.config.js` remains the sole, explicit opt-in (it maps the mocks unconditionally and never relied on the fallback). No env-var escape hatch — an env var is just the silent fallback with extra steps, and the explicit config already covers the legitimate use case.

Verification (config code has no Jest seam): temporarily rename `node_modules/daedalus-parser` → `jest` must abort with the message above → restore. One-line note in the PR description; not worth extracting config logic into a testable module.

---

## 8. Test plan (per repo TDD rules)

Failing-first where a test seam exists; workflow YAML gets verification checklists instead.

1. **Electron harness bootstrap**: spec #1 (`app-launch-and-ipc`) is the red test — it fails until `playwright.electron.config.ts`, the harness helper, and the `DDE_E2E_USER_DATA` seam exist. Manually verify per CLAUDE.md's Playwright rule: watch it headed (`--headed`) once and confirm it drives the real window, real preload, real parser.
2. **Crash logging**: Jest unit tests for `LogService` first (append format, rotation at cap, banner-once); Jest test for the `log:rendererError` boundary validation (oversized/non-string payloads dropped, service not called); then e2e spec #9 red → wire `window.onerror` forwarding → green.
3. **Disk-truth specs** (#2–#7): each is itself the failing-first test for the behavior it pins. #3 and #7 are *expected* red against unfixed fix-01/slice-2 behavior — land them under the ratchet/interlock terms in §2 so the suite stays green while still expanding coverage as sibling slices land. #8 lands with fix-06's handler (red until then; keep it in fix-06's PR).
4. **Jest fallback**: manual inverted check (§7).
5. **Workflows** (no unit seam): checklist — (a) dispatch `build-windows` on a non-main branch → build job skipped; (b) dispatch on main with a deliberately red test on a scratch commit → build never runs; (c) re-run an old successful run → stale-run guard fails before publish; (d) successful main dispatch → release published, post-publish assertion step green (or warn-skipped pre-fix-06-R1); (e) corpus job uploads report artifacts on a PR.
6. **ESLint**: the lint run is its own gate; CI step proves wiring.
7. Completion gate per repo rules: editor `npm test` + new `npm run lint` + `typecheck:renderer` clean; parser suite untouched but re-run; both Playwright configs green locally and in CI.

---

## 9. Ordering, dependencies, risks, sizes

### Order

| # | Item | Size | Depends on |
|---|------|------|-----------|
| 1 | Jest parser-mock fallback → fail loudly (§7) | S | — |
| 2 | Release gating: `workflow_call` + `needs`, ref/stale-run guards, concurrency, `commit` in metadata, mock-job rename (§4, §2 honesty) | S | — |
| 3 | Crash logging: LogService + process/app handlers + preload/renderer forwarding + log-path affordance (§5) | M | — |
| 4 | Electron E2E harness + specs #1, #2, #5, #9 (§2) | M–L | 3 (spec #9) |
| 5 | Electron specs #3, #4, #6, #7 (disk-truth ratchets) (§2) | M | 4; ratchet terms with fix-01 / slice 2 |
| 6 | ESLint bootstrap + CI lint step + burn down 86 errors (§6) | M | — |
| 7 | Corpus CI job flip + README note (§3) | S | fix-01 step 0 landed |
| 8 | Post-publish hash assertion (guarded) (§4) | S | 2; self-activates with fix-06 R1 |
| 9 | Phase 2: Electron E2E on windows-latest inside build-windows | M | 4 stable in CI |

1, 2, 3, 6 are mutually independent and parallelizable. 2 should land **first** among the CI changes so every subsequent slice's work is release-gated from now on.

### Risks

- **Real-Electron E2E on Linux CI**: needs `xvfb-run` (Electron has no true headless) and `--no-sandbox` (existing `dev:electron` precedent). The native parser is built by its `postinstall` on the runner (already exercised by every CI install) and both native modules are NAPI (fix-06 verified), so Electron loads them — but this is exactly the assumption fix-06 §2.7 wants verified; this suite *is* that verification, and it doubles as the safety net for the Electron 29→latest upgrade. Keep launch flags centralized in `harness.ts` so the upgrade touches one file.
- **Flakiness**: watcher/debounce timing (#6), first-launch slowness on cold runners. Mitigations: 1 worker, generous `expect.toPass` polling, per-test temp userData (no state bleed), the quarantine policy in §2. Do not respond to flakes by raising retries.
- **Dialog stubbing coupling**: `app.evaluate` patching relies on call-time `dialog.*` access (verified today). A future refactor that captures `dialog.showOpenDialog` into a const at import time silently breaks the stubs — note this invariant in `harness.ts`.
- **Gating latency**: windows publishes now wait for the full matrix (~the E2E wall time). Accepted trade; the alternative (partial gate) recreates the reviewed failure mode.
- **Ratchet discipline** (#3/#7 specs, corpus job): green-by-ratchet only works if expanding the strict set is a tracked follow-up in the interlocking plans, not a hope. Each ratchet list must carry a comment naming the plan that widens it.
- **ESLint `exhaustive-deps` noise**: unknown count until the plugin is installed; kept at `warn` and explicitly out of auto-fix territory to avoid colliding with slices 4/7 dependency-array work.
- **Cross-slice sequencing**: spec #8 belongs to fix-06's PR; the post-publish assertion and `update-meta.json` schema edits touch the same workflow steps as fix-06 §2.1 — land as one schema change if both are in flight, and never violate fix-06 §4's R1→R2 verifier sequencing from this side (the stale-run guard in §4 is part of honoring it).

### Done criteria

All new tests green in CI; `build-windows` demonstrably refuses non-main and untested publishes (checklist §8.5 executed); editor workspace passes `npm test` + `npm run lint` + `typecheck:renderer`; corpus job green with artifacts on PRs. Then extract durable outcomes (harness split contract, release-gating invariants, crash-log privacy stance, lint baseline) into `docs/architecture/` / `docs/reference/`, update CLAUDE.md's CI-pipelines section, and delete this plan per docs hygiene.
