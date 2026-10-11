/**
 * Orchestration for creating a merchant/trader dialog file (feature-
 * suggestions item 5): resolve the target file, generate the boilerplate,
 * write it, and register it in the project stores. Same flow and injected
 * dependencies as the teacher dialog factory.
 */

import { getDirectoryName, joinPath, makeUniqueName, normalizePath } from './pathAndIdentifierUtils';
import { deriveNpcShortName, resolveDialogDirectory } from './npcExitDialog';
import { createTraderDialogTemplate, type TraderDialogConfig } from './traderDialogTemplate';
import type { CreateTeacherDialogDeps, CreateTeacherDialogResult } from './teacherDialogFactory';

export type CreateTraderDialogDeps = CreateTeacherDialogDeps;
export type CreateTraderDialogResult = CreateTeacherDialogResult;

export async function createTraderDialogForNpc(
  npcName: string,
  config: TraderDialogConfig,
  deps: CreateTraderDialogDeps
): Promise<CreateTraderDialogResult> {
  const { dialogIndex, projectPath } = deps;

  // Unique dialog name: DIA_<Short>_Trade, with a numeric suffix when taken.
  // Daedalus identifiers are case-insensitive, so compare uppercased.
  const existingDialogNames = new Set<string>();
  for (const dialogs of dialogIndex.values()) {
    for (const meta of dialogs) existingDialogNames.add(meta.dialogName.toUpperCase());
  }
  const shortName = deriveNpcShortName(npcName);
  const dialogName = makeUniqueName(`DIA_${shortName}_Trade`, existingDialogNames);

  // Target directory: next to the NPC's existing dialogs, else where the
  // project's dialog files live, else the project root.
  const npcDialogs = dialogIndex.get(npcName) || [];
  const directory = npcDialogs.length > 0
    ? getDirectoryName(npcDialogs[0].filePath)
    : resolveDialogDirectory(dialogIndex, '') || (projectPath ? normalizePath(projectPath) : '');
  if (!directory) {
    throw new Error('No target directory available for the trader dialog file.');
  }

  const filePath = joinPath(directory, `${dialogName}.d`);
  const existing = await deps.readFile(filePath).catch(() => null);
  if (typeof existing === 'string' && existing.length > 0) {
    throw new Error(`File already exists: ${filePath}`);
  }

  const source = createTraderDialogTemplate({
    npcInstanceName: npcName,
    dialogName,
    description: config.description
  });

  const writeResult = await deps.writeFile(filePath, source);
  if (!writeResult?.success) {
    throw new Error(`Could not create trader dialog file: ${filePath}`);
  }

  deps.addProjectFile(filePath);
  await deps.getSemanticModel(filePath);
  deps.addDialogToIndex({ dialogName, npc: npcName, filePath });
  deps.selectNpc(npcName);
  deps.loadAndMergeNpcModels(npcName);

  return { dialogName, filePath, infoFunctionName: `${dialogName}_Info` };
}
