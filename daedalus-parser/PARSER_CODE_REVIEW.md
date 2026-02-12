# Parser Maintainability Code Review

Date: 2026-02-12  
Scope: `daedalus-parser/src/core`, `daedalus-parser/src/semantic`, and `daedalus-parser/src/utils`

## Executive summary

The parser is functionally rich and has a clear high-level architecture (syntax parse -> semantic pass 1 -> semantic pass 2). The strongest maintainability pain points are concentrated in traversal/control-flow logic and repeated “small parsing” idioms. The result is code that works, but is harder to reason about, modify safely, and test incrementally.

**Top risks to maintainability:**

1. **God-method style traversal in `LinkingVisitor`** (many responsibilities in one recursive routine).
2. **Duplication of primitive AST-to-value conversion logic** across visitors/parsers.
3. **Stringly-typed node/operator checks repeated in many places** (fragile and scattered domain rules).
4. **Inconsistent parser-construction paths** between `core/parser.js` and `utils/parser-utils.ts`.

---

## What is working well

- `ActionParsers` already introduced a shared helper (`parseActionWithArgs`) to reduce duplication for simple action parsing; this is a good direction for further refactoring.
- Condition parsing has explicit normalization behavior (`invertComparisonOperator`) and avoids some duplicate extraction by centralizing in `ConditionParsers`.
- Two-pass visitor architecture is conceptually sound and helps preserve phase separation.

---

## Findings (maintainability, duplication, code smells)

### 1) Large multi-responsibility recursive routine in `LinkingVisitor` (high)

**Evidence**
- `analyzeNodeRecursively` handles: context switching, condition raw-mode transitions, unsupported-statement preservation, assignment handling, call handling, condition extraction heuristics, and traversal recursion in one method.
- It has deeply nested branching and mode flags (`skipChildren`, `conditionRawMode`, `conditionFunctions`) that influence behavior across distant branches.

**Why this is a smell**
- High cognitive load: small behavior changes risk unintended side effects.
- Hard to unit-test in isolation (must set up large AST contexts to hit edge paths).
- Violates single-responsibility at method level.

**Suggested remediation**
- Split into explicit handlers, e.g.:
  - `enterDeclarationContext(...)`
  - `handleConditionModeTransitions(...)`
  - `handleStatementNode(...)`
  - `handleExpressionNode(...)`
  - `traverseChildren(...)`
- Introduce a tiny internal `TraversalContext` object instead of many mutable class fields.

---

### 2) Repeated AST primitive-value conversion logic (medium)

**Evidence**
- `DeclarationVisitor.createGlobalSymbol` converts string/number/boolean/other manually.
- `LinkingVisitor.processAssignment` and `processFunctionAssignment` each repeat type-based conversion logic.
- `ConditionParsers.parseBinaryValue` performs another similar conversion path.

**Why this is a smell**
- Logic drift risk: edge-case fixes can land in one place but not others.
- Increases test duplication: same behavior must be validated in multiple modules.

**Suggested remediation**
- Create one shared utility (e.g., `parseLiteralOrIdentifier(node, options)`), used by declaration/action/condition parsing.
- Keep caller-specific differences explicit via options (e.g., preserve quotes, coerce numbers, allow expressions).

---

### 3) Scattered operator and node-type whitelists (medium)

**Evidence**
- Comparison operators are hardcoded repeatedly (`['==','!=','<','>','<=','>=']`) in multiple methods.
- Node type gates are string-compared in many branches (`'binary_expression'`, `'unary_expression'`, `'if_statement'`, etc.).

**Why this is a smell**
- Rule changes require touching many locations.
- Easy to introduce subtle inconsistencies (e.g., one path treats an operator as comparison while another does not).

**Suggested remediation**
- Extract shared constants/predicates:
  - `COMPARISON_OPERATORS`
  - `isComparisonOperator(op)`
  - `isTopLevelStatement(node)` / `isControlFlowStatement(node)` in a shared AST predicate module.

---

### 4) Dual parser-construction pathways cause API drift risk (medium)

**Evidence**
- `DaedalusParser` in `src/core/parser.js` includes file parsing, encoding detection, metrics, and error collection.
- `createDaedalusParser` / `parseDaedalusSource` in `src/utils/parser-utils.ts` create parser instances separately and parse directly.

**Why this is a smell**
- Behavioral drift likely over time (different defaults, options, or instrumentation).
- More maintenance overhead for parser bootstrap changes.

**Suggested remediation**
- Establish one canonical parser factory and one canonical parse entrypoint.
- Keep utility wrappers thin and delegate to core implementation.

---

### 5) Side-effect coupling between function and dialog action recording (medium)

**Evidence**
- In `processFunctionCall` and `processFunctionAssignment`, action creation and dual writes (`currentFunction.actions` + linked `dialog.actions`) are performed inline.

**Why this is a smell**
- Coupled writes are easy to forget when adding new action sources.
- Increases bug surface for duplicate/missing action propagation.

**Suggested remediation**
- Introduce a single `recordActionForCurrentFunction(action)` helper encapsulating propagation rules.

---

### 6) Minor dead/unused code smell in `LinkingVisitor` (low)

**Evidence**
- `private semanticModel: SemanticModel;` is stored but not used in the class logic.

**Why this is a smell**
- Signals either stale implementation residue or missing intended usage.

**Suggested remediation**
- Remove unused field, or use it intentionally where direct semantic model access is required.

---

## Suggested remediation roadmap

1. **Refactor traversal hotspots first** (`LinkingVisitor` decomposition).  
2. **Centralize literal/value parsing** and migrate declarations/actions/conditions to shared helpers.  
3. **Extract AST/operator predicates/constants** to one shared module.  
4. **Unify parser bootstrap path** (`core` as single source of truth).  
5. **Add targeted regression tests** around action propagation and condition raw-mode transitions after refactor.

---

## Expected payoff

- Lower change risk when extending grammar/action coverage.
- Easier onboarding: clearer separation between traversal mechanics and semantic extraction.
- Higher confidence refactors due to fewer duplicated parsing rules.
