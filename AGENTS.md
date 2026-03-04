# AGENTS.md

Generic instructions for coding agents working in this repository.

## Repository Scope

This is a monorepo with two workspaces:

- `daedalus-dialog-editor/` - Electron + React visual editor
- `daedalus-parser/` - Tree-sitter parser + semantic/codegen library

Use package-local instructions when working inside a workspace:

- `daedalus-dialog-editor/AGENTS.md`
- `daedalus-parser/AGENTS.md`

## Core Working Rules

1. Use TDD for feature work and bug fixes:
   - add or update a failing test first
   - implement the minimal fix
   - run relevant tests and confirm green
2. Prefer existing test infrastructure over ad-hoc scripts or temp files.
3. Keep changes focused and minimal; do not add unnecessary docs or scaffolding.
4. Verify with workspace-level commands before claiming completion.

## Useful Root Commands

- `npm run build` - build all workspaces
- `npm run test` - run tests across workspaces
- `npm run test:roundtrip-corpus` - parser corpus roundtrip check

