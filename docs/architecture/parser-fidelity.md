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
3. **Semantic drift + idempotence:** model summaries (including
   class/prototype/global name sets) across reparse.

The committed fixture corpus (`test/fixtures/corpus/`, 11 files, one per
construct family) runs fully strict via `test/roundtrip-corpus-smoke.test.js`
— all fixtures are in the green set and the test fails if any regresses.
The real MDK corpus is licensed/gitignored; run it locally with
`npm run test:roundtrip-corpus -- --root <mdk path>`. Re-enabling the
standalone CI corpus job is slice 8's call.
