// `oCMobContainer.contents` — the archive's `contains` string (level-editor.md
// §16.26 row 2), read and written here so the IPC validator, the property
// grid's editor and the op builder agree on one grammar.
//
// What retail holds (NewWorld, OldWorld, AddonWorld — 294 chests, surveyed
// 2026-09-03 through `getVobProps`): entries of `INSTANCE` or
// `INSTANCE:COUNT`, comma-separated, no count meaning one —
// `ItMw_1H_VLK_Dagger,ItMi_Gold:26,ItPo_Mana_02:3`. Two chests deviate and the
// engine reads them, so the reader takes them too: a space after the comma
// (`ItMi_Gold:20, ItMi_Nugget:2`) and a `;` for a comma
// (`ItMi_Gold:32;ItPo_Health_02:3`). The writer emits the majority form only.
//
// An instance is a Daedalus symbol by shape and nothing more at this layer:
// whether it exists is the renderer's item index's question, and an empty
// index means "nothing is known", never "nothing is legal" (§7).

export interface ContainerEntry {
  instance: string;
  /** A positive integer; retail's largest is 230 gold. */
  count: number;
}

const ENTRY = /^([A-Za-z_][A-Za-z0-9_]*)(?::([1-9][0-9]*))?$/;

/** The entries, or null for a string that is not a contents list. */
export function parseContainerContents(contents: string): ContainerEntry[] | null {
  if (contents.trim() === '') return [];
  const entries: ContainerEntry[] = [];
  for (const raw of contents.split(/[,;]/)) {
    const match = ENTRY.exec(raw.trim());
    if (match === null) return null;
    entries.push({ instance: match[1], count: match[2] === undefined ? 1 : Number(match[2]) });
  }
  return entries;
}

export function isContainerContents(contents: string): boolean {
  return parseContainerContents(contents) !== null;
}

/** The canonical retail spelling: no spaces, a count only above one. */
export function formatContainerContents(entries: readonly ContainerEntry[]): string {
  return entries.map(({ instance, count }) => (count > 1 ? `${instance}:${count}` : instance)).join(',');
}
