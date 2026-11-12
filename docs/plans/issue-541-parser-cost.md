# #541 — linking cost and editable-model payload

Status: implementation plan; no runtime changes. Issue: #541.

## Recommended cut

Two independently verifiable changes: reduce linking work without changing the
parser's output, then omit detailed call sites from editor/renderer transport.
Keep `calls`: it is small and used by Problems and quest detection. Keep the
parser library's public `callSites` contract; changing every library consumer is
not necessary to stop sending index-only data to the renderer.

The transport decision below is a recommendation, not an already-settled API
change. Do not close #541 after another small speedup without measuring the
remaining cost.

## What the current code requires

- `LinkingVisitor.enterDeclarationContext` indexes the whole function body with
  `recordCallSitesInSubtree`, then projects actions/conditions separately.
  The index includes calls in initializers, return/assignment expressions,
  conditions, nested arguments and raw statements. Projection deliberately
  skips some of those subtrees. Simply deleting the sweep loses references.
- The sweep already uses cursor types and only materializes calls. The remaining
  projection walk still materializes every visited node; statement helpers use
  `namedChildren`, field lookups, repeated text reads and argument parsing.
  `parseArgumentsDetailed` also uses indexed child access and reads argument
  text more than once. These are candidates to measure, not independent reasons
  to rewrite every helper.
- All production editor `callSites` reads are in `semanticMetadataUtils.ts`:
  waypoint/spawn/routine/exchange extraction and routine-wrapper derivation.
  `scripts/check-routine-coverage.js` also reads the parser output directly.
- `ProjectService` indexes metadata-worker models and primes its parsed-model
  cache. `main.ts` returns models through `parser:parseSource`,
  `project:parseDialogFile` (cached and uncached), and `project:indexFile`.
  The last one must compute its index before stripping call sites.
- The parser worker and metadata worker currently serialize whole models.
  `Dialog.toJSON` already prevents duplicate function bodies (#443); preserve
  that ownership. Hydration defaults absent `callSites` to `[]`.
- Preserve #538's 256-level conditional/call limits and error locations, duplicate
  declaration rejection, comment/subtitle ownership, source spelling, source
  ranges and ordering. These protect save fidelity, not just indexing.

## 1. Establish a reproducible baseline

Use the current checkout, not the original audit's seventeen-times ratio.
Add one small parser measurement script with an explicit corpus-root argument;
reuse corpus file/encoding conventions from `scripts/roundtrip-corpus.js`.
Measure parse, pass 1, pass 2, JSON encode/decode, hydration and generation
separately. Include model/source UTF-8 bytes, call-site share and peak memory;
report warm repeated medians, runtime versions, corpus identity and file counts.
Do not put wall-clock assertions in unit tests.

Run fixtures and the MDK script corpus, including large startup and dialog
files. Compare baseline/candidate on the same machine and corpus. The documented
`tools/gmbt/mdk/` directory was absent during planning; obtain an explicit corpus
location before claiming an MDK result. Do not extract or modify a game install
as part of this change. Full fidelity corpus runs remain in CI; the requested
MDK performance measurement is a separate maintainer run.

Save baseline serialized models/generated output for differential checks, not
as committed copies of retail scripts. Record results in the audit reference.

## 2. Reduce pass-2 work, preserving output

1. Extend focused tests first: source-order, exactly-once call indexing across
   nested arguments, local initializers, returns, assignments, guard expressions
   and raw condition bodies; confirm those calls do not become extra actions.
   Cover comments/numeric spelling and nesting limits alongside existing cases.
2. Build function-body traversal around cursor types. Materialize nodes only
   where projection or indexing needs them. Separate whether a subtree needs
   semantic projection from whether it needs call indexing: a raw/skipped
   subtree must still receive an index-only cursor traversal.
3. Combine indexing and projection scheduling so semantic branches do not also
   receive an unconditional full-body sweep. Existing condition/conditional
   helpers must participate or explicitly hand off index-only coverage; retain
   the old sweep until every skipped path is accounted for. Preserve pre-order
   calls and the nested-call bound even under raw statements.
4. Reuse parsed call arguments for action extraction and call-site recording
   within one function build. Prefer passing the already-parsed arguments
   through existing action helpers; any cache must be build-local, not global
   or attached to the serialized model. Keep standalone action-parser calls
   working. Read argument text once and iterate children with a cursor if the
   new profile still identifies that helper as material.
5. Re-profile before touching formatting/comment helpers. Stop when remaining
   work is necessary extraction; do not create a second AST or a generic visitor
   framework. Require byte-identical model JSON and generated output against the
   baseline on supported inputs, and unchanged errors on rejected inputs.

Report absolute and percentage gains for pass 2 and end-to-end project loading;
do not substitute a lower pass-2/parse ratio for an actual time improvement.
If cursor scheduling does not materially beat the current implementation,
record the result and revisit the proposal instead of landing complexity.

## 3. Keep detailed sites on the indexing side of IPC

Start at the main-to-renderer boundary, not with a new parser mode or worker
protocol. Add one shared editor projection that omits function `callSites` from
an already-plain model without mutating cached/indexing models. Preserve all
other fields, including `calls` and fidelity metadata. Reuse unchanged nested
objects rather than JSON-cloning the full model again.

Apply it to all three model-return paths in `main.ts`, including cached
`project:parseDialogFile` and the model inside `project:indexFile`. Internal
`ParserService` consumers and metadata workers retain complete parser models;
compute project/per-file indexes before projection. This removes detailed sites
from renderer state, hydration and subsequent model-based validation/generation
requests without reparsing source or breaking main-process indexing.

Keep the existing optional shared field for compatibility; old/full payloads
must still hydrate and generate. Renderer-created routine fixtures can retain
empty arrays. No need to delete the parser field, compress position numbers or
remove `calls`.

This deliberately leaves call sites on the worker-to-main hop. Measure that
remaining cost explicitly; if it still dominates, design a worker result with
separate indexing data before claiming the entire serialization problem solved.
Do not silently enlarge this change into a new index architecture.

## Scope and verification

- Parser: `linking-visitor.ts`, `argument-parsing.ts`, relevant action/condition
  helpers and their callers; focused linking, argument, condition/raw-fallback,
  conditional and nesting tests. Public exports/config/grammar need no change
  unless implementation introduces an actual public signature change.
- Editor: `main.ts`, the shared payload projection and IPC tests covering all
  return paths; `ProjectService.test.ts`, per-file indexing tests, and
  `CodeGeneratorService.test.ts` to prove a stripped model saves identically.
  Assert complete original models survive projection, nested sites still reach
  the index, and compact output omits sites without omitting `calls`.
  Keep `parserWorkerModelPayload.test.ts` green: internal worker models still
  follow #443's serialization contract.
- Benchmark: small self-check on known input plus before/after measurements;
  report source/model/renderer bytes separately. The historic 47% call-site
  share is not a promised reduction on every corpus.
- Rebuild parser TS before editor tests. Run touched parser/editor tests, each
  affected package's lint/types, and all three editor typechecks. No new UI
  workflow, dependency, grammar/native rebuild or browser spec is needed.
- Update `docs/reference/parser-review-2026-11-10.md` findings 4–5 with current
  results and the transport decision; update applicable API documentation only
  if its contract changes. Add the #541 release-note line when runtime work
  lands, run `npm run docs:check`, and remove this plan once completed. Keep the
  issue open for any measured remainder rather than claiming partial work fixes
  the whole issue. Do not change priority/decision labels as part of execution.

## Risks / non-goals

The main risk is missing calls while unifying walks, or dropping source metadata
and changing a save. Differential checks and index/save regressions are gates.
No attempt to make a fidelity-rich model smaller than source, remove all node
marshalling, redesign generation, or remove public parser fields. No speedup has
been measured in this planning session.
