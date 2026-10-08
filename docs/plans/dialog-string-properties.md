# Dialog string properties carry text, not source

A dialog's `description` reaches the editor as source text: `description = "Hallo du";`
is stored as `'"Hallo du"'`. The Properties field binds to that value, so the
quotes are user-facing. Deleting the closing quote leaves `"Hallo du`, which
`descriptionFromInput` no longer recognises as quoted, and so it wraps it again:
`""Hallo du"`. The collapsed chip, the dialog tree label, search results and the
delete confirmation show the raw value too.

## Diagnosis

The quotes are standing in for the property's *kind* (string or expression),
which the model already records separately:

- `linking-visitor.ts` `processAssignment` stores `node.text` for a `string` node
  and pushes the key onto `propertyLiteralKeys`; identifiers and expressions go
  onto `propertyExpressionKeys`. Both lists survive JSON and `Dialog.fromJSON`.
- `source-value.ts` already has the right shape — `SourceValue` is
  `{ kind: 'string', value } | { kind: 'expression', source }`, and dialog
  actions (`DialogLine.text` + `textIsExpression`) store unquoted contents.
  Dialog properties are the one place that does not.

Because the value is still quoted, every consumer compensates:
`generator.ts` `formatDialogPropertyValue` slices the quotes off a literal and
re-renders it; `descriptionSync.ts` strips them (`descriptionText`), adds them
(`descriptionFromLine`), and **guesses the kind from the text**
(`descriptionFromInput`: quoted → keep, `DIALOG_ENDE`-shaped or a declared
constant → bare, else quote). The editor never touches either key list; the
quotes are how it tells the generator what kind it meant. The guess is what
produced `""Hallo du"`.

Daedalus strings cannot contain `"` (`renderSourceValue` throws), so stripping
one pair of quotes from a string literal's token is unambiguous and lossless.

## The change

**Representation.** `properties.description` holds the string's contents for a
literal and the source text for an expression. The kind lives only in
`propertyLiteralKeys` / `propertyExpressionKeys`. No new property type: putting
`SourceValue` objects into `properties` would widen the
`string | number | boolean | DialogFunction` union every consumer switches on.

Every step is TDD: a failing test first.

### Parser (`daedalus-parser`)

1. `processAssignment`: for a `string` node store `node.text.slice(1, -1)`
   (not `normalizeArgumentText` — contents must be exact for round-trip).
   Test: `description = "Hallo du";` parses to `'Hallo du'` with the key in
   `propertyLiteralKeys`; generation is byte-identical.
2. `formatDialogPropertyValue`: a literal key renders `renderStringValue(value)`
   with no quote-slicing. Expression keys stay verbatim (#341).
3. `Dialog.fromJSON` migration, **before** `linkPropertiesToFunctions`: a
   literal-keyed value, or a legacy-JSON value (no `propertyLiteralKeys`), that
   is wrapped in `"` is unwrapped and marked literal. Two reasons it must run
   first: an unquoted literal whose text equals a function name would otherwise
   be linked as a function reference; and `sourceBody.propertyValues` must be
   migrated the same way, or a preserved C_INFO body (#340) with a quoted
   baseline fails generation as "changed properties" after rehydration.
4. Docs: `API.md` (property values of literal keys are contents), and a short
   section in `docs/architecture/parser-fidelity.md`.

Verify: `npm test`, `npm run lint`, `npm run typecheck`, and root
`npm run test:roundtrip-corpus` (strict) — the corpus is the proof that step 1
loses nothing.

### Editor (`daedalus-dialog-editor`)

5. `shared/types.ts` `Dialog`: add `propertyLiteralKeys?` /
   `propertyExpressionKeys?` so the renderer can set the kind.
6. `descriptionSync.ts`: `descriptionText` and the quote-adding half of
   `descriptionFromLine` go; `followFirstLine` writes plain text. Only a
   literal description can be in sync with the first line.
   `descriptionFromInput`'s guessing goes — see the open decision.
7. `DialogPropertiesSection`: the field and chip show the value as stored; an
   edit writes text and keeps the key in `propertyLiteralKeys`.
8. `useDialogFactory`: a new dialog's description is marked literal (the
   renderer builds plain JSON, not a `Dialog`, so the class default
   `['description']` does not apply).
9. `mockAPI.ts` mirrors the parser: unquote string literals on read, mark them,
   quote literal keys on write. Otherwise browser-harness specs test a
   different contract from the real parser.
10. Tree label, search, delete dialog: correct for free once the value is text;
    no code change expected, covered by an assertion in the E2E below.

Tests: `DialogPropertiesSection.test.tsx` (its typed-description table becomes
the kind contract), `fileStore.descriptionSync.test.ts` (expects `'Hallo
Fremder'`, not `'"Hallo Fremder"'`), and a Playwright change in
`tests/e2e/description-sync.spec.ts`: the field reads `Hallo du`; deleting the
last character and blurring leaves `Hallo d` with no stray quote, and the saved
file contains `description = "Hallo d";`. Mock models that seed
`description: '"…"'` keep working through step 3's migration; update them to
plain text anyway so they show the contract.

Verify: editor `npm test`, `npm run lint`, `typecheck:renderer`, and the
description, teacher and trader E2E specs.

## Open decision — how a constant description is entered

With the guess gone, `description = DIALOG_ENDE;` needs a way in. Recommended:
the field keeps the kind it has (an expression edits as source, a literal as
text), and a small Text/Constant switch changes it, with Constant using the
already-defined but unused `AUTOCOMPLETE_POLICIES.dialogProperties.description`
(string constants, `DIALOG_` prefix). The alternative is to keep a narrower
guess (a declared constant only).

## Out of scope — the same pattern elsewhere

`GlobalConstant.value` keeps its quotes too, and six renderer sites strip them by
hand: `QuestList.tsx`, `QuestPicker.tsx`, `LogEntryRenderer.tsx`,
`quest/domain/analysis.ts` (twice), `npc/npcVisual.ts`, `npc/npcForm.ts`. That is
a separate change with a wider blast radius (quest topics, NPC fields); file it
as its own issue rather than folding it in here.
