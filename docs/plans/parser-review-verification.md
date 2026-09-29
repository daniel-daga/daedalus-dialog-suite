# Parser review verification — 2026-09-29

Reviewed source commit: `cbe10c3c03b0c5f3d20c665da63a29e34587b21a`.
Verification only; no production code was changed.

The reproductions are in `daedalus-parser/test/review-verification.test.js`.
Run from that workspace with `node --test test/review-verification.test.js`
after building the native addon and TypeScript.

## Findings

1. **Confirmed, high priority:** A C_INFO condition containing
   `((A || B) && C) && D` regenerates as `A && B && C && D`.
   For A=0 and B=C=D=1 this changes true to false. A directly mixed
   `(A || B) && C` expression is preserved, providing a passing control.
   Root: `LinkingVisitor.detectTopLevelConditionOperator` only inspects the
   immediate operand operators, then the generator flattens conditions.

2. **Confirmed transformation; original high severity not established:**
   The parser accepts `name == "Bob"` without syntax errors and regenerates
   `name == Bob`. `parseBinaryValue` strips the quotes and `VariableCondition`
   emits the value without restoring them. The existing reversed-string
   comparison test asserts the stripped model value but does not roundtrip it.
   This proves a source-fidelity defect for accepted syntax, not that this
   input is valid under the Gothic engine's string-comparison semantics.
   No Gothic engine or compiler was run, so the original claim of high
   gameplay impact for this example should not be treated as verified.

3. **Confirmed, medium priority:** Two C_INFO instances that precede a shared
   information function get Dialog.actions lengths `[0, 1]`, instead of
   `[1, 1]`. Moving the same function before the instances yields `[1, 1]`.
   Both information references still point to the same intact function, whose
   actions array contains the action. The demonstrated defect is the duplicate
   Dialog.actions projection, not loss of the function body during generation.
   Root: the function-to-dialog map holds only one dialog.

## Validation

- Native addon built locally; TypeScript build succeeded (Node 24.19.0/Linux).
- Focused verification: 5 tests, 2 passing controls, 3 failing regressions.
- Full `npm test`: 301 tests, 298 passed, only these 3 new regressions failed.
  Thus all 296 pre-existing tests passed.
- `npm run typecheck` passed.
- The first lint run caught an eval-style test helper; it was replaced with a
  direct source-fidelity assertion. The final lint run passed.

The regression tests deliberately assert the intended corrected behaviour and
remain red until the defects are addressed. Changes are on the local review
branch; no fixes or remote publications are part of this verification.
