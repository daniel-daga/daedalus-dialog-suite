# Problems Panel Architecture

The Problems panel is a project-wide lint surface for the dialog editor. Unlike
`ValidationService` (which validates the active file at save time and reports in
a transient modal), the panel aggregates problems across every parsed file into
a persistent, navigable list.

## Layer boundary

Imports flow one way — UI → application → domain — mirroring the simulator and
quest-editor boundaries:

1. `src/renderer/components/Problems/` — the UI: `ProblemsPanel` (store wiring,
   auto-rescan, navigation) and `ProblemsList` (presentational rows). Rendered
   as the fourth left-sidebar view (`activeView === 'problems'`).
2. `src/renderer/store/problemsStore.ts` — the Zustand seam. `runScan()` reads
   the project store's parsed files and known NPC names and calls the
   application layer; it holds the resulting `problems` plus scanned/total file
   counts.
3. `src/renderer/problems/application/scanProject.ts` — store-agnostic adapter:
   builds the aggregated view and runs the rules. No React/Zustand.
4. `src/renderer/problems/domain/` — pure logic: `types`, the nested-action
   `walk`er, the `projectView` builder, the individual `rules/`, and `runRules`.
   No React, MUI, Electron, or store dependency.

## Scan input and aggregation

The parser emits one `SemanticModel` per file, so cross-file lints aggregate in
the renderer. The single scan input is `projectStore.parsedFiles` — the full
per-file models already cached by background ingestion. `buildProjectView`
folds them into case-insensitive lookup sets (`dialogNameKeys`, `npcNameKeys`)
and a `functionsByKey` map. Known NPCs come from the project index
(`npcList ∪ npcPrototypes`, which already resolve prototype/instance chains to
C_NPC) plus any file-local C_NPC instance. The panel re-scans whenever
`projectStore.parseGeneration` changes, so problems appear as ingestion
advances; a manual **Rescan** button and scanned/total counts cover the
mid-ingestion window.

## Rules (first cut)

All five read only structured, typed data:

| Rule | Severity | Detection |
|---|---|---|
| `npc-not-found` | error | dialog `npc` not in the known-NPC set |
| `knowsinfo-dangling` | error | `NpcKnowsInfoCondition.dialogRef` names no known dialog |
| `choice-no-clearchoices` | warning | an `Info_AddChoice` with no `Info_ClearChoices` reachable via the choice-target chain |
| `orphaned-function` | warning | function referenced by no dialog property, choice target, or `calls` entry |
| `voice-id-duplicate` / `voice-id-malformed` | warning | a voice id used cross-file, or not matching `…_<n>_<n>` |

Two decisions worth keeping:

- **Reachability, not per-function, for choices.** The standard Daedalus pattern
  adds a choice in the info function but clears it in the *target* function. The
  rule follows `Choice.targetFunction` transitively and only flags a function
  when no reachable target clears — avoiding a false positive on every normal
  choice menu.
- **Defensive optional arrays.** A project-wide scan consumes many models,
  including partial/error models and the browser-harness mock, which may omit
  arrays the native parser always sets. Rules treat `conditions`/`calls`/
  `actions` as possibly-absent.

## Navigation

`runRules` enriches each function-based problem with the dialog that owns its
`information`/`condition` function, so clicking any problem navigates to a
dialog via `useNavigation().navigateToDialog(dialogName, functionName)`. A
problem with only a standalone function falls back to `navigateToSymbol`.

## Position limitation

The semantic model persists source positions only on top-level declarations;
dialogs, functions, actions, and conditions carry none. Problems therefore
point at a dialog/function (not an exact line) — the same granularity
`ValidationService` reports. Precise in-body focus (an action-path jump) is a
possible follow-up if positions are later threaded through the linking visitor.

## Deferred

Undeclared `MIS_`/`TOPIC_` identifiers (references buried in raw condition/
action text need string scanning) and unsatisfiable dialog conditions (only
simple AND/OR bodies are structurally analyzable) were scoped out of the first
cut. Surfacing existing per-file parse errors in the same panel, list
virtualization, and a bottom-docked variant are also open.
