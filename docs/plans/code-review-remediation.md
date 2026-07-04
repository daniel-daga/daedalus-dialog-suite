# Code Review Remediation — Tracker

Source: full-monorepo production-readiness review, 2026-07-02. All findings with `file:line` references live in [`code-review-findings.md`](./code-review-findings.md).

**Overall verdict:** not production-ready until slices 1–4 and 6 are fixed. Recommended fix order: 3 → 2 → 1 → 6 → 4 → 8 → 5 → 7.

Each slice gets a deep-dive pass producing a fix plan document (linked below). Status values: `todo` → `plan-ready` → `in-progress` → `done` (plan file deleted per docs hygiene, durable outcomes extracted to `docs/architecture/` / `docs/reference/`).

| # | Slice | Severity | Plan document | Status |
|---|-------|----------|---------------|--------|
| 1 | Parser roundtrip fidelity (silent data loss on parse→generate) | Blocker | done — durable outcomes in [parser-fidelity.md](../architecture/parser-fidelity.md) | done |
| 2 | Editor save/dirty-state pipeline (unsaved-work loss, lossy writes) | Blocker | done — durable outcomes in [save-pipeline.md](../architecture/save-pipeline.md) | done |
| 3 | Worker lifecycle & reliability (crash → silent permanent hang) | Blocker | done — durable outcomes in [worker-reliability.md](../architecture/worker-reliability.md) | done |
| 4 | Quest editor stack (features unreachable in prod, canvas leaks) | Blocker | [fix-04-quest-editor.md](./fix-04-quest-editor.md) | in-progress (all 8 steps implemented; manual smoke outstanding) |
| 5 | Undo/redo × edit debouncing (interleaved-edit corruption) | Major | done — durable outcomes in [dialog-editor.md](../architecture/dialog-editor.md) (undo/redo, fire-time edits, drag-and-drop) + [save-pipeline.md](../architecture/save-pipeline.md) (flush registry) | done |
| 6 | Security & update chain (unverified updates, EOL Electron, symlinks) | Blocker | [fix-06-security-updates.md](./fix-06-security-updates.md) | in-progress |
| 7 | Rendering performance at mod scale (merge storms, subscriptions) | Major | [fix-07-render-performance.md](./fix-07-render-performance.md) | in-progress (all 8 steps implemented; manual profiler/smoke outstanding) |
| 8 | Test truthfulness & release gating (mock E2E, ungated releases) | Blocker | [fix-08-test-release-gating.md](./fix-08-test-release-gating.md) | in-progress (items 1–8 landed; see progress notes) |

## Notable deltas from the deep dives

The plan-writing passes corrected or sharpened several original findings:

- **U6 largely obsolete:** the `[BUG DEMO]` stale-model-on-save bug is already fixed architecturally (condition edits flow through store updaters; `historyActions.updateModel` has no callers). The live remnant is the 300 ms debounce window, fixed via slice 5's flush registry (see fix-02 / fix-05 §2.3).
- **E2 latent, not live:** `SourceCodeEditor` is unreachable in the shipped app (its mount is commented out in `MainLayout.tsx`); `workingCode` semantics are fixed as a prerequisite for re-enabling the view (fix-02 N1).
- **E3 × P7 must ship together:** once fix-01's generator guard lands, the `hasErrors`-clearing bug degrades into a permanently failing auto-save — fix-01 P7 and fix-02 E3 are a same-release pair.
- **Corpus job can't just be re-enabled:** its default root is the gitignored MDK path; it needs fix-01's committed fixture corpus plus explicit `--root` (fix-08).
- **New perf finding (fix-07 N1):** selector-less `useNavigation()` makes every `VariableAutocomplete`/`ReferenceLink` leaf re-render on each merge, bypassing ActionCard's memo.
- **New loss scenarios (fix-02):** external delete/rename of a dirty file discards all work via the watcher's `unlink` → `closeFile`; `saveSource` has a worse twin of E7's mid-save race.

## Slice 2 completion notes (2026-07-03)

- All nine fix-02 steps landed (E1, E2a/E2b, E3, E4 both phases, E5, E6, E7/N2, U6/N4, N3/N5/N7). Durable contracts extracted to [save-pipeline.md](../architecture/save-pipeline.md).
- The flush registry (`src/renderer/utils/pendingEditFlushRegistry.ts`) was created here with the API agreed in fix-05 §2.3 — slice 5 builds on it rather than creating it.
- Real-Electron E2E for window close + atomic write is recorded in fix-08's checklist (mock-harness Playwright specs cover the dialogs). Manual smoke on a real desktop build (close with dirty file, external edit via second editor, kill mid-save) remains outstanding for release QA — automated coverage is in place.

## Slice 4 progress notes (2026-07-03)

All eight fix-04 steps are implemented and landed on this branch, with durable contracts
extracted to [quest-editor.md](../architecture/quest-editor.md) (Canvas Interaction
Contract):

- Steps 1–7 (code + Jest): mount-once canvas lifecycle (callbacksRef, teardown via
  `stopRendering`+`setCanvas(null)`, no `graph.start()`, searchbox disabled), Q1 real
  link-click (`showLinkMenu` override + 12 px `onMouse` hit test + selected-edge marker),
  Q2 inspector condition-expression editor + IF-chip `onMouseDown` hit test, Q4
  `QuestEditingService.applyQuestUpdates` apply-time guardrail gate, U2 domain
  copy-on-write (`withUpdatedFunction`), U1 batch-undo snapshot-identity guard, PF3
  `parseGeneration` subscriptions. Covered by the quest Jest suites.
- Step 8 (this pass): test-only `window.__questGraphDebug` hook (dev/test-gated via the
  Vite entries) + four live-canvas Playwright specs (`tests/e2e/quest-editor-canvas.spec.ts`,
  Q1/Q2/Q3-Q5/Q4) driving the real Chromium litegraph canvas through the hook; a mock
  harness model-injection seam (`//__MOCK_MODEL__` in `mockAPI`) so the browser E2E can
  render a real quest graph. All five specs (incl. a diagnostic) pass in real Chromium.
- Incidental real-bug fix found via the Playwright pass: dialog node `size` was assigned
  before `addOutput`, which re-ran litegraph's `setSize(computeSize())` and shrank the
  node so the painted IF chip juts below the body and was unclickable — the size
  assignment now runs after `add{Input,Output}`.

Outstanding before `done` (do not delete the plan file yet):

- The fix-04 §4 **manual smoke checklist** — the node-editor playground
  (`npm run dev:node-editor`) pass and a full real-Electron (`npm run dev`) pass — which
  require a desktop/display environment not available in this sandbox.
- Sandbox note for whoever runs the Playwright specs: this environment's global
  `npx playwright` resolved to 1.56.1 while the project uses `@playwright/test` 1.58.1
  (invoke the local `./node_modules/.bin/playwright`), and the preinstalled Chromium is
  build 1194 vs the 1208 this version expects — the specs were executed by pointing
  `launchOptions.executablePath` at the 1194 binary via a throwaway config (not
  committed). CI (with matching browsers installed) runs them via the normal
  `playwright.config.ts`.

## Slice 6 progress notes (2026-07-03)

Fixes 1–4 of fix-06 landed (SettingsService atomic/serialized writes; symlink-aware async path validation with allowedRoots/allowedFiles whitelist narrowing; window-open/will-navigate deny + `notifySelfWrite` channel removal + IPC payload shape checks; updater sha256 integrity in its R1 tolerant phase with CI producer + post-publish self-check).

**Fix 7 code landed (2026-07-04):** Electron `^29.4.6` → `^43.0.0` (latest stable; bundled Node 20 → 24, `@types/node` ^24), electron-builder `^24.13.3` → `^26.0.0`, and the `build.electronVersion` dual pin deleted (builder now infers from the devDependency). electron-builder 26's schema validated against the existing `build` block (no deprecations); `build-windows.yml` needs no changes (NSIS artifact naming and asar-verify assertions unchanged). The `npmRebuild: false` NAPI invariant is documented in [worker-reliability.md](../architecture/worker-reliability.md). Local gates green (Jest 131/893, typecheck, main+renderer builds, lint). Sandbox cannot download the Electron binary (egress policy), so runtime verification is CI's `editor-e2e-electron` job under Electron 43 — the plan's designated NAPI/worker safety net — plus the maintainer-run packaged Windows smoke.

Remaining before the slice is `done`:

- **Fix 5 (R2 strict verifier)**: flip missing-`sha256` from warn to hard failure — only after the R1 build has actually shipped to users via the rolling release (sequencing constraint in fix-06 §4). Checked 2026-07-04: the rolling release still predates R1 (last published 2026-02-27), so this stays blocked.
- **Fix 6 (code signing)**: blocked on the owner's cert / Azure Trusted Signing decision.
- **Fix 7 verification**: the CI half is **satisfied** — master run 28697785586 (merge commit a7ebd2d, 2026-07-04) is fully green under Electron 43, including "E2E Tests (real Electron)" (editor build + all 17 real-Electron tests through the NAPI parser/worker path — the plan's designated safety net). Remaining: packaged-app verification on Windows (maintainer dispatch; extend/keep the packaged-smoke real-parse checklist item).
- Manual checklist items in fix-06 §3 (junction-layout error UX, signed-installer QA, upgrade smoke).

## Slice 8 progress notes (2026-07-03)

All eight §9 items of fix-08 are implemented and landed on this branch:

- **§7 Jest fallback** — silent parser-mock mapping deleted; missing `daedalus-parser`
  now throws with remediation text. `jest.mocked.config.js` layers on a new shared
  `jest.base.config.js` so `test:mocked` is genuinely independent of the guard.
- **§2 honesty** — CI jobs renamed `editor-ui-tests` / `editor-ui-merge-reports`
  ("browser harness"); `playwright.config.ts` header + `tests/e2e/README.md` state the
  mock-harness contract (T7: no disk-truth assertions beyond AI_Output lines).
- **§3 corpus job** — `roundtrip-corpus` re-enabled against the committed fixture
  corpus (`--root test/fixtures/corpus --strict`), green in CI with report artifacts;
  MDK `--root` override documented in `daedalus-parser/README.md`.
- **§4 release gating** — `all-tests.yml` gained `workflow_call:`; `build-windows.yml`
  now `needs` the full matrix, has a master-only ref guard, stale-run guard,
  `concurrency` publish serialization, and `commit` in `update-meta.json` (sha256
  producer + post-publish self-check were already landed by fix-06 and untouched).
  The §8.5 workflow-dispatch checklist (non-master dispatch skipped, red-main refusal,
  stale-rerun refusal, publish assertion) has NOT been executed yet — requires a
  maintainer dispatch.
- **§5 crash logging** — `LogService` (1 MiB rotation, per-session banner, injectable
  base dir), `uncaughtException`/`unhandledRejection`/`render-process-gone`/
  `child-process-gone` handlers, renderer `window.onerror`/`unhandledrejection`
  forwarding through validated IPC (`sanitizeRendererErrorPayload`), "Show log file"
  affordance in the app footer. Local file only — no telemetry.
- **§6 ESLint bootstrap** — flat `eslint.config.js` (parser-parity rules,
  `react-hooks` with `exhaustive-deps: warn`), `lint` script + CI step; 96 errors
  burned to 0 with 8 exhaustive-deps warnings left for slices 4/7 (do not auto-fix).
- **§2 real-Electron E2E** — `tests/e2e-electron/` + `playwright.electron.config.ts`
  + `harness.ts` (Electron launch, dialog stubbing, `DDE_E2E_USER_DATA` seam, fixture
  seeding) + `editor-e2e-electron` CI job (xvfb). All 10 planned specs exist (17
  tests): #1 app-launch/IPC, #2 open-project-edit-save, #3 save-fidelity ratchet,
  #4 cp1252 encoding roundtrip, #5 undo-redo-save, #6 external-change reload/conflict,
  #7 parse-error save guard, #8 window-security, #9 crash-logging, #10 window-close
  guard (atomic mid-write-kill sub-case is a documented `test.fixme`; the temp+rename
  mechanism is Jest-covered). Specs #1/#2/#5/#8/#9 proved green earlier (run
  28661165938); the five disk-truth specs #3/#4/#6/#7/#10 are **now CI-green** on
  master run 28685341652 (merge commit cd78d38, 2026-07-03) — all 9 jobs green
  including `editor-e2e-electron` ("E2E Tests (real Electron)"), their first full-CI
  execution. This is also the on-master validation of slice 5's landed work.

Environment caveats recorded for reviewers: the sandbox cannot download the Electron
binary (egress policy), so the plan §8.1 "watch it headed" manual verification is
replaced by real CI execution evidence; a temporary push-trigger commit used to obtain
the first CI run before PR #205 existed has been reverted.

Follow-ups completed 2026-07-04:

- **Ratchet expansion** — the corpus strict set was already complete (all 11
  fixtures GREEN, `KNOWN_RED_FIXTURES` empty in the parser smoke test). The #3
  widener ran: a new editor-path **byte**-fidelity Jest ratchet
  (`tests/saveFidelityCorpus.test.ts`) runs every corpus fixture through the real
  save-path seam (`CodeGeneratorService.generateCode` with the editor's default
  `codeSettings`) — 6 GREEN / 5 KNOWN_GAP, each gap with its root cause documented
  (inter-global blank lines, inline comment on non-AI_Output statements, raw
  multi-line re-indentation, topic/log renderer blank lines); a KNOWN_GAP that
  flips byte-green fails the suite until promoted. One genuine codegen bug found
  and fixed TDD (parser `renderTrailingComments` dropped the final newline after
  EOF comments), promoting `globals.d` + `encoding-1252.d`. E2E spec #3 is now
  parameterized over the byte-green *and* UI-drivable subset (`save-fidelity.d`,
  `case-drift.d`); byte-green fixtures without an NPC/dialog are covered by the
  Jest ratchet only (documented in the spec header).
- **Phase-2** — `build-windows.yml` gained an `e2e-electron-windows` job
  (windows-latest, mirrors the ubuntu job minus xvfb, distinct report artifact)
  and the packaging job now `needs` it; ref/stale-run/concurrency guards
  untouched. First execution happens on the next maintainer dispatch.

Outstanding before `done`: §8.5 release-gating dispatch checklist (maintainer-run;
now also proves the windows E2E job); then extract durable outcomes (harness split
contract, release-gating invariants, crash-log privacy stance, lint baseline) into
`docs/architecture/` / `docs/reference/`, update CLAUDE.md's CI section, and delete
the plan file.

## Slice 5 completion notes (2026-07-03)

All five fix-05 steps landed (TDD; F-A phantom-undo transaction, U3 condition
fire-time refs, U4 flush-before-undo, U1/F-B batch snapshot ids + validity with the
global save-wipe removed, U5 single hoisted `@hello-pangea/dnd` context with a
dispatch registry). CI validation is satisfied (master run 28685341652, all jobs
green). Durable contracts extracted to
[dialog-editor.md](../architecture/dialog-editor.md) (undo/redo model, fire-time
debounced edits, drag-and-drop) and
[save-pipeline.md](../architecture/save-pipeline.md) (flush-registry undo/redo
sites); the plan file is deleted. The residual choice-sublist memo gap is tracked
as `docs/refactoring-targets.md` entry #3.

## Slice 7 progress notes (2026-07-03)

All eight fix-07 §5 steps are implemented and landed on this branch (TDD,
failing-first Jest per step; suites / typecheck / lint green after each). Durable
contracts extracted to [render-performance.md](../architecture/render-performance.md).

- **Steps 1–2 (`cd0379b`)** — PF5 guards (ingestion abort/flush discard on
  abort-or-project-swap, `getSemanticModel` in-flight dedup with
  invalidate/clear/close drop) + category-stable incremental merge (§2.1:
  per-category input-signature cache in the store closure, untouched categories
  keep identity across merges, reset on `closeProject`/`clearCache`), memoized
  files-with-dialogs set (N2).
- **Step 3 (`a3f615b`)** — `useNavigation` subscription-free, callbacks stable via
  `getState()` (N1).
- **Step 4 (`fd5d6d4`, `5d09981`)** — selector checklist items 1–24 (17–19 via the
  step-3 rewrite) + coarse-identity A/B/C/E (App `parsedFiles.size` +
  `canUndo`/`canRedo` booleans; `useNpcDialogErrors` owns a narrow shallow-compared
  selector; `IngestedFilesDialog` gated on `open`). Item D was slice-4-owned and
  verified landed.
- **Step 5 (`ea71769`)** — VariableManager + `useVariableOptions` per-category
  subscriptions (§2.4 / N4).
- **Step 6 (`ce191f3`)** — DialogTree itemData narrowed to row primitives (PF2);
  `DialogTreeItem` comparator deleted.
- **Step 7 (`f2b364e`)** — ActionCard C3 (§2.8 option iii): `useResolvedFunction`
  (file-store-first, merged fallback) + `useStableHandlers`; `semanticModel`
  removed from the memo boundary and ~16 renderers; comparator invariant
  documented.
- **Step 8 (`9c817dd`)** — measurement tooling: deterministic
  `scripts/generate-perf-fixture.js` + informational `scripts/bench-merge.js`
  (`perf:fixture` / `perf:bench` npm entries; `perf-fixtures/` gitignored). Bench
  on a 20-file sample: ~10× per-merge, six of eight categories reused by identity.

Deviations from the plan text (all noted in the diffs):

- **Item 21** — `useDialogNavigation.activeFile` moved to `getState()` (it is read
  only in handlers), not the reactive per-field selector the checklist proposed.
- **`flattenDialogs`** now takes `dialogs`+`functions` maps: the plan's "uses
  nothing else" was inaccurate — it reads `functions` for `hasChildren`.
- **`VariableAutocomplete` keeps its `semanticModel` prop** — it serves
  quest-inspector/condition callers passing a different model; single-file mode is
  handled via per-category active-file reads in `useVariableOptions` (a deduped
  benign superset).
- **`useStableHandlers` placement** — applied at `DialogActionsSection` /
  `InlineChoiceEditor` (the non-memoized owners), not `ActionsList`.

The §3.3 Playwright ingestion smoke landed 2026-07-04
(`tests/e2e/ingestion-interactivity.spec.ts`, browser mock harness): 150 seeded
dialog files across 50 NPCs, an opt-in `mockapi_parse_delay_ms` seam in
`mockAPI.parseDialogFile` (default 0, no effect on other specs) so ingestion
spans multiple flush windows, determinate-progress + completion + NPC-filter
interactivity assertions, zero timing benchmarks. Note: the full-screen
`ProjectOpeningOverlay` modally blocks input during `isIngesting` by product
design, so the filter probe runs the instant the overlay clears (Playwright
actionability wait encodes "UI interactive again"); a stalled overlay, a hung
ingestion, or a frozen filter all fail the spec. Verified non-vacuous by
inverting the filter step (red), then restoring (green).

Outstanding before `done` (plan file kept): the §3.2 manual React Profiler
before/after evidence and the repo-mandated desktop smoke pass (no display in
this sandbox). All automated (Jest / structural / Playwright) coverage is in
place.

## Working agreement

- Plans follow repo TDD rules: every fix starts from a failing test that genuinely exercises the defect (see finding IDs in each plan).
- A slice is `done` only when the affected workspace passes `npm test` / `npm run lint` / `npm run typecheck` and the plan's verification checklist is complete.
- Cross-slice dependencies are called out inside each plan (e.g. slice 2's auto-save-on-parse-errors fix depends on slice 1's `hasErrors` guard semantics; slice 8's fidelity corpus gates slice 1).
