# AGENTS.md

Instructions for agents working in `daedalus-dialog-editor/`.

## Stack and Purpose

- Electron main process + React renderer
- TypeScript, Vite, Zustand, MUI, Reactflow
- Goal: visual editing, validation, and generation of Daedalus dialog/quest content

## Workflow Expectations

1. Use TDD for bug fixes and new features.
2. Run focused tests during iteration, then run broader workspace checks before completion.
3. Keep UI changes validated in the node editor playground when relevant.

## Node Editor First Step

For node editor work, start here first:

- from repo root: `npm run dev:node-editor --workspace daedalus-dialog-editor`
- from this folder: `npm run dev:node-editor`

This serves `/node-editor.html` (typically on `http://localhost:5173/node-editor.html`).

## UI Smoke Verification

When changing node editor UI behavior, do a quick smoke pass:

1. open `/node-editor.html`
2. confirm key controls render (for example `data-testid="node-editor-quest-select"`)
3. retest after each meaningful UI change

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



