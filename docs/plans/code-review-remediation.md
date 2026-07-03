# Code Review Remediation — Tracker

Source: full-monorepo production-readiness review, 2026-07-02. All findings with `file:line` references live in [`code-review-findings.md`](./code-review-findings.md).

**Overall verdict:** not production-ready until slices 1–4 and 6 are fixed. Recommended fix order: 3 → 2 → 1 → 6 → 4 → 8 → 5 → 7.

Each slice gets a deep-dive pass producing a fix plan document (linked below). Status values: `todo` → `plan-ready` → `in-progress` → `done` (plan file deleted per docs hygiene, durable outcomes extracted to `docs/architecture/` / `docs/reference/`).

| # | Slice | Severity | Plan document | Status |
|---|-------|----------|---------------|--------|
| 1 | Parser roundtrip fidelity (silent data loss on parse→generate) | Blocker | [fix-01-parser-fidelity.md](./fix-01-parser-fidelity.md) | plan-ready |
| 2 | Editor save/dirty-state pipeline (unsaved-work loss, lossy writes) | Blocker | [fix-02-save-pipeline.md](./fix-02-save-pipeline.md) | plan-ready |
| 3 | Worker lifecycle & reliability (crash → silent permanent hang) | Blocker | [fix-03-worker-reliability.md](./fix-03-worker-reliability.md) | plan-ready |
| 4 | Quest editor stack (features unreachable in prod, canvas leaks) | Blocker | [fix-04-quest-editor.md](./fix-04-quest-editor.md) | plan-ready |
| 5 | Undo/redo × edit debouncing (interleaved-edit corruption) | Major | [fix-05-undo-debounce.md](./fix-05-undo-debounce.md) | plan-ready |
| 6 | Security & update chain (unverified updates, EOL Electron, symlinks) | Blocker | [fix-06-security-updates.md](./fix-06-security-updates.md) | plan-ready |
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

## Working agreement

- Plans follow repo TDD rules: every fix starts from a failing test that genuinely exercises the defect (see finding IDs in each plan).
- A slice is `done` only when the affected workspace passes `npm test` / `npm run lint` / `npm run typecheck` and the plan's verification checklist is complete.
- Cross-slice dependencies are called out inside each plan (e.g. slice 2's auto-save-on-parse-errors fix depends on slice 1's `hasErrors` guard semantics; slice 8's fidelity corpus gates slice 1).
