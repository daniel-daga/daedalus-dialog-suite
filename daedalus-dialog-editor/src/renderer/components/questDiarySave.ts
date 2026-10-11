import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { DialogAction, SemanticModel } from '../types/global';
import { getQuestMisVariableName } from '../utils/questIdentity';
import { withQuestStateAssignments, type QuestDiaryItem } from '../quest/domain/questDiary';
import { getActionAtPath, updateActionAtPath, type ActionPath } from './nestedActionUtils';
import { fileModel } from './routineSave';

/**
 * The quest page's writes (#324). Like a routine save, an edit is a new
 * actions list for a function in its file's model, saved by the ordinary
 * `saveFile`; the quest page re-reads it through the store sync.
 */

const functionKey = (model: SemanticModel, name: string) =>
  Object.keys(model.functions).find((key) => key.toUpperCase() === name.toUpperCase());

async function saveFunctions(filePath: string, model: SemanticModel, actionsByKey: Map<string, DialogAction[]>) {
  const functions = { ...model.functions };
  for (const [key, actions] of actionsByKey) functions[key] = { ...functions[key], actions };
  useEditorStore.getState().updateModel(filePath, { ...model, functions });
  const result = await useEditorStore.getState().saveFile(filePath);
  if (!result.success) {
    const firstError = result.validationResult?.errors?.[0]?.message;
    throw new Error(firstError ? `Save refused: ${firstError}` : 'Save failed');
  }
}

/** Replace a diary entry's text where it is written. */
export async function saveDiaryEntryText(item: QuestDiaryItem, text: string): Promise<void> {
  if (!item.filePath) throw new Error(`No file is known for ${item.functionName}`);
  const model = await fileModel(item.filePath);
  const key = functionKey(model, item.functionName);
  const path = item.path as ActionPath;
  const action = key ? getActionAtPath(model.functions[key].actions, path) as { type?: string; text?: string } | undefined : undefined;
  if (!key || action?.type !== 'LogEntry' || action.text !== item.text) {
    throw new Error(`The entry in ${item.dialogName ?? item.functionName} has changed since the quest page read it`);
  }
  const actions = updateActionAtPath(model.functions[key].actions, path, { ...action, text } as DialogAction);
  await saveFunctions(item.filePath, model, new Map([[key, actions]]));
}

/**
 * Upgrade an implicit quest: declare `MIS_X` beside the quest's `TOPIC_`
 * constant, then set it wherever the diary sets the quest's state.
 */
export async function upgradeImplicitQuest(
  questName: string,
  diary: readonly QuestDiaryItem[],
  declarationFile: string
): Promise<void> {
  await useProjectStore.getState().addVariable(getQuestMisVariableName(questName), 'int', undefined, declarationFile, false);

  const functionsByFile = new Map<string, Set<string>>();
  for (const item of diary) {
    if (item.kind !== 'state' || !item.filePath) continue;
    functionsByFile.set(item.filePath, (functionsByFile.get(item.filePath) ?? new Set()).add(item.functionName));
  }
  for (const [filePath, names] of functionsByFile) {
    const model = await fileModel(filePath);
    const actionsByKey = new Map<string, DialogAction[]>();
    for (const name of names) {
      const key = functionKey(model, name);
      const actions = key ? withQuestStateAssignments(model.functions[key].actions, questName) : null;
      if (key && actions) actionsByKey.set(key, actions);
    }
    if (actionsByKey.size > 0) await saveFunctions(filePath, model, actionsByKey);
  }
}
