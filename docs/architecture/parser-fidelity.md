# Parser Roundtrip Fidelity

## Reference, hydration and export ownership

Reference identity is separate from preserved expression text. A shared AST
helper resolves bare or parenthesized identifiers, including comment trivia,
without treating strings, member access or calls as identifiers. Structured and
raw choice analysis use the same rule; information/condition properties and
typed `Npc_KnowsInfo` references use it too. Current model fields remain the
source of reference analysis after edits. Generation retains parentheses,
quotes and trivia rather than overwriting fields with normalized names.

`Dialog.actions` is an enumerable editable view of its current information
function's array. Shared dialogs share that body after parsing and official
JSON hydration. Replacing the function's action array, editing through the
dialog view or relinking the information property changes the same source of
truth. The visitor records each action only once. Hydration ignores stale
serialized dialog snapshots when a live information function exists;
standalone legacy action arrays are still restored with their action classes.
The function lookup map is held outside the serialized model.

Each declaration emitter owns its leading comments. Direct declaration calls,
single-dialog exports, ordered whole-model emission and fallback clustering
all use those emitters; callers do not add the same comments again. Shared
functions emit their declaration comments once, `includeComments: false`
suppresses them, and LF/CRLF multiline comment token text remains unchanged.

`test/review-reference-hydration-export.test.js` exercises real native parsing,
official JSON hydration, current edits, shared functions, transitive choices and
cycles, literal/reference controls, direct and whole-model exports, and three
roundtrip cycles. The test-only commit reproduced 17 failures before the fixes;
the five other new cases guarded existing behavior.

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
  `chapter`): safe integer literals stay numbers; noncanonical spelling is
  retained in `sourceCall`. Unsafe integers, other literals and
  identifiers/constant names keep their raw text (`parseNumericArg`). Literal `0` is a number —
  falsy-coercion defaults are forbidden.
- **Arity mismatch → generic fallback, never drop**: `parseSemanticAction`
  falls back to `parseGenericAction` (verbatim call text) when a recognized
  function has unexpected argument count in either direction
  (`Npc_RemoveInvItem` = 2 args vs `Npc_RemoveInvItems` = 3).

### Parsed call identity

Semantic dispatch selects the editor's action or condition type; it does not
own the emitted callee. Parsed calls carry JSON-safe `callIdentity` metadata
with the original `sourceName` and the generator's `generatedName` baseline.
A shared call renderer retains the source name while generating current
arguments. It uses an explicitly edited callee when that differs from the
baseline, independent of comment and source-style options. This includes
structured predicates under negation and comparisons.

`Log_AddEntry` and `B_LogEntry` may both project to `LogEntry`, but remain
distinct calls on output. New actions and older JSON without source identity
keep their constructor defaults. Older commented action JSON can recover the
callee from its existing `sourceText`/`sourceCall` range. Unknown and declined
calls continue to emit their verbatim action or condition text.

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
comments in the gaps between them had no model slot: `x /* keep */ = 1;`
became `x = 1;` even with comments enabled. Both top-level extraction
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

- An AI_Output subtitle comment must be on the **same line** as the completed statement;
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

## 2026-10-03 review validation

The original five-finding review was recorded at
[072b312](https://github.com/daniel-daga/daedalus-dialog-suite/blob/072b3122723bf12f050c262dedd574d71886077d/docs/plans/parser-review-2026-10-03.md).
Its settled contracts now live above; the completed plan is removed.

| Issue | Root boundary | Regression file | New tests |
|---|---|---|---:|
| #341 | Expression identity is independent of formatting | `test/dialog-property-expression-options.test.js` | 8 |
| #342 | One declaration identity registry per export | `test/shared-function-generation.test.js` | 5 |
| #343 | Original-coordinate patches require validated disjoint targets/ranges | `test/npc-edit-conflicts.test.js` | 14 |
| #344 | Assignment trivia and edits need explicit AST ownership | `test/commented-assignment-edits.test.js` | 17 |

These regressions reproduced 37 failures before their respective fixes; the
seven remaining cases guarded existing behavior. Combined local validation:
461 non-CLI parser tests, lint and typecheck passed using the real native binding
and real model hydration. The local environment still lacks the Tree-sitter CLI
and ts-node, so standard CI supplies grammar regeneration and both CLI tests.

On source tip `779763e16765c506570daa33016b753a3e49e018`,
[parser-tests](https://github.com/daniel-daga/daedalus-dialog-suite/actions/runs/37116593815/job/111184497434)
passed all **463 tests**, grammar generation, lint and typecheck.
The separate
[strict fixture corpus](https://github.com/daniel-daga/daedalus-dialog-suite/actions/runs/37116593815/job/111184497600)
also passed. The follow-up documentation commit changes no parser source.
No licensed MDK corpus or Gothic engine run was performed.

## Export and declaration boundaries (2026-10-04)

The five review failures had distinct root causes, reproduced before their fixes
in `daedalus-parser/test/review-export-boundaries.test.js`:

| Failure | Root cause | Settled contract |
|---|---|---|
| Single-dialog export leaves choice callbacks undeclared | Reachability walked only typed choices, while commented headers and unsupported branch statements are preserved as raw actions | The shared reference walk parses current raw action text with the Daedalus grammar and follows actual `Info_AddChoice` callback identifiers, including transitive targets and cycles |
| Function-key case drift crashes export | Reachability returns declaration names but export indexed the function dictionary by exact key | Resolve emitted definitions through the same case-insensitive lookup used by reachability |
| Style normalization inserts a success return in empty functions | Default body generation was enabled by `preserveSourceStyle: false` even for parsed empty bodies | Explicit empty-body metadata controls behavior independently of formatting; new functions retain their defaults |
| Comments after a body and before its semicolon disappear | Header and body capture left declaration footer trivia without an owner | Functions and dialogs carry JSON-safe `declarationSuffix` text, emitted after the current body and omitted with comments disabled |
| Standalone comments ignore `includeComments: false` | `CommentAction` ignored the options passed to its generator | Explicit comment suppression applies to standalone actions in ordinary, nested and raw condition bodies |

Raw choice analysis uses current action text rather than the historical
`callSites` index, so editing a callback or deleting a choice cannot resurrect
the old dependency. Strings, comment text, member-call names and declined
argument counts do not become references. Structured choices still use their
current editable fields. Invalid edited raw statements fail visibly rather
than producing an incomplete dependency export. Raw source remains verbatim;
this does not make its embedded comments structurally removable or turn its
statements into editable typed actions.

Footer trivia belongs to the declaration, independently of signature and body
edits. Its LF/CRLF and comment text survive official JSON hydration and repeated
parse/generate cycles. Existing JSON without footer metadata keeps its existing
behavior. The grammar and native binding are unchanged.

## Additional source-boundary review fixes

The follow-up review identified five distinct information-loss boundaries.
`test/review-source-boundaries.test.js` covers their fixes, current model edits,
official JSON hydration, three parse/generate cycles and related controls.

| Failure | Root cause | Contract after the fix |
|---|---|---|
| New NPC statements disappear inside block comments | Insertion used a physical newline without checking AST comment spans | Advance past complete trailing comments before inserting; retain CRLF and the instance boundary |
| Unresolved Latin-1 identifiers become quoted strings | Extraction omitted expression identity and the legacy generator recognized only ASCII identifiers | Mark every non-string source expression and use the grammar's identifier alphabet for the legacy fallback |
| Numeric spelling changes or becomes invalid exponent notation | Converting every literal to `Number` loses precision/spelling; JavaScript formats small/large values using unsupported exponents | Retain noncanonical tokens as strings or safe-integer action source metadata; expand edited finite numbers into decimal notation in properties, assignments, comparisons and numeric action fields |
| Comments between `)` and `;` disappear | Action capture stopped at the call node, before statement-level comment extras | Optional JSON-safe `sourceCall.statementSuffix` retains that gap for typed and generic calls; typed edits and arity changes still use current fields |
| Only the last trailing property comment survives | Each comment overwrote one dictionary slot | Keep the complete comment run, including its intervening whitespace, in the existing string slot |

For commented calls, suffix trivia belongs to the statement, separately from
the editable arguments. Subtitle ownership is determined using the completed
expression statement's ending row, including when a suffix comment spans lines.
With comments disabled, current canonical typed fields are generated as before.
The numeric representation uses existing `number | string` model fields and
expression flags rather than introducing a new JSON numeric wrapper. Non-finite
edited JavaScript numbers fail visibly instead of generating invalid code.

The initial 26 regressions failed before these fixes. The final 28 tests also
cover edited numeric values that require decimal expansion and existing safe
integer action-field types. All 489 non-CLI parser tests, `build:ts` and
typecheck pass locally using the real native Node binding, committed grammar
and real model hydration. The standard CI toolchain supplies Tree-sitter
regeneration, lint with the pinned dependencies and the two CLI help tests.

## Formatter safety and semantic header preservation

Six further review findings were reproduced before implementation. The first
regression run had 16 failures and three passing controls using the actual
native grammar, CLI entry points and official model hydration.

| Failure | Root cause | Contract after the fix |
|---|---|---|
| Malformed input replaces a destination with a partial reconstruction | The formatter only warned about parse errors, skipped the visitor error pass and wrote before optional verification | Reject source errors and validate generated syntax before writing, with or without verbose output |
| Windows-1252 string text becomes replacement characters | The formatter always decoded bytes as UTF-8; replacement characters inside strings still parse | Prefer valid UTF-8, otherwise Windows-1252; accept explicit input/output encodings, preserve input encoding by default and reject unrepresentable output before writing |
| Edited string properties become identifiers or function references | Generation inferred identity from spelling and JSON hydration linked matching strings to functions | Retain `propertyLiteralKeys`; expression metadata takes precedence, new descriptions default to literals and legacy JSON retains its inference behavior |
| Function and C_INFO header comments disappear or contaminate parameter keywords | Reconstruction had no header trivia ownership; parameter keyword extraction included its whole commented prefix | Capture AST token ranges and comment text in JSON-safe `sourceHeader`; patch current typed tokens, recover only the real parameter keyword and honor `includeComments` |
| Projected condition block comments gain indentation on each save | Generation indented every internal comment line | Indent the comment's first line only; preserve its interior text, including CRLF |
| Parser JSON stdout cannot be parsed as JSON | Human-readable banners were emitted before the JSON document | Suppress those banners in JSON mode |

Statistical encoding detection misclassified a German Windows-1252 regression
as an unsupported encoding with high confidence. The formatter therefore uses
the explicit UTF-8/Windows-1252 policy above rather than guessing other legacy
encodings. Windows-1250 and other encodings require `--encoding`.

Header comment metadata belongs to the declaration, separately from its editable
signature. Changes in parameter count or keyword presence move the original
comments ahead of the current canonical header. Ordinary token edits preserve
their original comment gaps. The metadata survives JSON hydration and remains
active when source-style preservation is disabled. An integration regression
also exposed mixed dictionary-key/current-name tracking for renamed dialogs;
generation now records the current declaration name consistently and emits it
once.

The 22 follow-up tests cover destination preservation (including in-place
formatting), UTF-8 and legacy encoding paths, edited literals and function-name
collisions, legacy JSON, expression precedence, header edits and arity changes,
comment removal, LF/CRLF block comments and three hydrated roundtrip cycles.
All 513 parser tests, grammar regeneration, lint, typecheck and the strict
synthetic fixture corpus pass locally with the real native Node binding.
No licensed MDK corpus or Gothic engine run was performed.
