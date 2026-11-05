import type { ItemInstances, VobIndex } from '../../shared/worldTypes';
import type { CatalogueItem } from './itemCatalogue';

// Spacer's Item Locator (#417, slice 3 of #412): the world's `oCItem` VOBs, by
// a radius around the camera, as every item, or only the ones that are wrong.
//
// **Why it exists.** An `oCItem` carries neither a name nor a visual — the
// engine reads both off the Daedalus instance the VOB stores — so the scene tree
// lists it as an anonymous `oCItem`, the viewport draws it only once the project
// resolves that instance (#424), and nothing anywhere answers "which items are
// within reach, and which of them names a script this project has not got".
// Finding an item placed wrong or lost inside geometry is the job no other view
// has.
//
// **What it reads, and what that costs.** The VOBs and their instances come in
// one `getWorldItemInstances` payload — the same call #424's drawing already
// makes, which reads one `getVobProps` per item row *inside the worker* (2,331
// rows on retail NewWorld, 28 ms for all of them) and crosses the boundary once.
// Positions come from the index the summary already carries. So the locator
// adds no round trip at all, and nothing here is per-VOB over IPC: doing it that
// way would be 2,331 round trips in a 41,393-VOB world.
//
// **"Bad" is the property grid's rule, not a second one.** The grid refuses an
// `oCItem.instance` the loaded project does not declare
// (`WorldPropertyGrid`'s `knownValues`, built from `mergedSemanticModel.items`),
// and `declared` is that same set — so an item the locator calls bad is exactly
// one the field would refuse.
//
// What the payload cannot say: an `oCItem` whose `instance` is **empty** is
// dropped by the worker before it ever reaches this list (an item that spawns
// nothing has no visual to resolve), and an item whose name is only in a script
// file the project did not ingest looks bad. Both are limits of the index rather
// than of the filter.

/** The radius Spacer's locator ships with, in metres — its reference 3,000 in
 *  ZenGin centimetres. */
export const LOCATOR_DEFAULT_RADIUS_M = 30;

/** One placed item, as the locator lists it. */
export interface LocatorItem {
  /** The VOB's index in the summary's columns — what a click selects. */
  vob: number;
  /** ZenGin centimetres, the same space every other position is in. */
  at: [number, number, number];
  /** The `oCItem.instance` the world stores. */
  instance: string;
  /** The `name` its declaration carries, or the instance when nothing declares
   *  it — the name a player reads, which is what a search is usually about. */
  name: string;
  /** No declaration in the loaded project: the instance the grid would refuse,
   *  and the item ZenGin would spawn nothing for. */
  bad: boolean;
}

export interface LocatorQuery {
  /** Matched against the display name and the instance, in any case. */
  search: string;
  /** Keep only what the project cannot resolve. */
  badOnly: boolean;
}

/** What the viewport draws: the candidates the switches kept, and the radius
 *  around the camera within which each one gets a ring. */
export interface LocatorView {
  items: readonly LocatorItem[];
  radiusCm: number;
}

/**
 * Every item VOB the world holds that passes `query`, in VOB order.
 *
 * `declared` is the grid's own set — uppercased instance names the loaded
 * project declares — and `catalogue` is only for the display name beside it.
 * An instance the world spells in another case still resolves, which is how
 * every other item lookup in the app answers.
 */
export function locatorItemsOf(
  instances: ItemInstances | null,
  index: VobIndex,
  declared: ReadonlySet<string>,
  catalogue: readonly CatalogueItem[],
  query: LocatorQuery,
): LocatorItem[] {
  if (instances === null) return [];

  const names = new Map(catalogue.map((item) => [item.instance.toUpperCase(), item.name]));
  const positions = new Float32Array(index.positions);
  const needle = query.search.trim().toLowerCase();
  const matched: LocatorItem[] = [];

  for (let at = 0; at < instances.vobs.length; at++) {
    const vob = instances.vobs[at];
    // A pixel would be drawn at NaN for a VOB the index no longer places.
    if (vob >= index.count) continue;
    const instance = instances.instances[at];
    // An item with no instance is not one the property grid can describe, and
    // the worker already leaves those out; this is the same rule, stated once.
    if (instance === '') continue;

    const key = instance.toUpperCase();
    const bad = !declared.has(key);
    if (query.badOnly && !bad) continue;

    const name = names.get(key) ?? instance;
    if (needle !== ''
      && !name.toLowerCase().includes(needle)
      && !instance.toLowerCase().includes(needle)) continue;

    matched.push({
      vob,
      at: [positions[vob * 3], positions[vob * 3 + 1], positions[vob * 3 + 2]],
      instance,
      name,
      bad,
    });
  }

  return matched;
}

/**
 * What a sphere of `radiusCm` around `center` reaches, nearest first — Spacer's
 * radius, whose reference value is 3,000.
 *
 * True 3D distance, the rule the scene tree's "within reach of the camera"
 * filter already measures by: an item on a ledge overhead is within reach of a
 * radius that names it, and a plane would lose it.
 */
export function nearbyItems(
  items: readonly LocatorItem[],
  center: readonly [number, number, number],
  radiusCm: number,
): LocatorItem[] {
  const reach = radiusCm ** 2;
  return items
    .map((item) => ({
      item,
      distance: (item.at[0] - center[0]) ** 2
        + (item.at[1] - center[1]) ** 2
        + (item.at[2] - center[2]) ** 2,
    }))
    .filter((entry) => entry.distance <= reach)
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.item);
}
