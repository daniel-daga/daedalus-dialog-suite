# Dialog Simulator — Code Review Findings

Review of the dialog playthrough simulator feature (commits `f7ed1a2` "feat(editor):
add dialog simulation engine" and `085d795` "Integrate dialog playthrough simulator
into editor"). Scope: `daedalus-dialog-editor/src/renderer/simulator/` (domain +
application), `src/renderer/components/Simulator/SimulatorDialog.tsx`, the
`DialogDetailsEditor` integration, the Jest/Playwright suites, and
`docs/architecture/dialog-simulator.md`.

Status legend: **Open** — no fix landed yet. Only M2 is still open.

---

## Summary

The architecture is clean and the interpreter itself is well built: the domain
layer honors the documented no-React/no-store boundary, three-valued condition
logic is correct and directly tested, state is defensively cloned, execution has
a budget guard and explicit termination reasons, and Back/Restart via deep
snapshots is simple and correct.

The gap is between this interpreter and the data the parser actually feeds it.
All simulator tests hand-build `DialogFunction` objects with clean `conditions`
arrays; nothing exercises real parser output for common condition-function
shapes — and that is exactly where the two high-severity findings live. Until
those are fixed, availability results are untrustworthy for typical real-world
scripts.

---

## High severity

### H1. Raw-mode condition functions evaluate as crisply "available" — silently wrong, not unknown

**Status:** FIXED 2026-08-29 — `dialogAvailability.ts` now reports a condition
function with no conditions and a non-empty `actions` body as unknown
("is not structurally analyzable"), which is the raw-mode signature. It is the
only place the simulator trusts `conditionFunction.conditions`. An empty
condition function with an empty body stays crisply available; both cases are
covered in `tests/simulatorDialogAvailability.test.ts`.

The parser's linking visitor bails to "raw mode" for any condition function
containing a non-trivial top-level `return`, a local `var` declaration, or an
`if/else` — and raw mode clears `conditions` to `[]`
(`daedalus-parser/src/semantic/visitors/linking-visitor.ts:656`). These shapes
are extremely common; the repo's own corpus fixture
`daedalus-parser/test/fixtures/corpus/condition-idioms.d` contains two of them:

```daedalus
if (Npc_KnowsInfo (other, DIA_Foo)) { return TRUE; };
return FALSE;                       // -> raw mode, conditions = []

var int ok; ...                     // -> raw mode, conditions = []
```

The simulator evaluates that empty list in
`src/renderer/simulator/domain/dialogAvailability.ts:64` via `combine([], 'AND')`,
which returns **true** (`conditionEvaluator.ts:120`). A dialog gated on prior
knowledge therefore shows as plainly available on a fresh session — no unknown
badge, no reason, selectable. This directly contradicts the feature's own
invariant ("Unknowns are never silently coerced",
`docs/architecture/dialog-simulator.md`).

**Suggested fix (simulator-side, self-contained):** treat a condition function
with empty `conditions` but non-empty `actions` as unknown ("condition function
is not structurally analyzable"). A fully structured condition function has
extracted conditions and zero actions; raw mode always leaves the preserved
body behind as actions, so the two states are distinguishable. Apply the same
guard in `dialogAvailability.ts` and anywhere else `conditionFunction.conditions`
is trusted to be complete.

### H2. `!Npc_KnowsInfo(...)` is extracted as a positive condition — availability is inverted

**Status:** FIXED 2026-08-29 — `NpcKnowsInfoCondition` carries `negated`
(constructor, `generateCode`, `toDisplayString`), `parseUnaryExpression` and
`isNegatedCallHandledByUnaryCondition` both dispatch on `npc_knowsinfo`, and the
simulator's `evaluateCondition` inverts on it. `condition-idioms.d` gained a
`!Npc_KnowsInfo` chain gate and stays GREEN in the roundtrip ratchet, so a
dropped `!` is now token drift. The editor's condition card labels the negated
form "NPC Does Not Know Dialog".

Two adjacent shapes are deliberately **not** covered and still land as generic
or unknown rather than inverted: `Npc_KnowsInfo(...) == FALSE` (the
`parseBoolLikeComparisonAsNegation` path handles only `npc_isdead` and
`npc_isinstate`), and `!Npc_KnowsInfo(...)` inside a raw condition string, where
`conditionExpressionCodec.parseSimpleClause`'s knows-info regex accepts no
leading `!` (its `Npc_IsDead` twin does). Neither inverts availability; both
report unknown.

Original finding:

In a condition function, `parseUnaryExpression` handles `!identifier`,
`!Npc_IsDead`, and `!Npc_IsInState`, but returns `null` for `!Npc_KnowsInfo`
(`daedalus-parser/src/semantic/parsers/condition-parsers.ts:158-200`). The
dropped-clause guard in the visitor, `isNegatedCallHandledByUnaryCondition`,
only covers `npc_isdead`/`npc_isinstate`
(`linking-visitor.ts:797-810`). Traversal then descends into the unary
expression's child, hits the inner `Npc_KnowsInfo(...)` call, and records it as
an **un-negated** `NpcKnowsInfoCondition`.

The simulator evaluates that crisply
(`src/renderer/simulator/domain/conditionEvaluator.ts:163-166`), so a dialog
gated on "*hasn't* heard X yet" — the most common chain idiom in Gothic
scripts — behaves exactly backwards: hidden at start, available after playing X.

This is a pre-existing parser gap, but the simulator is the first consumer that
turns it into wrong runtime behavior. It is also a latent codegen-fidelity risk:
a structured regeneration of such a condition function would drop the `!`.
There is no parser test or corpus fixture covering `!Npc_KnowsInfo`.

Note: verified by code reading; the tree-sitter native build could not run in
the review sandbox, so this should be confirmed with a failing parser test
first (per TDD rules).

**Suggested fix (parser-side):** add `negated` support to
`NpcKnowsInfoCondition` (type, parser class, codegen), handle `npc_knowsinfo`
in `parseUnaryExpression` and in `isNegatedCallHandledByUnaryCondition`, add a
roundtrip corpus fixture for the negated form, then honor `negated` in the
simulator's `evaluateCondition`.

---

## Medium severity

### M1. `SimulatorDialog` does work while closed, against the repo's render-performance rule

**Status:** FIXED 2026-08-29 — the `createSimulatorModel` projection is gated
on `open` (`SimulatorDialog.tsx`), so a closed simulator does no work when the
semantic model changes. `tests/simulatorDialog.test.tsx` spies on the projection
across a closed re-render with a new model identity.

`DialogDetailsEditor.tsx` mounts `SimulatorDialog` whenever
`semanticModel && dialog` — not gated on `simulatorOpen`. Inside,
`useMemo(() => createSimulatorModel(semanticModel), [semanticModel])`
(`SimulatorDialog.tsx:40`) re-projects every function, constant, and dialog on
**every** semantic-model identity change, even if the simulator was never
opened. CLAUDE.md explicitly warns that `semanticModel` is large and recreated
frequently. Gate the mount (or at least the projection) on `open`.

### M2. A background reparse silently wipes a running session

**Status:** Open

The effect in `SimulatorDialog.tsx:44-53` depends on `model`, so any
semantic-model update while the modal is open (e.g. a file-watcher reparse)
recreates the session and discards the transcript, history, and scratch state
without any notice to the user. Either keep the session pinned to the model
snapshot taken at open time, or surface an explicit "model changed — restart?"
affordance.

### M3. Silent launch failures

**Status:** FIXED 2026-08-29 — `SimulatorSession.canStartDialog` returns the
refusal `startDialog` would give, with its reason (missing/unknown dialog,
missing information function, false gate, unknown gate under the current
policy). The modal shows that reason in an `Alert` when the edited dialog does
not launch, and disables an availability entry the session would refuse.

`startDialog`'s return value is ignored in the mount effect
(`SimulatorDialog.tsx:51`). If the edited dialog's condition is false at the
initial scratch state — the typical case for mid-quest dialogs, since declared
`MIS_*` variables start at a crisp `0` — the modal shows only "No dialog lines
yet" with no explanation. Entries whose information function is missing render
as enabled buttons in the availability list, but clicking them does nothing
(`startDialog` returns `false`). Show a reason on failed launch and disable
unlaunchable entries.

---

## Low severity / polish

### L1. Integer-division fidelity

**Status:** FIXED 2026-08-29 — `/=` truncates toward zero (`5 / 2 -> 2`,
`-5 / 2 -> -2`), covered in `tests/simulatorEngine.test.ts`.

`/=` produces fractional results (`engine.ts:123`; e.g. `5 / 2 -> 2.5`) where
Daedalus performs integer arithmetic. Truncate toward zero to match the engine.

### L2. Permanent entries get marked known

**Status:** FIXED 2026-08-29 — `runEntry` skips the `knownInfos` add for a
`permanent` entry, so an `Npc_KnowsInfo` gate on one no longer diverges from the
engine.

`SimulatorSession.runEntry` adds every completed entry to `knownInfos`
(`SimulatorSession.ts:170-172`). In the game, permanent C_INFOs never register
as known, so an `Npc_KnowsInfo` gate on a permanent dialog would diverge from
engine behavior. Skip the `knownInfos` add for `permanent` entries.

### L3. Duplication across simulator modules

**Status:** FIXED 2026-08-29 — `simulator/domain/values.ts` now owns the single
`cloneSimState`, `cloneValue`, `isUnknownValue`, `builtInNumber` and
`findConstant`; the engine, the evaluator and the session import them. The
constant lookup is the direct canonical `get` — `createSimulatorModel`
canonicalizes the keys, so the scan was dead weight (the evaluator's test
fixture now canonicalizes like the projection does).

- `cloneState` is implemented twice (`engine.ts:28-36`,
  `SimulatorSession.ts:27-35`).
- `findConstant` in `conditionEvaluator.ts:38-47` does an O(n) scan per lookup
  even though `createSimulatorModel` already canonicalizes keys; the `engine.ts`
  twin (`engine.ts:52-63`) has the direct `get` plus a dead fallback loop.
- `statusValue` (`conditionEvaluator.ts:28-36`) and `builtInNumber`
  (`engine.ts:40-50`) overlap.

Consolidate into shared domain helpers.

### L4. Bare-variable branches inside information functions land as unknown

**Status:** FIXED 2026-08-29 — `parseSimpleClause` accepts a bare `IDENT` and
`!IDENT` clause as an operator-less `VariableCondition`, and `serializeClause`
renders it back, so the quest codec still round-trips strictly. `MIS_A && !MIS_B`
now evaluates instead of landing unknown.

`if (MIS_X)` inside an information function goes through the quest
condition-expression codec, whose clause regex requires a comparison operator
(`conditionExpressionCodec.ts:120`), so the branch is unknown even though the
evaluator supports operator-less variable conditions
(`conditionEvaluator.ts:110-112`). Extend the codec (or pre-normalize the
clause) so bare `MIS_*`/`!MIS_*` identifiers evaluate.

---

## Test-coverage observations

- Domain and session Jest suites are thorough for hand-built inputs; the
  Playwright spec genuinely drives launch → choice → back → alternate branch →
  restart through the real UI.
- No test feeds the simulator a semantic model produced by the actual parser,
  which is where H1/H2 live. Add integration fixtures that run real Daedalus
  source through `daedalus-parser` and assert availability (a raw-mode
  condition function must not evaluate crisply true; a negated knows-info gate
  must not invert).
- The failed-launch UI path is covered as of 2026-08-29
  (`tests/simulatorDialog.test.tsx`).

## Positives

- Layer boundary honored exactly as documented (domain has no React/MUI/
  Electron/store imports; imports flow UI → application → domain).
- Three-valued AND/OR truth tables correct and directly tested.
- Defensive deep clones everywhere state crosses a boundary; source semantic
  model is never mutated (asserted in tests).
- Action budget prevents runaway synchronous walks; termination reasons are
  explicit (`completed` / `stopped` / `budget-exceeded` / `missing-function`).
- Choice-menu persistence matches Gothic's `Info_ClearChoices` model.
- `docs/architecture/dialog-simulator.md` is honest about deliberate
  limitations.

## Suggested fix order

1. H1 (simulator-side guard; self-contained in the editor workspace)
2. M1 + M3 (small UI changes, same component)
3. H2 (parser change + corpus fixture + simulator `negated` handling)
4. M2, then L1–L4 as cleanup

Per repo convention, delete this file once the findings are resolved and any
durable decisions are extracted into `docs/architecture/dialog-simulator.md`.
