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

### Commented action edits

Commented typed calls carry JSON-safe `sourceCall` metadata: the AST ranges of
their original argument expressions, the original generated argument values,
the function-name range, and comments outside those expressions. The generator
uses the Daedalus grammar to read current call boundaries; there is no separate
regex tokenizer or numeric normalization for detecting edits.

An unchanged argument retains its original source spelling and comment layout.
An edited argument is replaced by the current field's complete text, including
new leading/trailing comments and the newline ending a line comment. Comments
inside the old editable expression belong to that field: changing or deleting
them takes effect, and replacing the whole expression replaces them too.
Comments outside expression ranges stay in the source. An arity change keeps
those outside comments ahead of the current call; argument comments come from
the current fields. AI_Output subtitle text always comes from the current model.

Older JSON carrying only `sourceText` recovers its original ranges and baseline
with the same parser and action extraction, before applying current edits.
Malformed edited calls fail visibly rather than replaying stale source.
`test/commented-action-edits.test.js` covers ownership, official JSON hydration,
legacy metadata, direct/then/else/nested calls and three parse/generate cycles.

### Commented assignment edits (#344)

The old assignment extractor retained only target, operator and value, so
comments in the gaps between them had no model slot. Both top-level extraction
and conditional-branch extraction now use the same constructor for
`SetVariableAction`. Commented assignments carry their original `sourceText`
and JSON-safe `sourceAssignment` ranges/baselines for the target, operator and
value. Official hydration retains both.

Generation reparses the current typed statement with the Daedalus grammar,
requires exactly one valid assignment and patches only changed components.
Original token-gap comments remain outside edits. Comments inside an edited
target/value belong to that expression and are replaced with it; newly authored
leading/trailing comments and the newline ending a line comment come from the
current field. Numeric baselines compare generated values, so unchanged literal
spelling survives but a real numeric edit cannot replay stale source.
Unsupported metadata versions and malformed edited statements fail visibly.
With `includeComments: false`, generation uses current canonical typed fields.

Indentation also keeps the interior lines of block comments verbatim; adding
indentation there on every cycle would alter their token text. This does not
promise byte identity for all surrounding whitespace.
`test/commented-assignment-edits.test.js` covers typed editing, exact single
assignment replay, comment tokens over hydration and three cycles, direct,
then/else/nested statements, all relevant token positions, multiline comments
and strings, member/array targets, current operator/value edits, new comments
and visible failures. Sixteen of seventeen regressions failed before the fix.
The actual editor worker → JSON → CodeGeneratorService path retains an edited
nested assignment's comment.

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

## Expression identity and formatting (#341)

The expression marker `Dialog.propertyExpressionKeys` is semantic metadata.
Previously `formatDialogPropertyValue` consulted it only with
`preserveSourceStyle: true`, so disabling formatting preservation changed
`nr = BASE + 2;` into `nr = "BASE + 2";`. The AST and JSON model already
retained the correct expression; its type was lost only at emission.

Expression values now emit verbatim for either style setting. Literal strings
still use the normal string path, and edited marked values come from the current
model. Formatting options cannot change expression identity.
`test/dialog-property-expression-options.test.js` exercises arithmetic, calls,
bitwise, array, member and unary expressions, literals alongside them, edits,
official JSON hydration and three cycles with alternating style settings.
All eight regressions failed before the fix and pass after it.

## C_INFO constructor projection boundary (#340)

A C_INFO body is a program, not necessarily a property initializer list. The
old second pass recursively collected assignments anywhere in that program
into `Dialog.properties`, overwriting repeated keys, discarding assignment
operators, and ignoring instance-body calls. The declaration pass retained no
original body. `generateDialog` then emitted the dictionary as unconditional
`=` assignments. This was irreversible information loss before generation;
different branch conditions and calls could produce the same model.

Classify the whole body before projecting it. Only comments and unique,
case-insensitive, direct identifier `=` assignments without embedded comments
use the editable property representation. Branches, calls, declarations,
returns, repeated writes, compound operators, member/array writes and embedded
comments keep the complete block in JSON-safe `Dialog.sourceBody.text`.
`Dialog.fromJSON` restores it across IPC and official model hydration.
Generation emits that block verbatim, independently of formatting/comment
options. This preserves statement order, operator spelling, comments and line
endings; it does not attempt to evaluate a Gothic constructor.

Only direct simple writes contribute property/reference metadata. Nested and
compound writes are never represented as unconditional values or references;
the metadata is not the constructor's final runtime state. The condition/info
pre-scan follows the same boundary and only examines C_INFO declarations.

`sourceBody.propertyValues` records the property baseline, with function
references represented by name. Generation rejects changed, added or deleted
properties and renamed function references rather than silently replaying stale
source or flattening executable code. Edit the constructor source and reparse
before changing such properties. Editing the bodies of directly linked
functions still works. `allowPartialModel` does not bypass this fidelity check.
Ordinary property-only dialogs retain their existing structured edit behavior.

This addresses the representation failure, rather than special-casing `if` or
`+=` in the generator. `test/dialog-instance-body-fidelity.test.js` covers
multiple different programs with identical property projections, exact complete
body preservation through JSON and three cycles, CRLF/Unicode comments,
compound/member/array/repeated writes, visible edit rejection, linked function
edits and normal structured property edits. The initial tests reproduced 14
failures before the fix; all 18 final regressions pass with the real native Node
binding and real class-transformer hydration.

The actual editor parser worker → JSON → CodeGeneratorService path was also
executed for preservation and forced-generation rejection. SaveFileFlow writes
after generation/validation; its syntax-only reparse could not detect the old
semantic loss because the corrupted program was still valid syntax. The new
generator check reaches both its validation and fallback generation paths.
No Gothic engine, licensed MDK corpus or interactive Electron UI run was made.

Local validation used the committed native grammar and reconstructed offline
dependencies: 417 non-CLI tests passed, including the fixture corpus; lint and
typecheck passed. The two CLI help tests require unavailable `ts-node`, and
`npm test` stops at the unavailable Tree-sitter CLI. Grammar sources were not
changed. The standard CI toolchain subsequently passed all 419 tests (including both
CLI help tests), grammar generation, lint and typecheck on fix commit
`efd9c30d562cf1c2fffd3ed1a288a7ec26bb75ad`:
[parser-tests job](https://github.com/daniel-daga/daedalus-dialog-suite/actions/runs/37113289639/job/111175181411).

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

## NPC edit batch contract (#343)

`applyNpcEdits` resolves all targets and ranges against the original source.
Applying patches back to front preserves those coordinates only for disjoint
replacements. The old writer never checked this prerequisite: two writes to
`level = 1;`, first `2` and then `100`, could produce `200`.

A batch now validates before changing the text. At most one set/remove operation
may target a case-insensitively matched field/index or call-name/occurrence.
This includes absent targets, for which a source-range check alone cannot find
the conflict. Replacement ranges must be disjoint, and an insertion cannot sit
inside or at the start of a replaced/removed range. Removing an anchor's line
and inserting on that line is therefore a conflict too. Errors name the
zero-based edit indices; no partial result is returned. Sequential intent must
use separate calls so the second call obtains fresh ranges.

Disjoint targets still resolve against the original source, including later call
occurrences after removing earlier ones. Multiple pure insertions at one point
are compatible and retain edit order; repeated `addCall` deliberately creates
distinct calls. There is no silent last-write-wins rule.
`test/npc-edit-conflicts.test.js` covers same/absent/indexed fields, call
occurrences, set/remove conflicts, CRLF anchor deletion, different replacement
lengths, Unicode, stable insertions and explicit sequential edits.
Ten of fourteen regressions failed before the fix. The existing 28 NPC tests
remain green. The actual editor parser worker also rejects a conflicting batch;
the NPC dialog surfaces that error before assigning the result to sourceText.

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

The clustering fallback now uses one function-emission registry per export
(#342), just as the declaration-order path does. Previously it recorded emitted
associated functions but never checked the registry before the next dialog,
so a shared condition, information function or choice target became duplicate
declarations. Leftover functions also checked dictionary keys rather than
declaration names. Both paths now identify declarations by their case-insensitive
function name, check before emitting and record every emitted function.
A single-dialog export gets its own registry; repeated exports remain independent.
`test/shared-function-generation.test.js` covers shared condition/info functions,
cyclic choices, absent/empty/partial/parsed order data and dictionary-key case
drift through hydration. Three of five regressions failed before the fix.

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
