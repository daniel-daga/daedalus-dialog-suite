# Parser review verification — 2026-09-29

Reviewed source commit: `cbe10c3c03b0c5f3d20c665da63a29e34587b21a`.
The reproductions and fixes are on the local review branch.

Regression tests: `daedalus-parser/test/review-verification.test.js`. Run from
that workspace with `node --test test/review-verification.test.js` after
building the native addon and TypeScript.

## Findings and fixes

1. **Confirmed, high priority:** A C_INFO condition containing
   `((A || B) && C) && D` regenerated as `A && B && C && D`.
   For A=0 and B=C=D=1 this changed true to false. Fixed by recursively
   checking nested logical clauses. Mixed operators now use the existing raw
   body preservation path; homogeneous conditions remain structured.

2. **Confirmed transformation; original high severity not established:**
   The parser accepted `name == "Bob"` without syntax errors and regenerated
   `name == Bob`. Fixed by retaining whether the comparison value was a string
   literal and restoring its quotes during code generation. This confirms a
   source-fidelity defect for accepted syntax, but not that this expression is
   valid under Gothic engine string-comparison semantics. No Gothic engine or
   compiler was run, so gameplay impact remains unverified.

3. **Confirmed, medium priority:** Two C_INFO instances preceding a shared
   information function got Dialog.actions lengths `[0, 1]`; when the function
   preceded them, the lengths were `[1, 1]`. Both references still pointed to
   the same intact function, so the defect was the duplicate Dialog.actions
   projection, not loss of the function body. Fixed by mapping each
   information function to every referencing dialog and projecting actions
   onto each.

## Validation

- Native addon built locally; TypeScript build succeeded on Node 24.19.0/Linux.
- Before the fixes, focused verification had 2 passing controls and 3 failing
  regressions; all 296 pre-existing tests passed.
- After the fixes, all 5 focused checks passed. The full parser suite passed:
  301 tests, 0 failures.
- `npm run typecheck` and the final `npm run lint` passed.

Changes are on the local review branch and have not been published remotely.
