# Editor review — slice plan

The editor workspace (`daedalus-dialog-editor/`), reviewed the way the parser was
(`docs/reference/parser-review-*-*.md`): one slice per session, each slice its own
doc named `editor-review-<date>-<slice>.md` in `docs/reference/`, findings filed
as issues and closed from the commit that fixes them.

Slices are cut along **pipeline boundaries** — where data changes hands or an
invariant starts — not along directories, because the defects that matter cross
the boundary (a rename rule in the store versus one in the dialog, a save path
versus the panel that shows it). Each slice is 3–7k lines of source plus the
tests that pin it, so one session can read it whole.

Already reviewed on 2026-10-31, not re-cut below: the dialog renderer surface
(`ef8dd11`) and the main process's world/IPC corner (`1265d7a`, `4e72f48`). Every
slice below takes them as read and checks what they did not reach.

| # | Slice | Files | ≈ lines | Judged against |
|---|---|---|---|---|
| 1 | The IPC boundary and the small main services | `main.ts`, `ipcValidation.ts`, `preload.ts`, `windowSecurity.ts`, `PathValidationService.ts`, `shared/`, `UpdaterService`, `SettingsService`, `GmbtService`, `ThumbnailCacheService`, `AssetCatalogService`, `outputUnits`, `LogService` | 5,900 | every renderer→main call asserts its own request shape and contains its own path; nothing outside the user's project is written |
| 2 | Project load and the merged model | `ProjectService`, `ProjectConfigService`, `ParserService`, `MetadataWorkerPool`, `ForkedWorker`, `workerPoolSize`, `main/utils/`, `projectStore.ts` | 3,900 | 890 files become one index with one owner per symbol, one parse per file, and the index agrees with the files |
| 3 | Edit, undo and save | `fileStore`, `historyStore`, `historyActions`, `storeSync`, `renderer/hooks/`, `FileService`, `FileWatcherService`, `SaveFileFlow`, `CodeGeneratorService`, `ValidationService` | 4,150 | nothing typed is lost; nothing not typed is written; undo returns to a clean tree |
| 4 | The authoring shell | `App`, `MainLayout`, `ThreeColumnLayout`, `EditorPane`/`EditorColumn`, the dialog tree, `DialogDetailsEditor`, `DialogPropertiesSection`/`DialogActionsSection`, `VariableManager`, search, the confirm/conflict/source dialogs, shortcuts | 5,600 | the panel shows the model; rename/delete/register keep every reference that points in |
| 5 | Actions and conditions — the surface that writes code | `ActionCard`, `ActionsList`, `actionFactory`/`actionTemplates`/`actionTypeRegistry`, `actionRenderers/`, `nestedActionUtils`, `InlineChoiceEditor`, `ConditionEditor`/`ConditionCard`/`ConditionSection`, `conditions/`, `components/common/`, `components/hooks/` | 9,900 | an edit reaches the file exactly as shown, and a shape the flat model cannot spell is preserved rather than flattened |
| 6 | Quest, routine and NPC authoring | `quest/domain/`, `routines/`, `npc/`, `QuestEditor`/`QuestList`/`QuestDetails`, `RoutineEditor`, `NpcEditorDialog`, `NPCList`/`NpcColumn`/`CreateNpcDialog`, `NpcVisualPreview` | 7,300 | patch-in-place saves keep the file valid and the declaration the same shape the reader saw |
| 7 | Problems and the simulator | `problems/domain/`, `problemsStore`, `components/Problems/`, `simulator/`, `components/Simulator/`, `searchStore` | 3,500 | a finding points at a real locus; the simulator reads a condition the way the parser does |
| 8 | The test and mock layer — what hides a defect | `utils/mockAPI.ts`, `tests/mocks/`, `tests/setup.ts`, the e2e harness and its stubs, `repoHygiene`/`packaging`/`windowSecurity` specs | 12,100 | a green suite means the feature works, not that the fake agreed with itself |
| 9 | The world surface — the delta only | `renderer/world/`, `components/world/`, `worldStore` | 23,450 | unchanged since the 2026-09-04 review; review only what landed after it (VOB folders, routine/NPC mode, waynet edits, scatter, camera slots, insert NPC) |

Order is by where a silent data loss is likeliest: 3, 5, 2, 1, 4, 6, 7, 8, 9.

## Reviewed so far

- **Slice 3** — `docs/reference/editor-review-2026-11-01-edit-undo-save.md`,
  findings 1–8 filed as #449–#456. Two findings are `needs-decision` (#455 docs
  versus code on save clearing history, #456 writes on an external `add`); the
  dead `_markFileDirty` stays in the doc as a deletion, not an issue.
- **Slice 5** — `docs/reference/editor-review-2026-11-01-actions-conditions.md`,
  findings 1–8 filed as #457–#464. Findings 2 and 3 compound: a branch choice
  with an invented target still saves clean while either one alone is open.

Slice 5 is the largest and the only one that may split (action rendering versus
conditions and autocomplete) once its boundaries are read.

## Each slice doc contains

The same shape as a parser review slice: the commit reviewed, the load assumed
(how often the path runs and on how much data), what already holds and which
test would fail if it broke, then **Must fix** and **Should fix**, each finding
naming the file and line, the test that does not exist yet, and what the user
loses if it is skipped.
