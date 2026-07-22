import type { FileModel, FunctionEntry, ProjectView } from './types';

const key = (name: string): string => name.trim().toLowerCase();

/**
 * Builds an aggregated {@link ProjectView} from the parsed per-file models.
 *
 * `knownNpcNames` are the project-index NPC names (npcList ∪ npcPrototypes) that
 * already resolve prototype/instance chains to C_NPC; any file-local instance
 * whose parent is C_NPC is folded in as well so a freshly-added NPC still counts
 * before the next reindex.
 */
export function buildProjectView(input: {
  files: FileModel[];
  knownNpcNames: string[];
}): ProjectView {
  const { files, knownNpcNames } = input;

  const dialogNameKeys = new Set<string>();
  const functionsByKey = new Map<string, FunctionEntry>();
  const npcNameKeys = new Set<string>(knownNpcNames.map(key));

  for (const { filePath, model } of files) {
    for (const dialogName of Object.keys(model.dialogs || {})) {
      dialogNameKeys.add(key(dialogName));
    }
    for (const [functionName, func] of Object.entries(model.functions || {})) {
      functionsByKey.set(key(functionName), { func, filePath });
    }
    for (const instance of Object.values(model.instances || {})) {
      if (instance.parent && instance.parent.trim().toUpperCase() === 'C_NPC') {
        npcNameKeys.add(key(instance.name));
      }
    }
    for (const npc of Object.values(model.npcs || {})) {
      npcNameKeys.add(key(npc.name));
    }
  }

  return { files, dialogNameKeys, npcNameKeys, functionsByKey };
}
