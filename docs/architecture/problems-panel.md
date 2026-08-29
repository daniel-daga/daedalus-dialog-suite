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
the renderer. The scan's main input is `projectStore.parsedFiles` — the full
per-file models already cached by background ingestion — joined by two pieces of
reference data the rules read but never walk: `projectStore.waypointSiteIndex`,
the whole-project index pass's record of which script sites name a waypoint
(so it sees every file, not only the ones opened), and `worldStore.waynetNames`,
the open world's point names. Both are absent-means-nothing-is-known, never
absent-means-nothing-is-legal. `buildProjectView`
folds them into case-insensitive lookup sets (`dialogNameKeys`, `npcNameKeys`)
and a `functionsByKey` map. Known NPCs come from the project index
(`npcList ∪ npcPrototypes`, which already resolve prototype/instance chains to
C_NPC) plus any file-local C_NPC instance. The panel re-scans whenever
`projectStore.parseGeneration` changes, so problems appear as ingestion
advances; a manual **Rescan** button and scanned/total counts cover the
mid-ingestion window.

## Rules

All seven read only structured, typed data:

| Rule | Severity | Detection |
|---|---|---|
| `npc-not-found` | error | dialog `npc` not in the known-NPC set |
| `knowsinfo-dangling` | error | `NpcKnowsInfoCondition.dialogRef` names no known dialog |
| `choice-no-clearchoices` | warning | an `Info_AddChoice` with no `Info_ClearChoices` reachable via the choice-target chain |
| `orphaned-function` | warning | function referenced by no dialog property, choice target, or `calls` entry |
| `voice-id-duplicate` / `voice-id-malformed` | warning | a voice id used cross-file, or not matching `…_<n>_<n>` |
| `waypoint-not-in-world` | warning | a script site names a waypoint the open world's waynet has no point for; silent when no world is open, and free points are matched by prefix because the engine matches them that way |
| `duplicate-spawn` | warning | one NPC is statically inserted at two different spawn points, so both sites running puts two copies in the world |

Three decisions worth keeping:

- **Reachability, not per-function, for choices.** The standard Daedalus pattern
  adds a choice in the info function but clears it in the *target* function. The
  rule follows `Choice.targetFunction` transitively and only flags a function
  when no reachable target clears — avoiding a false positive on every normal
  choice menu.
- **`duplicate-spawn` fires only for NPCs the project holds dialog for.**
  Measured over retail Gothic II's 3,722 literal `Wld_InsertNpc` sites: 103
  instances are spawned at more than one distinct point, and nearly all are
  monster templates (`Draconian` at 186 points, `Wolf` at 49) — the normal shape
  of the game. The index's NPC set cannot separate them, because monsters are
  `C_NPC` instances too; dialog can, and it takes the same corpus to **4**
  findings. Same NPC at the *same* point twice is not this rule (598 retail site
  pairs do it deliberately, a pack on one waypoint).
- **Defensive optional arrays.** A project-wide scan consumes many models,
  including partial/error models and the browser-harness mock, which may omit
  arrays the native parser always sets. Rules treat `conditions`/`calls`/
  `actions` as possibly-absent.

## Navigation

`runRules` enriches each function-based problem with the dialog that owns its
`information`/`condition` function, so clicking any problem navigates to a
dialog via `useNavigation().navigateToDialog(dialogName, functionName)`. A
problem with only a standalone function falls back to `navigateToSymbol`.

Both navigators search the merged semantic model, which only covers files that
have been opened — and `waypoint-not-in-world` and `duplicate-spawn` take their sites
from the whole-project index pass, so its function routinely lives in a
file no model was ever built for. When neither navigator resolves, the click
falls back to `problem.filePath`, the one thing every problem carries: the
panel opens that file, selects the function and switches to the dialog view.
Without it the click is a no-op on a view that occupies the whole main area.

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
