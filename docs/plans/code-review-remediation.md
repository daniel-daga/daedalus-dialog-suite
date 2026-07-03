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

## Working agreement

- Plans follow repo TDD rules: every fix starts from a failing test that genuinely exercises the defect (see finding IDs in each plan).
- A slice is `done` only when the affected workspace passes `npm test` / `npm run lint` / `npm run typecheck` and the plan's verification checklist is complete.
- Cross-slice dependencies are called out inside each plan (e.g. slice 2's auto-save-on-parse-errors fix depends on slice 1's `hasErrors` guard semantics; slice 8's fidelity corpus gates slice 1).
