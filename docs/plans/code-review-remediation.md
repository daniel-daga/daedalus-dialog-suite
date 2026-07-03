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
| 5 | Undo/redo × edit debouncing (interleaved-edit corruption) | Major | [fix-05-undo-debounce.md](./fix-05-undo-debounce.md) | plan-ready |
| 6 | Security & update chain (unverified updates, EOL Electron, symlinks) | Blocker | [fix-06-security-updates.md](./fix-06-security-updates.md) | in-progress |
| 7 | Rendering performance at mod scale (merge storms, subscriptions) | Major | [fix-07-render-performance.md](./fix-07-render-performance.md) | plan-ready |
| 8 | Test truthfulness & release gating (mock E2E, ungated releases) | Blocker | [fix-08-test-release-gating.md](./fix-08-test-release-gating.md) | plan-ready |

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

Fixes 1–4 of fix-06 landed (SettingsService atomic/serialized writes; symlink-aware async path validation with allowedRoots/allowedFiles whitelist narrowing; window-open/will-navigate deny + `notifySelfWrite` channel removal + IPC payload shape checks; updater sha256 integrity in its R1 tolerant phase with CI producer + post-publish self-check). Remaining before the slice is `done`:

- **Fix 5 (R2 strict verifier)**: flip missing-`sha256` from warn to hard failure — only after the R1 build has actually shipped to users via the rolling release (sequencing constraint in fix-06 §4).
- **Fix 6 (code signing)**: blocked on the owner's cert / Azure Trusted Signing decision.
- **Fix 7 (Electron 29 → latest stable + electron-builder bump)**: land after 1–5; needs packaged-app verification on Windows.
- Manual checklist items in fix-06 §3 (junction-layout error UX, signed-installer QA, upgrade smoke).

## Working agreement

- Plans follow repo TDD rules: every fix starts from a failing test that genuinely exercises the defect (see finding IDs in each plan).
- A slice is `done` only when the affected workspace passes `npm test` / `npm run lint` / `npm run typecheck` and the plan's verification checklist is complete.
- Cross-slice dependencies are called out inside each plan (e.g. slice 2's auto-save-on-parse-errors fix depends on slice 1's `hasErrors` guard semantics; slice 8's fidelity corpus gates slice 1).
