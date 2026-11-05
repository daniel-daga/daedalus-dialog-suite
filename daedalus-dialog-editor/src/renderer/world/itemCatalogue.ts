import type { GlobalInstance } from '../../shared/types';

// The project's item instances as the Assets panel's Items tab lists them
// (#412) — Spacer's Objects window, slice 1.
//
// An item is not a file: what the world is given is the Daedalus instance an
// `oCItem` names, and the picture beside it is the `visual` that instance's
// `C_ITEM` declaration assigns. Both are already resolved elsewhere for
// `oCItem.instance` and for #424's item drawing, so this reads the same map the
// surface builds (`WorldSurface`'s `itemVisuals`) rather than re-reading the
// declarations: two readers of one field drifting apart would draw an item's
// picture in one place and not the other.
//
// The label is the item's `name` — the string a player sees, and what a German
// term finds where an English instance name would not (#406) — falling back to
// the instance where a declaration assigns none.

export interface CatalogueItem {
  /** The Daedalus instance, as the scripts declare it: what `oCItem.instance`
   *  takes, and what the placement sends. */
  instance: string;
  /** The item's `name`, or the instance when it declares none. */
  name: string;
  /** The visual its declaration assigns, or null where it assigns none — such
   *  an item is offered by name and has no picture. */
  visual: string | null;
}

/** Every item instance `items` holds, by its display name. */
export function itemCatalogueOf(
  items: Record<string, GlobalInstance> | undefined,
  itemVisuals: ReadonlyMap<string, string>,
): CatalogueItem[] {
  return Object.values(items ?? {})
    .map((item) => ({
      instance: item.name,
      name: item.displayName?.trim() ? item.displayName : item.name,
      visual: itemVisuals.get(item.name.toUpperCase()) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.instance.localeCompare(b.instance));
}

/** The catalogue narrowed to what `needle` names — an item's display name or
 *  its instance, in any case. A blank needle is the whole list. */
export function searchItemCatalogue(
  items: readonly CatalogueItem[],
  needle: string,
): readonly CatalogueItem[] {
  const query = needle.trim().toLowerCase();
  if (query === '') return items;
  return items.filter((item) => (
    item.name.toLowerCase().includes(query) || item.instance.toLowerCase().includes(query)
  ));
}
