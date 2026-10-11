/**
 * Orchestration for creating a teacher dialog file (issue #147): resolve the
 * target file, generate the boilerplate, write it, and register it in the
 * project stores. Dependencies are injected so the logic stays testable.
 */

import { getDirectoryName, joinPath, makeUniqueName, normalizePath } from './pathAndIdentifierUtils';
import { deriveNpcShortName, resolveDialogDirectory } from './npcExitDialog';
import { createTeacherDialogTemplate, type TeacherDialogConfig } from './teacherDialogTemplate';
import type { DialogMetadata, SemanticModel } from '../types/global';

export interface CreateTeacherDialogDeps {
  dialogIndex: Map<string, DialogMetadata[]>;
  projectPath: string | null;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean } | undefined>;
  addProjectFile: (filePath: string) => void;
  getSemanticModel: (filePath: string) => Promise<SemanticModel>;
  addDialogToIndex: (metadata: DialogMetadata) => void;
  selectNpc: (npcId: string) => void;
  loadAndMergeNpcModels: (npcId: string) => void;
}

export interface CreateTeacherDialogResult {
  dialogName: string;
  filePath: string;
  infoFunctionName: string;
}

export async function createTeacherDialogForNpc(
  npcName: string,
  config: TeacherDialogConfig,
  deps: CreateTeacherDialogDeps
): Promise<CreateTeacherDialogResult> {
  const { dialogIndex, projectPath } = deps;

  // Unique dialog name: DIA_<Short>_Teach, with the skill id appended when a
  // teacher dialog already exists (an NPC can teach several skills).
  // Daedalus identifiers are case-insensitive, so compare uppercased.
  const existingDialogNames = new Set<string>();
  for (const dialogs of dialogIndex.values()) {
    for (const meta of dialogs) existingDialogNames.add(meta.dialogName.toUpperCase());
  }
  const shortName = deriveNpcShortName(npcName);
  let dialogName = `DIA_${shortName}_Teach`;
  if (existingDialogNames.has(dialogName.toUpperCase())) {
    dialogName = makeUniqueName(`${dialogName}_${config.skillId}`, existingDialogNames);
  }

  // Target directory: next to the NPC's existing dialogs, else where the
  // project's dialog files live, else the project root.
  const npcDialogs = dialogIndex.get(npcName) || [];
  const directory = npcDialogs.length > 0
    ? getDirectoryName(npcDialogs[0].filePath)
    : resolveDialogDirectory(dialogIndex, '') || (projectPath ? normalizePath(projectPath) : '');
  if (!directory) {
    throw new Error('No target directory available for the teacher dialog file.');
  }

  const filePath = joinPath(directory, `${dialogName}.d`);
  const existing = await deps.readFile(filePath).catch(() => null);
  if (typeof existing === 'string' && existing.length > 0) {
    throw new Error(`File already exists: ${filePath}`);
  }

  const source = createTeacherDialogTemplate({
    npcInstanceName: npcName,
    dialogName,
    skillId: config.skillId,
    maxLevel: config.maxLevel,
    description: config.description
  });

  const writeResult = await deps.writeFile(filePath, source);
  if (!writeResult?.success) {
    throw new Error(`Could not create teacher dialog file: ${filePath}`);
  }

  deps.addProjectFile(filePath);
  await deps.getSemanticModel(filePath);
  deps.addDialogToIndex({ dialogName, npc: npcName, filePath });
  deps.selectNpc(npcName);
  deps.loadAndMergeNpcModels(npcName);

  return { dialogName, filePath, infoFunctionName: `${dialogName}_Info` };
}
