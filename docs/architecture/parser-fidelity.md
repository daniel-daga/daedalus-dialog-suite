# Parser Roundtrip Fidelity

Durable decisions from the 2026-07 fidelity remediation (review findings
P1–P7, M1–M5, N1–N10). The governing principle:

> **Fidelity by construction** — keep the source token text in the model;
> parse into structured fields for the editor, but never regenerate from a
> lossy projection when the original text is representable.

## Capture patterns

- **Verbatim `sourceText`** for constructs the editor does not edit
  structurally: globals, `C_Item`/`C_Npc`/MDS instances, and (since P1)
  `class` / `prototype` declarations (`GlobalClass`, `GlobalPrototype`).
- **`…IsExpression` flags** on string-ish action arguments (`DialogLine.id`,
  `LogEntry.text`, routine/animation/spawn-point fields): `true` means the
  source argument was *not* a string literal, so `generateCode` must not
  quote it. Absent flag = quote (legacy/editor-created data keeps today's
  behavior).
- **Raw argument text** (quotes intact) stored directly in fields whose
  generators emit verbatim (`CreateTopic`, `LogSetTopicStatus`,
  `SetAttitude`, `Teach`, pickpocket args, targets/items). Never strip
  quotes without re-quoting on emit.
- **`number | string` numeric fields** (`quantity`, `damage`, `seconds`,
  `chapter`): plain integer literals stay numbers; identifiers/constant
  names keep their raw text (`parseNumericArg`). Literal `0` is a number —
  falsy-coercion defaults are forbidden.
- **Arity mismatch → generic fallback, never drop**: `parseSemanticAction`
  falls back to `parseGenericAction` (verbatim call text) when a recognized
  function has unexpected argument count in either direction
  (`Npc_RemoveInvItem` = 2 args vs `Npc_RemoveInvItems` = 3).

## Conditional projection boundary

Condition functions are classified as whole bodies before extracting predicates.
The flat editor representation is used for a single comment-free
`if (expression) { return TRUE; };` with a uniform AND or OR operator, or an
unconditional `return TRUE;` / `return 1;`. Standalone body comments surrounding
that guard or return are retained in `conditionBodyLeadingComments` and
`conditionBodyTrailingComments`, including through JSON hydration and predicate
edits. They do not disable typed conditions or simulator evaluation.
Only parentheses and logical
composition are traversed when collecting clauses; calls, unary expressions,
comparisons, arithmetic, member access and array access are atomic roots.
Their descendants must never become extra predicates.

Nested guards, alternative branches, additional statements, mixed AND/OR, and
comments inside a guard's header or branch remain raw actions. This retains explicit branch boundaries
without assuming that a compiler short-circuits logical operators. It also
retains comment positions that the flat fields cannot express. The editor shows
these bodies as raw actions rather than editable typed condition rows. Call-site
indexing remains a separate full-body pass, including raw expressions.

Comparison normalization may swap operands only when the moved operand is a
literal. Compound operands can change associativity, and calls or identifier
reads can observe evaluation order. Quoted `"TRUE"` / `"FALSE"` values are not
Boolean constants. Unsupported comparisons stay verbatim.

The generator brackets generic condition clauses as individual operands and
puts their closing delimiter on a new line so a trailing `//` cannot consume it.
Conditional action headers use AST parentheses, never character counting;
commented headers fall back to raw source. Editor-authored action headers also
place their closing delimiter on a new line when `//` is present.

Single-dialog export uses the shared choice-reachability walk. It includes
choice targets in both structured conditional branches and their transitive
sub-dialogs, handles case drift, and emits each target once even with cycles.

`test/conditional-path-review.test.js` checks source-based truth tables, call
order, explicit branch boundaries, comments, manual model edits, JSON hydration,
and three parse/generate cycles. The JavaScript oracle is limited to the tested
shared expression semantics; it does not establish Gothic engine behavior or
replace a real mod corpus run.


Condition calls still require exact arity; unsupported calls remain verbatim.
String comparison values retain their literal flag when structured.

## Statements and symbols

- Operators and operands are found **by token, not child position** —
  tree-sitter comment extras are children too (`value /* note */ += 1`).
- Expression statements that are not calls are kept verbatim.
- The call-site index is built once from the whole function body, so local
  initializers and raw-mode condition bodies are indexed.
- An information function shared by several `C_INFO` instances is projected
  onto **every** referencing dialog, independent of declaration order.
- Identifier tables are prototype-free dictionaries (names like
  `__proto__`, `constructor` are ordinary symbols), lookups resolve own keys
  only, and a cached case-insensitive miss is refreshed after model mutation.
- NPC edits insert inside the instance body even when the anchor and closing
  brace share a line; compound assignments (`+=`) are not field sets.

Engine semantics were not checked for any of these — the guarantee is source
fidelity (the regenerated guard has the same truth table), not that the
source is valid Gothic.

## Comments

- An AI_Output subtitle comment must be on the **same line** as the call;
  next-line comments are standalone.
- Standalone comments in function bodies (including raw-mode condition
  bodies and conditional branches) become `CommentAction` entries —
  first-class actions whose `generateCode()` is the comment text.
- C_INFO instance bodies carry `propertyLeadingComments` /
  `propertyTrailingComments` / `trailingBodyComments`; files carry
  `SemanticModel.trailingComments` (EOF comments).

## Generation order

When a model has `declarationOrder` (i.e. it came from a parse), the
generator emits **strictly in that order** — no dialog-clustering
pull-forward, no synthesized section headers. Clustering and headers remain
the fallback for models (or entries) without order data, e.g. editor-created
content.

## Errored models

`generateSemanticModel` **throws** when `model.hasErrors` is truthy unless
`allowPartialModel: true` is passed (`CodeGeneratorOptions`). Scope: the
whole-model entry point only; `generateFunction`/`generateDialog` accept
hand-built partial models. Editor contract: the save path must surface this
error and gate auto-save on parse-errored files (slice 2 / E3 owns that UX;
until it lands, such saves fail visibly rather than silently corrupting).

## Case-insensitive references

Daedalus is case-insensitive; the model preserves source casing but all
lookups tolerate case drift: `namesEqual` / `resolveCaseInsensitive`
(`src/semantic/name-utils.ts`, WeakMap-cached lowercase index) back
cross-references, choice-target clustering, and `findDialogForFunction`
(which also caches misses). Never normalize stored names — tolerance lives
in the lookups.

## Fidelity measurement (corpus)

`scripts/roundtrip-corpus.js` measures three tiers:

1. **Token fidelity (strict, failing):** original vs generated compared as
   tree-sitter token streams. Whitespace/line endings/BOM normalized;
   identifier case, literal text, string quotes, comment text, and token
   order must match exactly. Corpus config:
   `{ includeComments: true, sectionHeaders: false, preserveSourceStyle: true }`.
2. **Byte fidelity (reported, non-failing):** equality after line-ending
   normalization; indentation preservation is the remaining gap (known:
   `CreateTopic`/`LogEntry` blank-line padding, N3).
   **Blank lines between top-level declarations are kept (#286).** The
   declaration pass records on each `declarationOrder` entry the blank lines
   before the declaration and its leading comments (`blankLinesBefore`), and
   blank lines inside a leading-comment block or between it and its
   declaration as empty `leadingComments` entries. A model built in code has
   no record and keeps the old spacing: none between consecutive globals, one
   otherwise. The smoke test's `BYTE_EXACT_FIXTURES` pins the fixtures that
   round-trip byte-identical, so byte drift in them fails rather than only
   being reported.
3. **Semantic drift + idempotence:** model summaries (including
   class/prototype/global name sets) across reparse.

The committed fixture corpus (`test/fixtures/corpus/`, 12 files, one per
construct family) runs fully strict via `test/roundtrip-corpus-smoke.test.js`
— all fixtures are in the green set and the test fails if any regresses.
The real MDK corpus is licensed/gitignored; run it locally with
`npm run test:roundtrip-corpus -- --root <mdk path>`. Re-enabling the
standalone CI corpus job is slice 8's call.
