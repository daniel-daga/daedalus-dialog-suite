# Parser Component Code Review

Date: 2026-02-11  
Scope: `daedalus-parser/src/core`, `daedalus-parser/src/semantic`, and shared parser utilities.

## Executive summary

The parser component is generally well-structured (clear two-pass semantic walk, dedicated action/condition parser modules).

This follow-up tracks the two remaining findings from the prior review:

1. Parser singleton reuse in shared utilities.
2. `parseFile` `detectEncoding` option mismatch between docs and runtime.

Both items are now resolved and covered by tests.

---

## Detailed findings

### 7) Shared singleton parser in utilities may create hidden coupling (low/medium)

**Status**
- Resolved on 2026-02-11.

**What changed**
- Removed module-level parser caching from `createDaedalusParser`.
- The function now returns a fresh parser instance per call.

**Impact**
- Eliminates implicit shared parser state across callers/tests.

**Validation**
- Added coverage in `test/semantic-error-handling.test.js`:
  - `createDaedalusParser should return isolated parser instances`

---

### 8) `parseFile` option contract mismatch (`detectEncoding` documented, not used) (low)

**Status**
- Resolved on 2026-02-11.

**What changed**
- `parseFile` now honors `options.detectEncoding`.
- When `detectEncoding: false`, parser skips auto-detection and decodes using UTF-8 fallback.
- Parsing options passed to `parse()` now exclude file-decoding-only options (`encoding`, `detectEncoding`).

**Impact**
- Runtime behavior now matches documented API contract.

**Validation**
- Added coverage in `test/encoding.test.js`:
  - `should allow disabling encoding detection`

---

## Suggested remediation order

1. Fix comment extraction bug (#1).  
2. Fix quote handling + deduplicate argument parsing (#3 + #5 + #6).  
3. Harden condition binary parsing (#4).  
4. Tighten metrics/options correctness (#2 + #8).  
5. Revisit parser singleton strategy if concurrency/isolation requirements expand (#7).

Current status for this follow-up: #7 and #8 completed.
