# Repository State Review

Date: 2026-02-15

## Scope

This review validates the current repository health by checking workspace status and running the primary automated test commands.

## Findings

### 1) Working tree is not clean before review

There is pre-existing untracked content in `daedalus-parser/node-compile-cache/`.

### 2) Monorepo test run is partially failing

Running `npm test` at repository root executes tests for both workspaces:

- `daedalus-parser`: passes.
- `daedalus-dialog-editor`: mostly passes, but one suite fails.

Current summary from the root run:

- Test Suites: `1 failed, 35 passed, 36 total`
- Tests: `5 failed, 293 passed, 1 skipped, 299 total`

### 3) Failing suite is deterministic in isolated rerun

Rerunning only the failing suite reproduces the same failures:

- Command: `npm test --workspace daedalus-dialog-editor -- tests/ProjectService.test.ts`
- Result: `5 failed, 10 passed`

### 4) Probable root cause for failures

The failing logs repeatedly report worker startup errors:

- `Cannot find module .../src/main/workers/metadata.worker.js`

The worker pool resolves `metadata.worker.js` first in a path relative to runtime output and only falls back to `dist/.../metadata.worker.js` when missing.

However, repository source currently contains only:

- `src/main/workers/metadata.worker.ts`

This mismatch likely causes worker thread startup failure in test runtime and leaves async test operations hanging until Jest timeout.

## Recommendation

1. Decide a consistent worker strategy for Jest/runtime:
   - build workers before test execution, or
   - allow worker pool to run TypeScript worker in test mode (or mock worker pool in tests).
2. After implementing strategy, rerun:
   - `npm test`
   - `npm test --workspace daedalus-dialog-editor -- tests/ProjectService.test.ts`
3. Consider cleaning/ignoring generated cache artifacts to keep `git status` clean.
