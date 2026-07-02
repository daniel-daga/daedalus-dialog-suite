/**
 * Auto-creation of the standard EXIT dialog for new NPCs (issue #141).
 *
 * When an NPC .d file is dropped into the project folder, the file watcher
 * plans a DIA_<InstanceName>.d file containing the EXIT boilerplate every NPC
 * needs (permanent "ENDE" entry calling AI_StopProcessInfos). Planning is pure
 * so it can be tested without file-system access; the watcher performs the
 * actual writes.
 */

import { getDirectoryName, joinPath } from './pathAndIdentifierUtils';
import type { DialogMetadata, SemanticModel } from '../types/global';

export interface ExitDialogPlan {
  npcName: string;
  dialogName: string;
  filePath: string;
  content: string;
}

/**
 * Derive the EXIT dialog instance name from an NPC instance name.
 * Gothic NPC instances follow GUILD_ID_NAME (`VLK_99099_Robert`); the EXIT
 * dialog conventionally uses just the name part (`DIA_Robert_EXIT`).
 */
export function deriveExitDialogName(npcInstanceName: string): string {
  const match = npcInstanceName.match(/^.*_\d+_(.+)$/);
  const shortName = match ? match[1] : npcInstanceName;
  return `DIA_${shortName}_EXIT`;
}

/**
 * The standard EXIT dialog boilerplate from issue #141.
 */
export function createExitDialogTemplate(
  npcInstanceName: string,
  dialogName: string = deriveExitDialogName(npcInstanceName)
): string {
  return [
    '// ************************************************************',
    '//\t\t\t  \tEXIT',
    '// ************************************************************',
    '',
    `INSTANCE ${dialogName} (C_INFO)`,
    '{',
    `\tnpc\t\t\t= ${npcInstanceName};`,
    '\tnr\t\t\t= 999;',
    `\tcondition\t= ${dialogName}_Condition;`,
    `\tinformation\t= ${dialogName}_Info;`,
    '\tdescription\t= "ENDE";',
    '\tpermanent\t= TRUE;',
    '};',
    '',
    `FUNC INT ${dialogName}_Condition()`,
    '{',
    '\treturn TRUE;',
    '};',
    '',
    `FUNC VOID ${dialogName}_Info()`,
    '{',
    '\tAI_StopProcessInfos (self);',
    '};',
    ''
  ].join('\n');
}

/**
 * The directory where the project's dialog files live: the most common
 * directory among all indexed dialog files, falling back to the directory of
 * the file that triggered the planning.
 */
function resolveDialogDirectory(
  dialogIndex: Map<string, DialogMetadata[]>,
  addedFilePath: string
): string {
  const counts = new Map<string, number>();
  for (const dialogs of dialogIndex.values()) {
    for (const meta of dialogs) {
      const dir = getDirectoryName(meta.filePath);
      if (dir) counts.set(dir, (counts.get(dir) || 0) + 1);
    }
  }

  let best = '';
  let bestCount = 0;
  for (const [dir, count] of counts) {
    if (count > bestCount) {
      best = dir;
      bestCount = count;
    }
  }

  return best || getDirectoryName(addedFilePath);
}

/**
 * Plan the EXIT dialog files to create for a freshly added project file.
 * An instance qualifies when it is an NPC (direct C_NPC parent or a parent in
 * `npcPrototypes`, the project's known C_NPC-derived prototypes) and the NPC
 * has no dialogs in the project index yet.
 */
export function planExitDialogsForAddedFile(options: {
  model: SemanticModel;
  addedFilePath: string;
  npcPrototypes: string[];
  dialogIndex: Map<string, DialogMetadata[]>;
}): ExitDialogPlan[] {
  const { model, addedFilePath, npcPrototypes, dialogIndex } = options;

  const npcParents = new Set(['C_NPC', ...npcPrototypes.map((p) => p.toUpperCase())]);

  const npcsWithDialogs = new Set<string>();
  const existingDialogNames = new Set<string>();
  for (const [npc, dialogs] of dialogIndex.entries()) {
    if (dialogs.length > 0) npcsWithDialogs.add(npc.toUpperCase());
    for (const meta of dialogs) existingDialogNames.add(meta.dialogName.toUpperCase());
  }

  const dialogDirectory = resolveDialogDirectory(dialogIndex, addedFilePath);

  const plans: ExitDialogPlan[] = [];
  for (const instance of Object.values(model.instances || {})) {
    const parent = instance.parent;
    if (!parent || !npcParents.has(parent.toUpperCase())) continue;
    if (npcsWithDialogs.has(instance.name.toUpperCase())) continue;

    let dialogName = deriveExitDialogName(instance.name);
    if (existingDialogNames.has(dialogName.toUpperCase())) {
      dialogName = `DIA_${instance.name}_EXIT`;
      if (existingDialogNames.has(dialogName.toUpperCase())) continue;
    }
    existingDialogNames.add(dialogName.toUpperCase());

    plans.push({
      npcName: instance.name,
      dialogName,
      filePath: joinPath(dialogDirectory, `DIA_${instance.name}.d`),
      content: createExitDialogTemplate(instance.name, dialogName)
    });
  }

  return plans;
}
