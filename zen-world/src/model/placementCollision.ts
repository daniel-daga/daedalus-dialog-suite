// The collision a freshly placed VOB is given (#291) — pure, over the visual's
// name, in the idiom of `assetCatalog.ts`.
//
// Everything collides, which is also what the binding defaults an `AddVob` to.
// The exception is soft vegetation: bushes, grass, ferns, reeds and the like are
// walked through in the game, and before this rule every one of them had to be
// switched off by hand after it was placed.
//
// A name rule rather than a category one. The seed's `Pflanzen` category holds
// jungle trees, dead trees and cacti next to the bushes, so "off for the plant
// category" would make trees walk-through — so a solid token (`TREE`, `STUMPF`
// …) outranks a soft one, and a visual only loses collision when it names
// something soft and nothing solid. Matched as substrings of the bare name,
// because ZenGin's names are compounds (`WALLFERN`, `SIDEPLANT`, `GRASSGROUP`).
//
// What this does not know is what the retail worlds actually set per visual;
// that wants a Gothic install to read them from, and would replace the lists
// below rather than sit beside them.

import { assetKey } from './assetCatalog';

export interface PlacementCollision {
  cdStatic: boolean;
  cdDynamic: boolean;
}

/** Names that are walked through. */
const SOFT = [
  'BUSH', 'GRASS', 'WEED', 'FARN', 'FERN', 'REED', 'LIANA', 'PLANT', 'WATERLILI', 'MUSHROOM',
  'BLAETTERDACH',
];

/** Names that stop the player, whatever else they say. */
const SOLID = ['TREE', 'PALM', 'TANNE', 'STAMM', 'STUMPF', 'ROOT', 'CACTUS', 'TRUNK'];

export function placementCollision(visual: string): PlacementCollision {
  const key = assetKey(visual);
  const soft = SOFT.some((token) => key.includes(token)) && !SOLID.some((token) => key.includes(token));
  return { cdStatic: !soft, cdDynamic: !soft };
}
