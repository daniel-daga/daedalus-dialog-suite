# Parser review — 2026-09-29

Reviewed the parser workspace at `8d547bf92f1e4322827bb7047f56aafac2942c8e`:
grammar, parser wrapper, semantic extraction, regeneration, NPC edits and
symbol/reference lookup. Each correction has a regression test that failed
before its implementation. The issues and closing commits track the findings.

## Condition semantics

**#329, P1.** Negated comparisons and parenthesized calls were captured both
as the complete negation and as their positive descendants. For example,
`!(A == B)` regenerated as `!(A == B) && A == B`. Calls could similarly gain
their argument expressions as extra guards. Atomic clauses now own their
descendants; numeric, member and array guards are retained too.

Comments shifted positional child indexes and stopped parenthesis unwrapping,
so `A /* note */ && (B || C)` could become `A && B && C`. Logical analysis now
uses named operands with comment extras filtered out.

Flattening empty branches, sibling nested guards or a return after a nested
guard changed success paths. A leading unconditional TRUE return could also
disappear. Structured extraction now accepts only a single nested guard chain
ending in a TRUE return; other control flow uses the original body.

Regression: `daedalus-parser/test/review-guard-semantics.test.js`. Truth tables
compare original and generated return values over all eight three-flag inputs.
Fixtures use boolean syntax shared by Daedalus and JavaScript; they do not
constitute an in-engine Gothic test.

## Expression statements

**#330, P1.** Non-call-root expression statements such as `!Touch();`,
`(Touch());` and `1 + Compute();` disappeared, including side effects.
They now remain complete raw actions; condition bodies containing them use
raw preservation. Regression: `review-statement-fidelity.test.js`.

## Call-site indexing

**#331, P2.** Local initializers and raw condition bodies were skipped without
indexing their calls. Call-site extraction now sweeps each complete function
body once, independently of semantic action/condition extraction. The regression
checks source order, nested arguments, line locations and absence of duplicates
in `review-statement-fidelity.test.js`.

## NPC edits

**#332, P2.** Insertion after an anchor whose line also held the closing brace
placed new fields/calls outside the instance. The writer now inserts inside the
body. Compound assignments remain other statements rather than editable field
definitions, so setting a field cannot accidentally rewrite an increment.
Regression: `npc-definition.test.js`.

## Symbol lookup

**#333, P2.** JavaScript object member names could resolve as inherited functions
or replace a symbol table's prototype. Identifier dictionaries now have no
prototype, and lookup checks owned keys. Deserialization uses the same tables.
Case-insensitive lookup also checks the current keys after a cached miss or
deleted entry, retaining functions added or renamed in a mutable model.
Regression: `review-symbol-lookup.test.js`, including JSON reconstruction.

## Validation

Added 29 regression cases. On Node.js 24.19.0, the parser workspace passes:

- `npm test`: 349 tests, 7 suites, zero failures or skips.
- `npm run lint`: zero errors or warnings.
- `npm run typecheck`: zero errors.

The native grammar binding was compiled from the generated `src/parser.c`
using the package's N-API headers and binding source. No grammar changes or
generated/native build artifacts are part of these corrections.
