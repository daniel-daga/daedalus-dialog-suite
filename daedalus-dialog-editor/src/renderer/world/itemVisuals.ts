import type { ItemInstances, VisualOverrides } from '../../shared/worldTypes';

// What an `oCItem` is drawn as (#424). An item stores no visual — the engine
// reads one off the script instance the VOB names — so the world has nothing to
// draw and the viewport drew a marker where the mesh should be. Two pure steps
// turn the project's scripts into the answer, and both are here rather than in
// the surface because that is where they can be checked without a world:
//
//   - `itemVisualOfSource` reads the one line a `C_ITEM` declaration uses.
//     Deliberately the same regex the Assets panel's item preview uses
//     (`WorldSurface`'s `itemVisuals`): two readers of one field drifting apart
//     would draw an item's picture in one place and not the other.
//   - `visualOverridesOf` joins that with the item VOBs the world carries.
//
// An item the project does not resolve — a script that is not open, an instance
// the project's sources do not declare, or a `visual` assigned through a
// constant, which this reader does not evaluate — is left out, so it keeps the
// marker it has today. Nothing here writes to the world: it is a draw-time
// resolution.

/** The `visual` an item declaration assigns, or null where it assigns none —
 *  a symbol rather than a quoted name is not a file, and is not evaluated. */
export function itemVisualOfSource(sourceText: string | undefined): string | null {
  const match = /\bvisual\s*=\s*"([^"]+)"/i.exec(sourceText ?? '');
  return match === null ? null : match[1];
}

/**
 * The visual to draw each of `instances`' VOBs as, by flat index, or undefined
 * where none of them resolved.
 *
 * `itemVisuals` is the project's item instances by **uppercased** name, which is
 * how an item is looked up everywhere else, and how a world that spells an
 * instance in another case still resolves.
 */
export function visualOverridesOf(
  instances: ItemInstances,
  itemVisuals: ReadonlyMap<string, string>,
): VisualOverrides | undefined {
  const vobs: number[] = [];
  const visuals: string[] = [];
  for (let at = 0; at < instances.vobs.length; at++) {
    const visual = itemVisuals.get(instances.instances[at].toUpperCase());
    if (visual === undefined) continue;
    vobs.push(instances.vobs[at]);
    visuals.push(visual);
  }
  return vobs.length === 0 ? undefined : { vobs, visuals };
}
