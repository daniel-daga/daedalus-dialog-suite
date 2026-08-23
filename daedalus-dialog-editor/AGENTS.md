# AGENTS.md

Instructions for agents working in `daedalus-dialog-editor/`.

## Stack and Purpose

- Electron main process + React renderer
- TypeScript, Vite, Zustand, MUI
- Goal: visual editing, validation, and generation of Daedalus dialog/quest content

## Workflow Expectations

1. Use TDD for bug fixes and new features.
   - For new or changed **UI workflows** (user-facing flows in the Electron app), write a failing **Playwright E2E test** (`test/e2e/`) first, then implement. Run with `npm run test:e2e`.
   - For logic, store, or component-level changes without a new end-to-end flow, a Jest test is sufficient.
2. Run focused tests during iteration, then run broader workspace checks before completion.

## Performance Sanity Note

`semanticModel` is large and recreated frequently. Avoid passing the full object to deeply memoized components.
Prefer stable sub-properties and granular comparisons when using `React.memo`.

## Documentation Hygiene

1. Keep editor-facing architecture and behavior docs under `../docs/` using canonical sections:
   - `../docs/architecture/` for durable design/architecture decisions
   - `../docs/reference/` for durable behavior references
   - `../docs/plans/` only for active implementation plans
2. If an editor plan is completed, extract lasting decisions into canonical docs, then delete the completed plan file.
3. When changing commands, workflows, or constraints, update the relevant docs in the same change.

## Useful Commands

- `npm run dev`
- `npm run build`
- `npm run test`
- `npm run test:stable:windows` (recommended local Windows baseline)
- `npm run test:matrix:windows` (repro matrix for intermittent `3221226505` exits)
- `npm run test:e2e`



