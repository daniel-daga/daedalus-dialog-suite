# Daedalus Parser Stabilization Plan

Last updated: 2026-03-05
Scope: `daedalus-parser` workspace

## Objective

Stabilize parser maintainability and release-readiness by fixing contract drift, tooling drift, and documentation drift identified in the current code review.

## Baseline (Current State)

- `npm test` passes (125 tests).
- `npm run typecheck` passes.
- `npm run lint` fails (1331 errors).
- Main risks are API type/runtime mismatch and broken lint workflow.

## Priority Plan

### Phase 1: API Contract Alignment (P1)

Goal: Ensure `index.d.ts` reflects actual runtime behavior.

Tasks:
- Compare `index.d.ts` against `src/core/parser.js` and exported TS modules.
- Remove or correct method/type declarations that do not exist at runtime.
- Add/adjust missing fields that runtime returns (for example parse/validation result shape).
- Add regression tests for typed API usage where practical.

Done criteria:
- No declared public method is missing at runtime.
- Type declarations match actual return shapes used in tests/examples.

### Phase 2: Lint Pipeline Recovery (P1)

Goal: Make `npm run lint` actionable and green.

Tasks:
- Exclude generated JS artifacts under `bin/bin` and `bin/src` from lint, or retarget lint to source-of-truth files only.
- Fix remaining true source/test lint violations.
- Confirm lint rules still enforce intended style and safety checks.

Done criteria:
- `npm run lint` passes without suppressing meaningful source checks.

### Phase 3: CLI Script Reliability (P2)

Goal: Remove fragile runtime dependency on network-installed tools.

Tasks:
- Replace `npx ts-node ...` scripts with deterministic local execution path:
  - either add explicit `ts-node` dev dependency,
  - or point scripts to built JS in `dist`/`bin` outputs.
- Verify `semantic` and `format` commands work in a clean environment.

Done criteria:
- CLI scripts run without fetching missing executables at runtime.

### Phase 4: Documentation Synchronization (P3)

Goal: Align README/package docs with actual behavior.

Tasks:
- Remove or fix stale command examples (`generate`, `daedalus-format`) if not available.
- Update test count and supported workflows.
- Remove or replace links to missing docs referenced in README.
- Verify command examples against `package.json` scripts and exported bin entries.

Done criteria:
- README examples execute as written.
- No dead local documentation links.

## Verification Checklist

Run after each phase, and again at the end:

- `npm test --workspace daedalus-parser`
- `npm run lint --workspace daedalus-parser`
- `npm run typecheck --workspace daedalus-parser`
- Optional: `npm run test:roundtrip-corpus --workspace daedalus-parser`

## Execution Order and Milestones

1. Phase 1 + tests
2. Phase 2 + full lint validation
3. Phase 3 + CLI smoke checks
4. Phase 4 + docs validation

Recommended checkpoint after each phase:
- Commit with focused scope and passing relevant checks.

## Risks and Mitigations

- Risk: Type declaration changes may affect downstream consumers.
  - Mitigation: keep changes additive where possible and document breaking changes clearly.
- Risk: Excluding generated files from lint could hide real issues.
  - Mitigation: lint source-of-truth TS/JS files only; keep generated output out of quality gates.
- Risk: CLI path changes may break user scripts.
  - Mitigation: preserve existing script names and provide migration notes if behavior changes.
