# AGENTS.md

Instructions for agents working in `daedalus-parser/`.

## Architecture

The parser follows a staged model:

1. Tree-sitter parsing (native grammar)
2. Semantic visitor passes build a `SemanticModel`
3. Code generation emits Daedalus source from semantic structures

Prefer the semantic model workflow for feature changes and editor integration.

## Key Development Rules

1. Use TDD (failing test first, then minimal implementation).
2. Do not rely on temporary test files; add meaningful tests to `test/*.test.js`.
3. Keep generation logic string-template and semantic-model driven unless a change clearly requires otherwise.

## Grammar and Build Notes

When `grammar.js` changes:

1. regenerate parser with `npm run build`
2. run tests with `npm test`

Run these checks before completion:

- `npm test`
- `npm run lint`
- `npm run typecheck`

## Documentation Hygiene

1. Keep parser public docs split and current:
   - `README.md` for usage and workflows
   - `API.md` for API/interface reference
2. Keep parser implementation plans in `../docs/plans/` while active; when complete, extract durable outcomes into canonical docs and delete the completed plan file.
3. Any documented CLI command must match `package.json` scripts and exported binaries.
4. Prefer package-facing import examples (`daedalus-parser` and exported subpaths), not internal source paths.

## Common Paths

- `grammar.js`
- `src/core/parser.js`
- `src/semantic/`
- `src/codegen/`
- `test/`


