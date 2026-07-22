# Plan: Project-wide "Problems" panel

Implements P1 item #2 from `docs/feature-suggestions.md`. Adds a cross-file lint
surface to the editor: today `ValidationService` only validates the active file
at save time, in a transient modal. This introduces a persistent, navigable,
project-wide problems list.

## Scope (this cut)

**Placement:** a fourth left-sidebar view mode (`'problems'`), alongside
`dialog` / `quest` / `variable`, rendering a full-pane virtualized list. Clicking
a row switches to the `dialog` view and navigates to the offending
dialog/function.

**Lints (core 5, each independently testable):**

| Rule id | Severity | Data source | Detection |
|---|---|---|---|
| `npc-not-found` | error | `Dialog.properties.npc` vs known-NPC set | dialog's `npc` not in `projectStore.npcList ∪ npcPrototypes` (case-insensitive) |
| `knowsinfo-dangling` | error | `NpcKnowsInfoCondition.dialogRef` in function `conditions` | `dialogRef` not in the project-wide dialog set |
| `choice-no-clearchoices` | warning | `Choice` / `ClearChoicesAction` in function `actions` (incl. nested) | an `Info_AddChoice` with no `Info_ClearChoices` in the reachable action set |
| `orphaned-function` | warning | `cross-references.findFunctionReferences` + `DialogFunction.calls` | function referenced by no dialog `information`/`condition`, no `choice-target`, and no other function's `calls` |
| `voice-id-duplicate` / `voice-id-malformed` | warning | aggregated `DialogLine.id` across all parsed files | same id ≥2× (cross-file), or id not matching `/_\d+_\d+$/` |

Deferred (caveated, follow-up): undeclared `MIS_`/`TOPIC_` identifiers (refs in
raw condition/action text need string scanning) and unsatisfiable dialog
conditions (only simple AND/OR bodies are structurally analyzable). Cheap
add-on noted but out of scope: surfacing existing per-file parse errors
(`parsedFiles[].semanticModel.errors`).

## Key constraints (from codebase survey)

- **No source positions on bodies.** The semantic model persists line/column
  only on top-level *declarations*; `Dialog`, `DialogFunction`, and all
  action/condition/choice/`DialogLine` objects have none. So problems point at
  **dialog + function (+ action path for the choice lint)** — not an exact line.
  This matches how `ValidationService` already reports (by function name).
- **Aggregation is renderer-side.** The parser emits one `SemanticModel` per
  file. The renderer already caches full per-file models in
  `projectStore.parsedFiles` (background-ingested, tracked by `parseGeneration`).
  This is the single scan input — it keeps lints pure and avoids new IPC and
  heavy main-process work. Voice ids are re-derived from `parsedFiles` (not the
  possibly-stale `voiceIdIndex`) so all five rules read one consistent snapshot.
- **Ingestion completeness.** If some `allDialogFiles` are not yet in
  `parsedFiles`, the scan reports the included/pending file counts rather than
  silently under-reporting.

## Architecture (mirrors the simulator's domain/application/UI layering)

```
src/renderer/problems/
  domain/
    types.ts          Problem, ProblemSeverity, ProblemRuleId, ProjectView
    projectView.ts    build a ProjectView (dialog set, npc set, function set,
                      voice-id map) from parsed per-file models — pure
    rules/
      npcNotFound.ts
      knowsInfoDangling.ts
      choiceNoClearChoices.ts
      orphanedFunction.ts
      voiceId.ts
    runRules.ts       run all rules over a ProjectView → Problem[]  (pure)
  application/
    scanProject.ts    adapt projectStore.parsedFiles + indices → ProjectView,
                      run runRules, carry a cancellation id. No React/Zustand.
src/renderer/store/
  problemsStore.ts    zustand: { problems, isScanning, lastScanId, runScan(),
                      clear() } — shaped after searchStore
src/renderer/components/Problems/
  ProblemsPanel.tsx   shell: reuses common/searchablePaneStyles + data-ui-pattern
  ProblemsList.tsx    virtualized ListItemButton rows (react-window), severity
                      Chip + rule label, onProblemClick
```

Import direction is one-way: UI → application → domain. Domain has no React /
MUI / Electron / store imports (enforced like the quest and simulator layers).

Reuse existing helpers: `cross-references.ts`
(`findDialogReferences`, `findFunctionReferences`, `forEachChoice`,
`collectReachableFunctions`).

## Navigation on click

Mirror `useSearchNavigation.handleSearchResultClick`:
`useNavigation().navigateToDialog(dialogName, functionName)`, then for the
choice lint `useFocusNavigation().focusAction(actionPath, true)` +
`uiSelectionStore.setSelectedAction`. For function-only problems whose owning
dialog is ambiguous, resolve via `findFunctionReferences` (reverse lookup) or
fall back to `navigateToSymbol(functionName)`.

## UI wiring

- `uiSelectionStore`: extend `activeView` union with `'problems'`.
- `MainLayout.tsx`: add a fourth `ToggleButton` (`data-testid="problems-toggle"`)
  to the left icon sidebar; render `<ProblemsPanel>` when
  `activeView === 'problems'`. Trigger a scan on first open and expose a
  "Rescan" button; cancellation via scan id like `searchStore`.
- Styling via `common/searchablePaneStyles.ts`
  (`SEARCHABLE_PANE_PATTERN` + sx helpers); tag the root
  `data-ui-pattern={SEARCHABLE_PANE_PATTERN}` (conformance test exists).
- Test ids: `problems-toggle`, `problems-panel`, `problems-summary`,
  `problems-empty`, `problems-rescan`, `problem-row-${index}`.

## TDD steps (failing test → minimal impl → green)

1. **Domain rules + ProjectView** → Jest unit tests per rule over small
   synthetic `SemanticModel`s (`tests/problemsRules.test.ts`), plus a
   `projectView` builder test. Each rule test must fail before its rule exists.
2. **Application scan** → Jest test for `scanProject` aggregating multiple
   per-file models and honoring cancellation (`tests/problemsScan.test.ts`).
3. **problemsStore** → Jest store test (runScan populates, clear resets,
   superseded scan id is dropped).
4. **ProblemsList component** → component test (rows render, click fires with the
   right Problem) + `searchablePaneDesign` conformance.
5. **UI workflow (Playwright, written first)** → `tests/e2e/problems-panel.spec.ts`:
   open a mock project seeded with a known problem (e.g. a dialog whose `npc`
   doesn't exist), open the Problems view via `problems-toggle`, assert a
   `problem-row-0` appears with the expected message, click it, assert the app
   navigates to the `dialog` view with that dialog selected. Manually confirm the
   spec drives the real UI (not a trivial pass), per editor TDD rules.

## Completion checklist

- `pnpm --filter daedalus-dialog-editor test`
- `pnpm --filter daedalus-dialog-editor run typecheck:renderer`
- `pnpm --filter daedalus-dialog-editor run lint`
- `pnpm --filter daedalus-dialog-editor run test:e2e` (new spec)
- Docs: add `docs/architecture/problems-panel.md` (durable design); mark item #2
  done in `docs/feature-suggestions.md`; delete this plan file after extracting
  durable outcomes.

## Follow-ups (explicitly out of scope)

- Deferred lints (undeclared `MIS_`/`TOPIC_`, unsatisfiable conditions).
- Surface per-file parse errors in the same panel (cheap; reuse
  `useNpcDialogErrors` pattern project-wide).
- Auto-rescan on `parseGeneration` change / after save (first cut is
  on-open + manual Rescan).
- Bottom-docked variant so problems stay visible while editing.
