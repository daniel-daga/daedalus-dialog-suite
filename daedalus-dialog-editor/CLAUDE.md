# Claude Development Guidelines

## Core Principles

1. **Always use TDD** - Write tests first, then implement (Red-Green-Refactor)
2. **Never over-document** - Be concise, avoid creating unnecessary markdown files

## Node Editor First Step

For any node editor feature work or bugfix, first run the dummy node editor playground:

- From repo root: `npm run dev:node-editor --workspace daedalus-dialog-editor`
- From `daedalus-dialog-editor/`: `npm run dev:node-editor`

This starts Vite and opens `/node-editor.html` (typically `http://localhost:5173/node-editor.html`).

## Playwright MCP Verification

While developing node editor UI behavior, use Playwright MCP for quick smoke checks against the running Vite page before deeper debugging:

- Navigate to `/node-editor.html`
- Confirm core controls render (for example `data-testid="node-editor-quest-select"`)
- Re-run after each meaningful UI change
