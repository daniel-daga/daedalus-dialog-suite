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

## Conditions (2026-09 review, #328–#333)

The flat condition model (one operator over a list of clauses) is used only
when it reproduces the guard's truth table exactly; anything it cannot
represent keeps the **original body verbatim (raw mode)**, never a
simplified projection. Raw mode is triggered by:

- mixed or nested logical operators — a nested `if` or an inner `||` under an
  `&&` (`if (A) { if (B || C) … }`, `((A || B) && C) && D`); homogeneous
  chains stay structured;
- binary guards the model has no clause for (`flags & 1`) and call
  comparisons it declines — operands and their order kept;
- non-canonical control flow, including a non-trivial unconditional
  top-level `return TRUE` after conditional returns.

A captured expression is taken **once**: its operands are not collected again
as separate clauses (`!(A || B)` must not also yield `A`, `B`).
Condition calls need **exact arity**; a mismatch falls back to the verbatim
call, as for actions. A comparison value that was a string literal keeps a
literal flag so generation re-quotes it (`name == "Bob"`).

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
