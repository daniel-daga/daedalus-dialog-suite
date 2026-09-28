import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { SemanticModel } from '../types/global';
import { readRoutine, withRoutineFunction, writeRoutine, type RoutineEntry } from '../routines/routineEntries';

/**
 * Where a routine is read from and written to (npc-editor.md §6). The edit is
 * a new actions list for the routine function in its file's model, saved by
 * the ordinary `saveFile` — validation, conflict handling and store sync
 * included — and then re-indexed in main, so the map, the time lens and the
 * Problems rules see the new day.
 */

/** The file a routine lives in: where the index found its entries, else the
 *  NPC's own file, which is where retail keeps it. */
export function routineFileOf(routine: string, npc: string): string | null {
  const project = useProjectStore.getState();
  const key = routine.toUpperCase();
  return project.routineSiteIndex.find((site) => site.routine.toUpperCase() === key)?.filePath
    ?? project.npcFileIndex[npc.toUpperCase()]
    ?? null;
}

/** The file's model, opened without changing which file the main view shows. */
async function fileModel(filePath: string): Promise<SemanticModel> {
  const store = useEditorStore.getState();
  if (!store.getFileState(filePath)) {
    const previouslyActive = store.activeFile;
    await store.openFile(filePath);
    if (previouslyActive) useEditorStore.getState().setActiveFile(previouslyActive);
  }
  const model = useEditorStore.getState().getFileState(filePath)?.semanticModel;
  if (!model) throw new Error(`${filePath} could not be opened`);
  return model;
}

const functionKey = (model: SemanticModel, routine: string) =>
  Object.keys(model.functions).find((name) => name.toUpperCase() === routine.toUpperCase());

export async function loadRoutine(filePath: string, routine: string): Promise<RoutineEntry[]> {
  const model = await fileModel(filePath);
  const key = functionKey(model, routine);
  if (!key) throw new Error(`${routine} is not declared in ${filePath}`);
  return readRoutine(model.functions[key].actions, useProjectStore.getState().routineLayoutIndex);
}

export async function saveRoutine(filePath: string, routine: string, entries: readonly RoutineEntry[]): Promise<void> {
  const model = await fileModel(filePath);
  const key = functionKey(model, routine);
  if (!key) throw new Error(`${routine} is no longer in ${filePath}`);
  const fn = model.functions[key];
  const actions = writeRoutine(fn.actions, entries, useProjectStore.getState().routineLayoutIndex);
  const store = useEditorStore.getState();
  store.updateModel(filePath, {
    ...model,
    functions: { ...model.functions, [key]: { ...fn, actions: actions as typeof fn.actions } },
  });
  const result = await useEditorStore.getState().saveFile(filePath);
  if (!result.success) {
    const firstError = result.validationResult?.errors?.[0]?.message;
    throw new Error(firstError ? `Save refused: ${firstError}` : 'Save failed');
  }
  await useProjectStore.getState().reindexRoutineSites(filePath);
}

/** The engine's name for an NPC's routine under a state (architecture §8):
 *  `Npc_ExchangeRoutine(npc, "Ship")` runs `Rtn_Ship_<id>`. */
export const routineNameFor = (state: string, id: number) => `Rtn_${state}_${id}`;

const instanceKey = (model: SemanticModel, npc: string) =>
  Object.keys(model.instances ?? {}).find((name) => name.toUpperCase() === npc.toUpperCase());

/** The NPC's literal `id`, or undefined when it has none a routine name can use. */
export async function npcIdOf(npc: string): Promise<number | undefined> {
  const filePath = useProjectStore.getState().npcFileIndex[npc.toUpperCase()];
  if (!filePath) return undefined;
  const model = await fileModel(filePath);
  const key = instanceKey(model, npc);
  return key ? model.instances![key].npcId : undefined;
}

/**
 * Create a routine in the NPC's own file (npc-editor.md §6 slice 5, #316):
 * `Rtn_<state>_<id>` holding `entries`, or with `state` null the daily
 * `Rtn_Start_<id>`, which the instance's `daily_routine` is then set to.
 * Nothing switches to a variant — that is the dialog editor's exchange-routine
 * action, written where the story decides it. Returns the routine's name as
 * the index keys it.
 */
export async function createRoutine(npc: string, state: string | null, entries: readonly RoutineEntry[]): Promise<string> {
  const project = useProjectStore.getState();
  const filePath = project.npcFileIndex[npc.toUpperCase()];
  if (!filePath) throw new Error(`No file is known for ${npc}`);
  const model = await fileModel(filePath);
  const key = instanceKey(model, npc);
  if (!key) throw new Error(`${npc} is not declared in ${filePath}`);
  const instance = model.instances![key];
  if (instance.npcId === undefined) throw new Error(`${npc} has no literal id, and a routine is named Rtn_<State>_<id>`);

  const name = routineNameFor(state ?? 'Start', instance.npcId);
  let next = withRoutineFunction(model, name, writeRoutine([], entries, project.routineLayoutIndex));
  if (state === null) {
    const sourceText = await window.editorAPI.applyNpcEdits(instance.sourceText!, [
      { op: 'set', field: 'daily_routine', value: name },
    ]);
    const updated = { ...instance, sourceText };
    next = {
      ...next,
      instances: { ...next.instances, [key]: updated },
      ...(next.npcs?.[key] ? { npcs: { ...next.npcs, [key]: updated } } : {}),
    };
  }

  useEditorStore.getState().updateModel(filePath, next);
  const result = await useEditorStore.getState().saveFile(filePath);
  if (!result.success) {
    const firstError = result.validationResult?.errors?.[0]?.message;
    throw new Error(firstError ? `Save refused: ${firstError}` : 'Save failed');
  }
  await useProjectStore.getState().reindexRoutineSites(filePath);
  useProjectStore.getState().registerRoutine(npc, name, state, instance.npcId);
  return name.toUpperCase();
}
