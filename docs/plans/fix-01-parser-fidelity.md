# Fix Plan 01 — Parser Roundtrip Fidelity

Status: active plan. Scope: `daedalus-parser` workspace (plus explicitly flagged editor-side type/renderer updates).
Source review: `docs/plans/code-review-findings.md` §1, findings P1–P7, M1–M5, PF4 (parser part).

All P-findings were **re-verified by executing parse→generate roundtrips** against the current build
(`dist/` + committed native bindings) on 2026-07-02. Every one reproduces exactly as described.
This deep-dive also found **ten adjacent defects (N1–N10)**, two of which are worse than the original
findings (N1 produces syntactically *invalid* output; N10 silently reorders files).

---

## 1. Scope & findings addressed

### Re-verified (all confirmed by execution)

| ID | Confirmed behavior |
|----|--------------------|
| P1 | `class C_Foo {...}; prototype Mst_Default(C_Foo) {...};` → **both deleted** from output. Grammar already parses them (`grammar.js:76-92`, node types `class_declaration`/`prototype_declaration`); `declaration-visitor.ts:46-52` simply never handles those node types, so nothing reaches the model or `declarationOrder`. |
| P2 | `func int Cond() { if (Npc_KnowsInfo(other, DIA_X)) { return TRUE; }; return FALSE; };` regenerates as a body containing **only `return FALSE;`**. Root cause: the `if` is consumed into `func.conditions` first; the trailing `return FALSE;` then triggers `triggerConditionRawMode` (`linking-visitor.ts:547-555`) which clears `conditions` but preserves only statements visited **from the trigger point onward** — everything already consumed is dropped. `test/condition-raw-fallback.test.js:126-151` codifies this loss (it only asserts `return FALSE;` survives). |
| P3 | `CreateInvItems(self, ItMi_Gold, Gold_Amount)` → amount `1`; `B_GiveInvItems(..., 0)` → `1`; `Npc_SetRefuseTalk(self, RefuseSeconds)` → `300`; `B_Kapitelwechsel(KAPITEL_NR, ...)` → `1`. All five `parseInt(x) || default` sites confirmed: `action-parsers.ts:198, 207, 216, 243, 261`. Note `0` is falsy, so **literal zeros are also corrupted**, not just identifiers. |
| P4 | `Npc_RemoveInvItem(self, ItMi_Gold)` (the standard 2-arg engine signature) fails the shared `minArgs: 3` check (`action-parsers.ts:324-333`) → `parseSemanticAction` returns `null` → `linking-visitor.ts:479-482` silently records nothing. Statement vanishes. Same failure mode exists for *every* recognized function whose parser can return `null` (e.g. `AI_Output` with <3 args). |
| P5 | `Npc_ExchangeRoutine(self, Routine_Var)` → `"Routine_Var"` (identifier turned into string literal — changed runtime semantics). Confirmed same defect in `AI_PlayAni`, `Wld_InsertNpc`, `B_StartOtherRoutine`, `B_LogEntry` (`npcActions.ts:71, 138, 205, 251`, `inventoryActions.ts`, `semantic-model.ts` LogEntry). Root cause: `normalizeArgumentText` (`argument-parsing.ts:20-25`) strips quotes and discards node type; generators guess. |
| P6 | All standalone comments in function bodies and C_INFO bodies dropped; a standalone comment on the **line after** an `AI_Output` is absorbed as its subtitle (confirmed: `// standalone comment` was appended as `//` comment of the *preceding* line's output). `findCommentAfterStatement` (`action-parsers.ts:355-387`) has no same-line check. |
| P7 | Generating from an errored parse silently emits a `// TODO: Implement function body` placeholder where the broken function's content was. `model.hasErrors` is `true` but `SemanticCodeGenerator.generateSemanticModel` never looks at it. |
| M1/M2 | `cross-references.ts:70` (`cond.dialogRef === dialogName`), `:94-108` (info/cond name compares), `:134-139` (`collectReachableFunctions` lookups) are exact-case in a case-insensitive language → rename/remove cascades miss case-drifted references. |
| M3 | `generator.ts:389` `model.functions[action.targetFunction]` is exact-case → case-drifted choice targets are not clustered. **Sharpened:** the editor calls `generateDialogWithFunctions` (`CodeGeneratorService.ts:45`), which emits *only* the dialog + associated functions — a case-drifted choice target function is **omitted from that output entirely**, not merely re-ordered. |
| M4 | `linking-visitor.ts:798-819` `findDialogForFunction` compares `informationName === functionName` exact-case, and caches hits only. |
| M5 | `b_beklauen()` → `C_Beklauen (0, 0);` confirmed. `PickpocketAction.generateCode` (`npcActions.ts:167`) compares `pickpocketMode === 'B_Beklauen'` exact-case against the source-cased name that `action-parsers.ts:286-290` blindly casts. Also: the `B_Beklauen` branch discards any source arguments. |
| PF4 (parser) | `findDialogForFunction` caches hits but not misses; called from `recordActionForCurrentFunction` per action → O(actions × dialogs) rescans for every function not owned by a dialog. |

### Newly discovered (this pass)

| ID | Finding | Location |
|----|---------|----------|
| N1 | **Quote-stripping produces syntactically invalid output.** `Log_CreateTopic("My Topic", LOG_MISSION)` → `Log_CreateTopic (My Topic, LOG_MISSION);` — reparse of the generated file **hasErrors: true**. Any generator that emits an argument unquoted (CreateTopic, LogSetTopicStatus, ClearChoices, StopProcessInfos, GiveTradeInventory, SetAttitude, Attack, Teach…) corrupts string-literal args this way. Inverse of P5; strictly worse (broken file, not just changed semantics). | `argument-parsing.ts:20-25` + all non-quoting `generateCode` |
| N2 | `B_LogEntry(TOPIC_X, TextConst)` → `B_LogEntry (TOPIC_X, "TextConst");` — identifier arg force-quoted (same class as P5; extra site). | `semantic-model.ts` LogEntry |
| N3 | `CreateTopic`/`LogEntry` `generateCode` emit `\n`-padded output → spurious blank lines accumulate around these calls on every save (formatting churn, blocks byte fidelity). | `semantic-model.ts:264-268, 290` |
| N4 | An empty `func void F() {};` regenerates with an invented `// TODO: Implement function body` comment (the `hasExplicitBodyContent` guard exists only for `int` returns). Generator invents content. | `generator.ts:522-531` |
| N5 | Comments **between top-level statements in raw-mode condition bodies** and **file-trailing comments (EOF)** are dropped; `pendingLeadingComments` is discarded when the following node isn't function/instance/variable (currently including class/prototype — partially fixed by P1). | `declaration-visitor.ts:41-53`, `linking-visitor.ts:521-536` |
| N6 | `byteIdempotenceDrift` is computed but **non-failing** even in `--strict` (`hasFailure` at `roundtrip-corpus.js:495-497` omits it), and `extractModelSummary` covers only dialogs/functions — constants/variables/instances (and classes/prototypes) are invisible to the corpus drift check. | `scripts/roundtrip-corpus.js:79-110, 495` |
| N7 | `DialogLine` always regenerates as `AI_Output (a, b, "id");` — a third arg that was an identifier/expression in source gets quoted (P5 family; also `Choice` already solved this via `textIsExpression` — the fix pattern exists in-repo). | `dialogActions.ts:31` |
| N8 | `parseActionWithArgs` silently truncates *extra* args: any recognized call with more args than the factory consumes drops the tail (e.g. hypothetical 4-arg `Npc_RemoveInvItems` variants). Fallback-to-generic (P4 fix) must also cover "too many args" — safest is to compare `args.length` against an expected exact arity and fall back on any mismatch. | `action-parsers.ts:102-114` |
| N9 | Generated output always inserts a space before `(` in action calls (`AI_Output (`) regardless of source (`AI_Output(`) — pure churn; irrelevant under token comparison but blocks byte fidelity tier. | all `generateCode` |
| N10 | **Generator reorders files:** `generateByDeclarationOrder` (`generator.ts:158-174`) defers any function owned by a dialog until the dialog is emitted, then clusters condition→info→choice-targets. Files whose source order differs (common in real scripts) are silently rewritten in a different declaration order. Also, dialogs without leading comments get a **synthesized section header comment** (`generator.ts:139-141`) — invented content on roundtrip. | `generator.ts:101-243, 353-356` |

Corrections to the original findings: none of P1–P7 was overstated. P5's `"T_STAND"` → `T_STAND` direction was slightly misdescribed — quoted string args to *re-quoting* generators (PlayAni etc.) survive; the strip-without-requote direction actually manifests at the N1 sites and is worse than described.

---

## 2. Fix design per finding

Shared design principle: **fidelity by construction — keep the source token text in the model; parse into
structured fields for the editor, but never regenerate from a lossy projection when the original text is
representable.** The repo already has three working precedents: verbatim `sourceText` on globals,
`Choice.textIsExpression`, and `RemoveInventoryItemsAction.removeQuantity: string`.

### P1 — class / prototype declarations

Files: `src/semantic/semantic-model.ts`, `src/semantic/visitors/declaration-visitor.ts`,
`src/codegen/generator.ts`, `src/semantic/semanticModelInterfaces.ts`.

1. Model: add two verbatim-capture classes modeled on `GlobalInstance`:
   ```ts
   export class GlobalClass { name; sourceText; leadingComments?; position?; range?; }
   export class GlobalPrototype { name; parent; sourceText; leadingComments?; position?; range?; }
   ```
   Add `classes?: { [name]: GlobalClass }` and `prototypes?: { [name]: GlobalPrototype }` to
   `SemanticModel`, and extend the `declarationOrder` union with `'class' | 'prototype'`.
2. `declaration-visitor.ts`: handle `class_declaration` and `prototype_declaration` in
   `createObjectsRecursively` (capture `node.text` as `sourceText`, attach `pendingLeadingComments`,
   push to `declarationOrder`). Add both node types to the root-loop recursion whitelist at lines 46-52
   (today they fall into the `else` branch, which also discards their leading comments).
3. `generator.ts`: extend `lookupGlobalSymbol` / `generateGlobalDeclaration` and the leftover-emission
   loops to the two new types. `sourceText` path only; canonical fallback `class Name {};` /
   `prototype Name(Parent) {};` for hand-built models.
4. Serialization: `deserializeSemanticModel` copies the two new maps (plain-object rehydrate like
   `GlobalInstance`); extend `test/semantic-serialization.test.js`.
5. **Editor (breaking, flag for editor slice):** `daedalus-dialog-editor/src/shared/types.ts:442`
   duplicates the `declarationOrder` union — must add `'class' | 'prototype'`; audit
   `fileStore.ts:434-556` and `projectStore.ts` `mergeSemanticModels` for exhaustive switches on
   `entry.type` (current filters are name-based and tolerate unknown types, but verify with typecheck).

Size: **M**.

### P2 — condition raw-mode fallback must not drop consumed statements

Files: `src/semantic/visitors/linking-visitor.ts`.

Design: on the *first* raw-mode trigger for a function, rebuild the preserved action list **from the
entire function body**, not from the trigger point:

1. `enterDeclarationContext('function_declaration')`: stash `body` node on the visitor
   (`this.currentFunctionBodyNode`).
2. `triggerConditionRawMode`:
   - clear `func.conditions` (as today) **and** remove any actions already recorded for this function
     in this pass — both from `func.actions` and from the owning `dialog.actions` (track the recorded
     action objects per function so removal is identity-based, or record start-index watermarks on
     entry to the function).
   - iterate `this.currentFunctionBodyNode.namedChildren` in order and call
     `preserveConditionStatement(child)` for every top-level statement — this seeds
     `preservedStatementRanges` for the whole body, so the continuing traversal's re-visits dedupe
     naturally (existing mechanism, `linking-visitor.ts:521-536`).
3. Comments between top-level statements: `preserveConditionStatement` iterates `namedChildren`, which
   includes `comment` nodes — preserve them too by emitting a raw `Action(commentText)`? No —
   `Action.generateCode` appends `;`. Instead this is solved by the P6 `CommentAction` (below); until P6
   lands, skip comment nodes exactly as today (no regression).
4. Alternative considered and rejected as primary: storing `func.rawBodySourceText = body.text` and
   emitting it verbatim. It is more byte-faithful (keeps comments + formatting) but creates a dual
   source of truth the editor can silently desync (any visual edit must invalidate it). It is retained
   as the **P6 safety net** (see below) with an explicit invalidation contract, not as the P2 fix.

Replace the loss-codifying assertions in `test/condition-raw-fallback.test.js:126-151` with assertions
that the regenerated body contains **both** the `if (Npc_KnowsInfo(...)) { return TRUE; };` block and
`return FALSE;`, in source order, and reparses cleanly.

Size: **M**. Parser-only; no model-shape change.

### P3 — numeric argument fidelity (identifiers and zeros)

Files: `src/semantic/parsers/action-parsers.ts`, `src/semantic/inventoryActions.ts`,
`src/semantic/npcActions.ts`, `src/semantic/semantic-model.ts` (ChapterTransitionAction).

1. Add a helper in `argument-parsing.ts`:
   ```ts
   export function parseNumericArg(raw: string | undefined, fallback: number): number | string {
     if (raw === undefined || raw === '') return fallback;
     return /^-?\d+$/.test(raw.trim()) ? Number(raw) : raw.trim();
   }
   ```
   Plain integer literals (including `0`) stay numbers; anything else (constant names, expressions)
   keeps its raw text.
2. Widen field types to `number | string`: `CreateInventoryItems.quantity`,
   `GiveInventoryItems.quantity`, `AttackAction.damage`, `SetRefuseTalkAction.seconds`,
   `ChapterTransitionAction.chapter`. Generators already interpolate into template strings, so
   `generateCode` needs no change beyond the type.
3. Replace all five `parseInt(...) || d` sites with `parseNumericArg(args[i], d)` — but note that
   after the P4 fix the arity guarantees mean `args[i]` is always present, so the defaults only apply
   to hand-built models.
4. Serialization is transparent (plain field).
5. **Editor (breaking, flag for editor slice):** `shared/types.ts:82, 90` declare `quantity: number`;
   `CreateInventoryItemsRenderer.tsx:46-47`, `GiveInventoryItemsRenderer.tsx:76-77`,
   `SetRefuseTalkActionRenderer.tsx`, and `actionTemplates.ts` must accept `number | string`
   (display `String(value)`; on change store `Number` iff `/^\d+$/`, else raw string).

Size: **S** parser / **S** editor.

### P4 — arity mismatch → generic Action fallback, never drop

Files: `src/semantic/parsers/action-parsers.ts`.

Single change in `parseSemanticAction`: capture the specific parser's result and fall back:

```ts
const specific = /* existing switch */;
return specific ?? ActionParsers.parseGenericAction(node);
```

`parseGenericAction` preserves the full call text verbatim, so a 2-arg `Npc_RemoveInvItem` roundtrips
byte-identically (it just isn't editable as a structured action — acceptable and safe).
Also (N8): tighten `parseActionWithArgs` to fall back when `args.length` differs from the expected
arity in *either* direction — change `minArgs` to `arity: number | { min; max }` per call site, using
the real engine signatures (e.g. `Npc_RemoveInvItem` = 2, `Npc_RemoveInvItems` = 3 — split the shared
dispatch at `action-parsers.ts:88-90` so each name gets its own arity; 2-arg `Npc_RemoveInvItems`
becomes generic fallback instead of being coerced).

Note `parseActionStatementNode` (`linking-visitor.ts:731-744`, ConditionalAction branches) already
falls back to `preserveUnsupportedStatement` on `null`; after this change `parseSemanticAction` never
returns `null`, which is strictly safer there too.

Size: **S**. Independent; highest value-per-line in the whole plan.

### P5 / N1 / N2 / N7 — quote preservation

Files: `src/semantic/parsers/argument-parsing.ts`, `src/semantic/parsers/action-parsers.ts`,
all action classes with string-ish args (`npcActions.ts`, `inventoryActions.ts`, `dialogActions.ts`,
`semantic-model.ts`).

Strategy — **preserve the raw argument text (including quotes) and emit it verbatim**; keep the
unquoted value only as a derived display field:

1. New API in `argument-parsing.ts`:
   ```ts
   export interface ParsedArg { raw: string; value: string; isString: boolean; }
   export function parseArgumentsDetailed(argsNode): ParsedArg[]
   ```
   `raw` = `node.text.trim()` (quotes intact for strings); `value` = current normalized form;
   `isString` = `node.type === 'string'`.
2. Per affected field, follow the `Choice.textIsExpression` precedent but inverted to raw-first:
   - `ExchangeRoutineAction.routine`, `PlayAniAction.animationName`,
     `StartOtherRoutineAction.routineName`, `InsertNpcAction.spawnPoint`, `LogEntry.text`,
     `DialogLine` third arg, `HeroFollowsAction.guideRoutine`: add optional
     `…IsExpression?: boolean` (true when source arg was **not** a string literal). `generateCode`
     quotes only when the flag is falsy → legacy serialized data (no flag) keeps today's behavior,
     and editor-created actions default to quoting, both backward compatible.
   - Non-quoting generators (`CreateTopic.topic/topicType`, `LogSetTopicStatus.topic/status`,
     `ClearChoicesAction.dialog`, `StopProcessInfosAction.target`, `SetAttitudeAction.*`,
     `AttackAction.attackReason`, `GiveTradeInventoryAction.tradeTarget`, `TeachAction.teachArgs`,
     `PickpocketAction` chances, targets/items everywhere): store **raw** text in the existing field
     (i.e. stop stripping quotes for these — switch their parse sites from `parseArguments` to
     `parseArgumentsDetailed(...).map(a => a.raw)`) and emit verbatim. This fixes N1 (invalid output)
     with no model-shape change; the editor already renders these fields as free text.
   - Where the editor needs the unquoted value for UX (`DialogLine.text` subtitle, `LogEntry.text`),
     keep the current unquoted field + flag combination rather than raw-first.
3. `toDisplayString` implementations keep their current cosmetic quoting (display-only).

Size: **M** parser; **S** editor (renderers for routine/animation fields must stop assuming
quote-free values — flag for editor slice).

### P6 — comment preservation (scoped, with safety net)

Files: `src/semantic/semantic-model.ts`, `src/semantic/visitors/linking-visitor.ts`,
`src/semantic/parsers/action-parsers.ts`, `src/codegen/generator.ts`,
`src/semantic/visitors/declaration-visitor.ts`.

Full positional comment preservation everywhere is L-sized; this plan commits to the highest-value
80% and a safety net, explicitly:

1. **Same-line rule for AI_Output subtitles (S, do first — it is active data corruption):**
   `findCommentAfterStatement` must additionally require
   `nextSibling.startPosition.row === callNode.endPosition.row`. A next-line comment is then a
   standalone comment, not a subtitle.
2. **`CommentAction` for function bodies (M):** new action class
   `CommentAction { text } → generateCode() = text` (no `;`). In `linking-visitor`, when traversing a
   non-condition function body, record a `CommentAction` for every `comment` node whose parent is the
   function's top-level `block` or a `ConditionalAction` branch block (`parseActionsFromBlock`
   currently `continue`s past them — push `CommentAction` instead), **except** comments already
   consumed as an AI_Output subtitle (track consumed comment ranges in a Set, populated by
   `parseAIOutputCall` — requires `findCommentAfterStatement` to return the node, not just text).
   Raw-mode condition bodies get the same treatment inside `preserveConditionStatement`'s body sweep
   (P2 step 2). Serialization: add to the action discriminator list.
3. **C_INFO instance body comments (M):** attach standalone comments to the *following* property:
   `Dialog.propertyLeadingComments?: { [key: string]: string[] }` plus
   `Dialog.trailingBodyComments?: string[]`, captured in `processAssignment` traversal order;
   `generateDialog` emits them before the property line / before `};`. Trailing same-line property
   comments (`npc = X; // note`) are captured with the same same-line sibling check and stored as
   `propertyTrailingComments`.
4. **File-level (S):** `declaration-visitor` root loop currently discards `pendingLeadingComments`
   when the next sibling is not a handled declaration and at EOF. Add `model.trailingComments?:
   string[]` (emitted last by the generator) and stop clearing pending comments for node types that
   become handled via P1.
5. **Safety net (verbatim body fallback):** if, after 1–4, the fidelity corpus still shows comment
   loss inside constructs we do not structurally represent, add
   `DialogFunction.rawBodySourceText?: string` captured at parse time whenever the body contains a
   comment (or any node) that pass 2 did not map to a model object, and have
   `generateFunction` prefer it under `preserveSourceStyle`. **Contract for the editor workspace
   (breaking-behavior flag):** any mutation of `func.actions`/`conditions` must set
   `rawBodySourceText = undefined`, otherwise edits would be silently ignored. This is the documented
   fallback if the structural work overruns; it is *not* the primary plan.
6. N4 fix rides along: never emit the `// TODO: Implement function body` placeholder when
   `preserveSourceStyle && hasExplicitBodyContent === false` (extend the existing int-only guard at
   `generator.ts:522-531` to void).

Size: **M–L** overall (1 and 4 are S; 2 and 3 are M; 5 only if needed).

### P7 — hasErrors guard in the generator

Files: `src/codegen/generator.ts`, `src/semantic/semanticModelInterfaces.ts` (options type), `API.md`.

`generateSemanticModel(model)` throws when `model.hasErrors` is truthy unless the caller opts in:

```ts
if (model.hasErrors && !this.options.allowPartialModel) {
  throw new Error(`Refusing to generate code from a model with ${model.errors?.length ?? 0} parse error(s); pass allowPartialModel: true to override.`);
}
```

Add `allowPartialModel?: boolean` (default `false`) to `CodeGeneratorOptions`. Scope the guard to the
whole-model entry point only (`generateSemanticModel`), not `generateFunction`/`generateDialog`
(hand-built partial models are legitimate there). **Editor flag:** `CodeGeneratorService.ts:27/45`
will now reject via the existing IPC try/catch; the editor save flow must surface that error instead
of swallowing it — this pairs with editor finding E3 (slice 2) and must land in the same release as
the editor-side handling, otherwise auto-save on errored files goes from "silently corrupts" to
"silently fails"; the latter is still strictly better, but the UX belongs to slice 2.

Size: **S**.

### M1–M5 + PF4 — case-insensitive cross-references and clustering

Files: `src/semantic/cross-references.ts`, `src/codegen/generator.ts`,
`src/semantic/visitors/linking-visitor.ts`, `src/semantic/parsers/action-parsers.ts`,
`src/semantic/npcActions.ts`.

1. Shared helpers (new, in `cross-references.ts` or a tiny `src/semantic/name-utils.ts`):
   `namesEqual(a, b)` (lowercase compare) and
   `resolveCaseInsensitive<T>(map: Record<string, T>, name: string): T | undefined` that builds/uses a
   lazily cached lowercase index (cache keyed per-map via WeakMap so recreated models stay correct).
2. `cross-references.ts`: switch the compares at lines 70, 94-108, and `collectReachableFunctions`
   (visited set + `model.functions` lookup keyed by lowercase, return canonical names as found in the
   model) to the helpers. (M1/M2)
3. `generator.ts` `getAssociatedFunctions` (line ~389) and `buildFunctionToDialogMap`: resolve
   `action.targetFunction` via `resolveCaseInsensitive(model.functions, …)`. Fixes both clustering
   drift and the `generateDialogWithFunctions` function-omission for the editor. (M3)
4. `linking-visitor.ts` `findDialogForFunction`: compare via `namesEqual`; change the cache to
   `Map<string, Dialog | null>` keyed by lowercase name and **cache misses** too; additionally
   pre-populate `functionToDialog` in `collectConditionFunctionNames` (it already walks every
   instance body — also record `information = X` assignments there), making the O(dialogs) fallback
   scan nearly dead. (M4 + PF4)
5. `PickpocketAction` (M5): decide the mode in the parser by `dispatchKey` (`'b_beklauen'` → mode
   `B_Beklauen`), and add `sourceFunctionName: string` (original casing) + preserve source args for
   the `B_Beklauen` branch. `generateCode` emits `${sourceFunctionName ?? pickpocketMode} (${rawArgs});`.
   Deserialization fallback: absent `sourceFunctionName` → current behavior.
6. Do **not** normalize `Choice.targetFunction` casing at parse time — source casing is fidelity;
   lookups become tolerant instead.

Size: **M**. Parser-only; editor benefits automatically via `generateDialogWithFunctions`.

### N10 — declaration-order fidelity in the generator

Files: `src/codegen/generator.ts`.

When `declarationOrder` is present (i.e. the model came from a parse), emit **strictly in
declarationOrder** and skip the dialog-clustering pull-forward (`generator.ts:158-174` `continue`
branch) — every function has its own order entry, so clustering only rearranges. Keep clustering for
entries missing from the order (editor-created content, legacy models) — i.e. clustering becomes the
fallback path, not an override. Similarly, synthesize section headers only when the dialog has no
order entry (`generator.ts:139-141`), so parsed files never gain invented header comments.

Size: **S–M** (behavioral change: update `semantic-code-generator.integration.test.js` expectations
that rely on clustering for parsed input).

---

## 3. Corpus redesign — from idempotence to source fidelity

File: `scripts/roundtrip-corpus.js` (+ new `test/fixtures/corpus/`).

### Why the current check is blind

`analyzeFile` compares the **source model** to the **generated-then-reparsed model**. Every P1–P6 loss
happens *at first parse* (the source model itself already lacks the data), so both sides agree and CI
is green. `byteIdempotenceDrift` exists but is excluded from the strict failure condition
(`roundtrip-corpus.js:495-497`), and `extractModelSummary` ignores globals entirely (N6).

### New measurement: three tiers

**Tier 1 — token fidelity (strict, failing):** compare *original source text* to *generated text* as
token streams.

- Implementation: `tokenStream(text)` = tree-sitter parse → in-order leaf tokens (named leaves +
  anonymous tokens), each contributing its exact text; `comment` nodes contribute their text with
  trailing whitespace trimmed. Compare the two arrays; on first divergence report file, token index,
  and ±5 tokens of context into the details JSON.
- **Normalized (ignored):** line endings, all inter-token whitespace (indentation, blank lines,
  alignment, space-before-paren), trailing whitespace, BOM.
- **Byte-stable (must match exactly):** identifier spelling *including case*, numeric literal text,
  string literals *including quotes*, operators/punctuation, comment text, and **token order** —
  which makes N10 (reordering) and invented content (section headers, TODO placeholders, N3 blank
  lines are whitespace-normalized away but the header/TODO tokens are not) hard failures.
- Skip files where the *source* parse `hasErrors` (as today: `source_syntax_error` status).
- Generator config for the corpus run: `{ includeComments: true, sectionHeaders: false,
  preserveSourceStyle: true }`.

**Tier 2 — byte fidelity (reported, ratcheting):** `normalizeLineEndings(source) ===
normalizeLineEndings(generated)` per file; reported as `byteFidelityDriftFiles`. Non-failing at
introduction; once Tier 1 is green across fixtures, add `--fail-byte-drift` and turn it on in CI for
the fixture corpus (indentation preservation is the remaining gap — track as follow-up, not this
plan).

**Tier 3 — keep the existing semantic-model drift + idempotence checks** (they catch generator
nondeterminism and reparse divergence Tier 1 can't attribute), and extend `extractModelSummary` to
include constants/variables/instances/classes/prototypes name sets (N6).

`--strict` failure condition becomes: Tier 1 drift ∨ generated syntax errors ∨ Tier 3 drift ∨
choice-target increase.

### Fixture strategy for CI

The real MDK corpus is gitignored (licensing) — commit a **synthetic fixture corpus** at
`daedalus-parser/test/fixtures/corpus/` (~20 small `.d` files, hand-written, MIT-safe), one file per
construct family so failures localize:

- `class-prototype.d` (P1), `condition-idioms.d` (P2: trailing `return FALSE`, else-branch, local
  vars, mixed `&&`/`||`), `numeric-args.d` (P3: constant names, `0`, negative literals),
  `arity-variants.d` (P4/N8: 2-arg RemoveInvItem, short AI_Output), `quoting.d` (P5/N1/N2/N7: every
  recognized action with both identifier and string-literal args), `comments.d` (P6/N3/N5: leading,
  inline, next-line standalone, between raw statements, EOF), `case-drift.d` (M1–M5: `b_beklauen`,
  lowercase info/condition/choice refs), `declaration-order.d` (N10: info func before condition func
  before instance), `globals.d`, `items-npcs-mds.d`, `encoding-1252.d` (umlauts, checked in as
  windows-1252 bytes), plus the two existing smoke fixtures promoted from inline strings to files.
- `test/roundtrip-corpus-smoke.test.js` grows an assertion set: runs the script against the fixture
  corpus with `--strict` and asserts `tokenFidelityDriftFiles === 0` (this is the *red test* that
  drives the whole plan — see §4).
- CI: this plan **prepares** the job (script + fixtures + smoke test run inside the normal
  `parser-tests` job, so it gates PRs immediately); flipping the standalone `roundtrip-corpus`
  workflow job from `if: false` to fixture-corpus mode is slice 8's call, and it should additionally
  keep the `--root` override so maintainers can run the real MDK corpus locally
  (`npm run test:roundtrip-corpus -- --root <mdk path>`).

---

## 4. Test plan (TDD order — every fix starts red)

New/changed test files in `daedalus-parser/test/`:

1. **`roundtrip-corpus-smoke.test.js` + `scripts/roundtrip-corpus.js` + fixtures** *(write first)* —
   add Tier 1 token-fidelity to the script, commit fixtures, assert zero token drift. This single
   test is red for P1–P6, M5, N1–N5, N7–N10 simultaneously and goes green incrementally as fixes
   land; run it with `--max-files`/per-fixture filtering locally to focus. (To keep the suite usable
   mid-plan, the smoke test asserts per-fixture expectations: initially only fixtures whose fixes
   have landed are in the strict set; the ratchet list shrinks to "all" by the end. The ratchet is a
   plain array in the test file — reviewable, no hidden skips.)
2. **`class-prototype-roundtrip.test.js`** (new, P1): parse class+prototype+var file → model has
   `classes`/`prototypes` entries with `sourceText` + `declarationOrder` entries; generated output
   token-equal; serialization roundtrip.
3. **`condition-raw-fallback.test.js`** (P2): *replace* the assertions at :126-151 — regenerated body
   must contain the `if` block **and** `return FALSE;` in order, reparse cleanly; add an
   interleaved case (`if … ; AI_Output(...); if …; return FALSE;`) asserting full-body preservation
   and no duplicated statements (dedup ranges).
4. **`action-argument-fidelity.test.js`** (new, P3/P4/P5/N1/N2/N7/N8): table-driven — for each
   recognized action, roundtrip with (a) identifier args, (b) string-literal args, (c) zero/large
   literals, (d) wrong arity → assert generated text token-equal to source; explicitly:
   `CreateInvItems(self, ItMi_Gold, Gold_Amount)`, `B_GiveInvItems(…, 0)`,
   `Npc_SetRefuseTalk(self, RefuseSeconds)`, `Npc_RemoveInvItem(self, ItMi_Gold)`,
   `Npc_ExchangeRoutine(self, Routine_Var)`, `Log_CreateTopic("My Topic", LOG_MISSION)` (and that the
   output **reparses without errors**), `B_LogEntry(TOPIC_X, TextConst)`.
5. **`comment-preservation.test.js`** (new, P6/N3/N4/N5): same-line vs next-line AI_Output comment;
   standalone comments in info-function bodies survive as `CommentAction` and regenerate in place;
   C_INFO property leading/trailing comments; EOF comments; empty void function does not gain a TODO.
6. **`semantic-error-handling.test.js`** (extend, P7): `generateSemanticModel` on `hasErrors` model
   throws; `allowPartialModel: true` generates; `generateFunction` unaffected.
7. **`case-sensitivity.test.js` / `cross-references.test.js`** (extend, M1–M5/PF4):
   `findDialogReferences`/`findFunctionReferences`/`collectReachableFunctions` with case-drifted
   names; `generateDialogWithFunctions` includes a case-drifted choice target;
   `b_beklauen(10, 20)` roundtrips byte-identically; `findDialogForFunction` miss-caching covered by
   a behavior test (function not owned by any dialog + many dialogs — assert correctness; perf is
   asserted structurally by the miss-cache unit test, not timing).
8. **`semantic-serialization.test.js`** (extend): new fields (`classes`, `prototypes`,
   `sourceFunctionName`, `…IsExpression` flags, `CommentAction`, `number | string` quantities)
   survive serialize→deserialize→generate.
9. **`semantic-code-generator.integration.test.js`** (update, N10): parsed models emit in
   declarationOrder; clustering still applies to models without order entries.

Editor workspace (separate PR, flagged): update `shared/types.ts`, the three renderers, and
`actionTemplates.ts` for `number | string`; Jest tests in the editor for renderer round-typing;
`CodeGeneratorService` error propagation test (pairs with slice 2/E3).

Completion gate per repo rules: `npm test`, `npm run lint`, `npm run typecheck` in
`daedalus-parser`; editor PR runs its own suite + `typecheck:renderer`.

---

## 5. Ordering, dependencies, risks

### Order

| Step | Fix | Size | Depends on | Model shape change (editor impact) |
|------|-----|------|-----------|-------------------------------------|
| 0 | Corpus Tier-1 harness + fixtures (§3, red) | M | — | none |
| 1 | P4 arity fallback (+N8) | S | — | none |
| 2 | P7 hasErrors guard | S | — | **behavioral**: editor must handle throw (pair with slice 2 / E3) |
| 3 | P3 numeric fidelity | S | 1 (arity guarantees) | **breaking**: `quantity`/`seconds`/`damage`/`chapter` → `number \| string` (`shared/types.ts:82,90`, 3 renderers, templates) |
| 4 | P5/N1/N2/N7 quoting | M | — | additive optional flags; editor renderers for routine/ani fields should be reviewed |
| 5 | P2 raw-mode full-body preservation | M | — | none |
| 6 | M1–M5 + PF4 case-insensitivity | M | — | none (fixes an editor-facing bug in `generateDialogWithFunctions`) |
| 7 | P1 class/prototype | M | — | **breaking**: `declarationOrder` union in `shared/types.ts:442`; new model maps additive |
| 8 | N10 order fidelity + header suppression | S–M | 7 (order entries for all types) | generation-order change; editor snapshot tests may need updates |
| 9 | P6 comments (steps 1→4, then safety net only if corpus still red) | M–L | 5 (raw-mode body sweep), 8 | additive (`CommentAction` in action lists — editor `ActionsList` must render/ignore it gracefully: flag) |
| 10 | Flip fixture corpus to fully strict; hand off CI job re-enable to slice 8 | S | all | none |

Steps 1–7 are mutually independent and can be parallelized; only 8 and 9 have real dependencies.

### Risks

- **Editor desync on model-shape changes (steps 3, 7, 9):** the editor duplicates parser types in
  `src/shared/types.ts` instead of importing them; each flagged change needs a coordinated editor PR
  or the renderers silently mistreat values. Mitigation: land parser + editor type changes in the
  same monorepo PR; editor `npm run typecheck:renderer` is the tripwire.
- **P7 throw vs. editor auto-save (step 2):** until slice 2 lands, an errored file's auto-save will
  fail with a rejected IPC promise instead of writing corrupted output. Verify the editor doesn't
  loop-retry noisily; if it does, land P7 and the E3 fix together.
- **Serialized-model backward compatibility:** quest editor and history snapshots persist model JSON.
  All new fields are optional with legacy-preserving defaults (documented per fix above); the
  serialization test (§4.8) is the gate.
- **N10 ordering change** may alter output for editor-created dialogs whose functions *do* have order
  entries; integration tests must pin the intended behavior (order wins when present, clustering
  otherwise).
- **Token comparator false negatives:** tree-sitter may tokenize the same text differently across
  error-recovery paths; mitigated by only comparing files whose source parses clean, and by Tier 3
  remaining active.
- **P6 scope creep:** bounded by the explicit 80% scope + the verbatim-body safety net with its
  editor invalidation contract; if the safety net ships, it must be listed in the editor slice as a
  mutation-contract task.

### Explicit editor-workspace flag list (for cross-slice coordination)

1. `shared/types.ts:82,90` quantity types; `:442` declarationOrder union.
2. `CreateInventoryItemsRenderer.tsx`, `GiveInventoryItemsRenderer.tsx`,
   `SetRefuseTalkActionRenderer.tsx`, `actionTemplates.ts` — `number | string` handling.
3. `CodeGeneratorService.ts` — handle `allowPartialModel` guard throw (with E3 in slice 2).
4. `ActionsList.tsx` / action renderers — render (or pass through) `CommentAction`.
5. If the P6 safety net ships: all model mutation paths must clear `rawBodySourceText`.
