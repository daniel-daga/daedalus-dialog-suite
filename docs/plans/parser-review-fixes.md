# Parser Code Review — Findings & Fix Tracking

Source: full review of `daedalus-parser/` (REVIEW-PLAN.md chunks 1–4), 2026-06-10.
Baseline at review time: 165 tests pass, `lint` and `typecheck` green on `master`.

Status legend: ✅ fixed (test-first, verified) · 🔲 open · 🚫 deferred (needs scope/contract decision — see notes).

## P1 — Correctness bugs (reproduced against the built parser)

| # | Finding | Status |
|---|---------|--------|
| F1 | **Compound assignments silently rewritten to `=`.** `Kapitel += 1;` → `SetVariableAction{operator:"="}` → regenerates `Kapitel = 1;`. `linking-visitor.ts` reads `childForFieldName('operator')` but the grammar declares no `operator` field on `assignment_statement`, so it is always `null`. | ✅ |
| F2 | **Negation lost for non-canonical casing.** `!npc_isdead(self)` in a condition function parses as `NpcIsDeadCondition{negated:false}` — inverted semantics on regeneration. Case-sensitive name checks in `isNegatedCallHandledByUnaryCondition` (linking-visitor), `parseUnaryExpression` and `parseSupportedCallComparisonWithCall` (condition-parsers), while main dispatch is case-insensitive. Affects `Npc_IsDead` and `Npc_IsInState`. | ✅ |
| F3 | **Mixed-case `Condition =` / `Information =` properties break linking.** Exact-string property checks in `linking-visitor.ts` (`processAssignment`, `findDialogForFunction`), `cross-references.ts`, and `generator.ts` (`getAssociatedFunctions`). Condition extraction and dialog-action sync silently no-op for capitalized property names (legal Daedalus). | ✅ |

## P1 — Roundtrip scope gaps (reproduced; need scope decision)

| # | Finding | Status |
|---|---------|--------|
| F4 | **Local `var` declarations silently destroyed.** Grammar `_statement` lacks `variable_declaration`; `var int x;` inside a function parses *without errors* as bare identifier expression-statements and vanishes on regeneration → generated code references undeclared locals. | ✅ |
| F5 | **Function parameters never modeled.** `DialogFunction` has no parameter list; codegen always emits `()`. `func void Baz(var int n)` regenerates as `func void Baz()`. | ✅ |
| F6 | **Codegen drops globals.** Constants/variables/instances are parsed into the model but `declarationOrder` records only dialogs+functions and `generateSemanticModel` emits only those — `const int MAX = 5;` disappears from output. | ✅ |

F4–F6 shared one scope decision — resolved as "model these constructs": locals are
preserved as raw `Action`s, parameters are modeled on `DialogFunction`, and globals are
recorded in `declarationOrder` and re-emitted from captured `sourceText`. The resulting
roundtrip scope boundary is documented in `../reference/parser-roundtrip-scope.md`.

## P2 — Robustness / fidelity

| # | Finding | Status |
|---|---------|--------|
| F7 | **Declaration-order dependence for condition functions.** `conditionFunctions` is built during pass 2 from instance assignments; a condition function declared *before* its instance is analyzed before it is known to be one and gets misclassified (body parsed as actions, conditions empty). | ✅ |
| F8 | **Cross-references miss nested Choices.** `findFunctionReferences` and `collectReachableFunctions` scan only top-level actions; `Choice` actions inside `ConditionalAction.thenActions/elseActions` are invisible to rename/remove cascades and reachability. | ✅ |
| F9 | **String escaping asymmetry.** `normalizeArgumentText` strips outer quotes without unescaping; `Choice.generateCode` escapes `\` and `"` on emit (double-escape on roundtrip of `\"`); `DialogLine`/`LogEntry` quote without escaping. Original Daedalus has no string escape sequences at all, so the right fix needs a language-semantics decision (probably: never escape/unescape, validate embedded quotes at the editor input boundary) plus corpus validation. | 🚫 |
| F10 | **`DialogLine.generateCode` ignores stored `listener`**, recomputing it from the speaker. `AI_Output(self, hero, …)` regenerates as `AI_Output(self, other, …)`. The existing listener test passed only by coincidence (speaker `other` → recomputed `self`). | ✅ |
| F11 | **Error-position inconsistency.** `DaedalusParser.collectErrors` (parser.js) reports 0-based tree-sitter positions; `ErrorVisitor` reports 1-based. The editor's `ValidationService` passes `parseResult.errors[].position` straight through, so normalizing is a coordinated parser+editor contract change. | 🚫 |

## P3 — Hygiene

| # | Finding | Status |
|---|---------|--------|
| F12 | `deserializeCondition` silently returns `new Condition('')` for unknown types while `deserializeAction` warns — quiet data loss. | ✅ |
| F13 | `grammar.js` has a duplicate `conflicts` key (second silently wins); grammar.js is not linted, so `no-dupe-keys` never fired. | ✅ |
| F14 | Lint covers only three JS files; all TypeScript sources (~4k lines, where F1–F3 live) are unlinted — no typescript-eslint. Lint-pipeline scope is already tracked in `daedalus-parser-stabilization.md` Phase 2; extend it to TS sources there. | 🚫 |
| F15 | `generateDialog` hardcodes `(C_INFO)` instead of the stored `dialog.parent` casing — style churn vs the `preserveSourceStyle` goal. | ✅ |
| F16 | Minor: `alignProperty(propertyName)` ignores its parameter; `ErrorVisitor` has a redundant `if (node.hasError)` after the early return. | ✅ |
| F17 | `CLAUDE.md` `SemanticModel` shape drifted (omits `npcs`/`animations`; `declarationOrder` element type). | ✅ |

## Notes on deferred items

Scope decisions for F9/F11/F14 are resolved; the implementation plan is
`parser-review-fixes-deferred.md` (same directory).

- **F9** — decided: Daedalus has no string escape sequences. Never escape/unescape;
  validate embedded quotes at the editor boundary.
- **F11** — decided: 1-based rows/columns everywhere. Change `parser.js`, `index.d.ts`,
  and the editor consumers together.
- **F14** — folded out of stabilization plan Phase 2: add typescript-eslint, lint
  `src/**/*.ts` (grammar.js already linted as of F13).
