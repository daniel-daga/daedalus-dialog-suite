import type { NpcEdit } from '../../shared/types';
import { getDirectoryName, joinPath, sanitizeDaedalusString } from '../utils/pathAndIdentifierUtils';

// Create NPC (docs/plans/npc-editor.md §3, #285): a new NPC is a copy of one
// the project already has, the id it is offered and the file it lands in.
// Pure: no React, no IPC.
//
// Copying, not a built-in template, because #141 removed an Add NPC that
// wrote its own parameters: a copy only uses constants, meshes and helpers
// the mod already defines, so it compiles wherever its template does.

export interface NewNpc {
  name: string;
  guild: string;
  id: number;
}

/** The template's instance declaration under a new name; its body untouched. */
export function renameNpcInstance(sourceText: string, instance: string): string {
  return sourceText.replace(/^(\s*instance\s+)[A-Za-z_][A-Za-z0-9_]*/i, `$1${instance}`);
}

/** What changes between the template and the copy. The template's routine is
 *  its own NPC's day, so the copy starts without one. */
export function copyEdits({ name, guild, id }: NewNpc): NpcEdit[] {
  return [
    { op: 'set', field: 'name', value: `"${sanitizeDaedalusString(name)}"` },
    { op: 'set', field: 'guild', value: guild },
    { op: 'set', field: 'id', value: String(id) },
    { op: 'remove', field: 'daily_routine' }
  ];
}

/** One past the highest id in retail-style names (`BAU_900_Onar` carries 900). */
export function proposeNpcId(npcNames: string[]): number {
  let highest = 0;
  for (const name of npcNames) {
    const match = name.match(/^[A-Za-z]+_(\d+)_/);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

/** `<instance>.d` in the folder most NPC files live in, else the project folder. */
export function defaultNpcFilePath(npcFiles: Record<string, string>, instance: string, projectPath: string): string {
  const counts = new Map<string, number>();
  for (const filePath of Object.values(npcFiles)) {
    const dir = getDirectoryName(filePath);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let folder = projectPath;
  let best = 0;
  for (const [dir, count] of counts) {
    if (count > best) {
      folder = dir;
      best = count;
    }
  }
  return joinPath(folder, `${instance}.d`);
}

export interface NewNpcForm {
  template: string;
  instance: string;
  name: string;
  guild: string;
  id: string;
  filePath: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The first thing wrong with the form, or null. */
export function validateNewNpc(form: NewNpcForm, existingNpcs: string[]): string | null {
  if (!IDENTIFIER.test(form.instance)) return 'The instance name must be an identifier (letters, digits, _).';
  const upper = form.instance.toUpperCase();
  if (existingNpcs.some((npc) => npc.toUpperCase() === upper)) return `${form.instance} already exists in the project.`;
  if (!form.template) return 'Choose an NPC to copy.';
  if (!form.name.trim()) return 'The NPC needs a name.';
  if (!IDENTIFIER.test(form.guild)) return 'The guild must be a constant such as GIL_BAU.';
  if (!/^\d+$/.test(form.id)) return 'The id must be a whole number.';
  if (!/\.d$/i.test(form.filePath.trim())) return 'The file must be a .d script.';
  return null;
}
