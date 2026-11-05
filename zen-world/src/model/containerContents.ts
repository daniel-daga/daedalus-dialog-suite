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

/**
 * The archive's bound on this one string — `ipcValidation` refuses a
 * `to.contents` over it, and it is fifteen times retail's longest chest.
 */
export const CONTAINER_CONTENTS_MAX = 4096;

/**
 * The contents string with `additions` written into it — the item catalogue's
 * "Add to container" (#418).
 *
 * Existing entries keep their place and their spelling; a name the list already
 * holds has the addition's count put on it, which is what the contents field's
 * own picker does when an item it offers is already in the chest; new ones are
 * appended in the order they were staged.
 *
 * Null when the string cannot take them, and neither case is a rewrite of
 * something the editor could not read. An unreadable current string is left
 * alone (the field shows it and offers Clear), and a result past
 * {@link CONTAINER_CONTENTS_MAX} is refused rather than truncated — the IPC
 * validator would refuse it anyway, and half a list on screen would be worse
 * than a refusal.
 */
export function addContainerContents(
  contents: string, additions: readonly ContainerEntry[],
): string | null {
  const entries = parseContainerContents(contents);
  if (entries === null) return null;

  const merged = [...entries];
  for (const addition of additions) {
    const at = merged.findIndex(
      (entry) => entry.instance.toUpperCase() === addition.instance.toUpperCase(),
    );
    if (at === -1) merged.push({ ...addition });
    else merged[at] = { ...merged[at], count: merged[at].count + addition.count };
  }
  const next = formatContainerContents(merged);
  return next.length > CONTAINER_CONTENTS_MAX ? null : next;
}
