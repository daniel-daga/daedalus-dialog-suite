# Parser review — 2026-10-03

Reviewed `daedalus-parser/` at `b2a31ab29179c853948967902a8e9e9eb20b6a4f`.
Repository reads and writes use the GitHub connector; no direct HTTPS checkout.
Four findings remain open below (#341–#344). Finding 1 (#340), the lossy
C_INFO constructor projection, is resolved by preserving complete executable
bodies across the model, JSON hydration and generation. Its root cause,
regression evidence and editing contract now live in
[parser-fidelity.md](../architecture/parser-fidelity.md#c_info-constructor-projection-boundary-340).
The original five-finding report remains in commit
`072b3122723bf12f050c262dedd574d71886077d`.

## Finding 2: source style and expression types

**#341, P2.** `preserveSourceStyle: false` converts `nr = BASE + 2;` into
`nr = "BASE + 2";`. `formatDialogPropertyValue` in
`src/codegen/generator.ts` only honors `propertyExpressionKeys` when style
preservation is enabled. Expression identity must be independent of formatting.
The editor's `CodeGeneratorService` currently sets the option to true; this
finding affects the public generator option.

## Finding 3: shared function emission

**#342, P2.** A model without `declarationOrder`, with two dialogs referencing
one information function, emits that function twice. `generateDialogSection`
in `src/codegen/generator.ts` records `processedFunctions` but does not check
it before output. Parsed models normally use the ordered path; programmatically
built models use the affected clustering fallback.

## Finding 4: overlapping NPC edits

**#343, P2.** With `level = 1;`, a batch setting the same field to `2` and
then `100` emits `level = 200;`. In `src/semantic/npc-definition.ts`,
`applyNpcEdits` applies overlapping splices against original ranges after an
earlier replacement has changed the content. Overlaps need explicit rejection
or a documented conflict-resolution rule.

## Finding 5: assignment comments

**#344, P3.** `x /*keep*/ = 1;` emits `x = 1;` even with
`includeComments: true`. `processFunctionAssignment` in
`src/semantic/visitors/linking-visitor.ts` retains operands and operator, but
not comments between them. This is source-fidelity loss, not an established
change in runtime behavior.

## Initial validation and limits

All five reproductions were confirmed using the committed generated native
grammar, Tree-sitter 0.21 runtime sources, and the current TypeScript semantic
and generator code in an adapted local harness. All 44 existing generator unit
and integration tests passed in that harness. This did not verify the production
Node binding, decorators, or JSON hydration.

The standard commands were attempted but could not run: `npm test` lacked
`tree-sitter`, `npm run lint` lacked `eslint`, and `npm run typecheck` lacked
`tsc`. No Gothic engine, licensed MDK corpus or Electron validation was performed.
These are limits on the validation claim, not additional product findings.
