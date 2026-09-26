// Which class a placed visual should be (#290), and whether an asset is a VOB
// or a MOB (#288) — one rule for both, read off the visual's name.
//
// ZenGin stores no interaction scheme on a MOB: it reads it off the visual's
// name, the part before the first underscore (`BENCH_1_OC.ASC` is `BENCH`), and
// looks up the `BENCH` animations in the humans' model script. ZenKit models no
// `scemeName` field either (spacer-gap-triage.md, B). So a MOB is an *animated
// model* whose name starts with a scheme, and the scheme says which class plays
// it: a chest opens as an `oCMobContainer`, a door as an `oCMobDoor`, a seat or
// a workbench as a plain `oCMobInter`.
//
// **A static mesh is never a MOB**, whatever it is called: it has no animations
// for a scheme to play. That is the half that answers Florian's worry — rocks
// and bushes placed as `oCMobInter` — because a `.3DS` or `.MRM` always comes
// out a plain `zCVob`.
//
// The schemes are Gothic II's as the modding community documents them, not a
// table measured off the retail worlds; that measurement wants a Gothic install
// and would replace the list below rather than sit beside it. What *is*
// measured (level-editor.md §16.15, NewWorld + OldWorld): 538 `oCMobInter`, 224
// `oCMobContainer`, 224 `oCMobDoor`, 27 `oCMobSwitch`, 7 `oCMobBed`, 1
// `oCMobWheel`, no `oCMobLadder` — so beds are `oCMobInter`, the majority, and
// `oCMobBed` is left for an author who asks for it. Fires (`oCMobFire`, 134) are
// out: a fire is a rigged model with a fire template on a named bone, and the
// class is not authorable here.

import { assetKey } from './assetCatalog';
import { focusNameExpectation, type AuthorableVobClass } from './vobClasses';

/** The formats an animated model comes in, source and compiled. */
const MODEL_EXTENSIONS = ['.ASC', '.MDS', '.MDL', '.MDM', '.MSB'];

/** Every visual a placement can carry — static meshes and models alike. */
const VISUAL_EXTENSIONS = ['.3DS', '.MRM', '.MSH', '.MMS', '.MMB', ...MODEL_EXTENSIONS];

const MOB_SCHEMES: Readonly<Record<string, AuthorableVobClass>> = {
  CHESTBIG: 'oCMobContainer',
  CHESTSMALL: 'oCMobContainer',
  DOOR: 'oCMobDoor',
  LADDER: 'oCMobLadder',
  LEVER: 'oCMobSwitch',
  TOUCHPLATE: 'oCMobSwitch',
  TURNSWITCH: 'oCMobSwitch',
  VWHEEL: 'oCMobWheel',
  // Seats and beds.
  BENCH: 'oCMobInter',
  CHAIR: 'oCMobInter',
  THRONE: 'oCMobInter',
  BED: 'oCMobInter',
  BEDHIGH: 'oCMobInter',
  BEDLOW: 'oCMobInter',
  // Work places.
  CAULDRON: 'oCMobInter',
  PAN: 'oCMobInter',
  STOVE: 'oCMobInter',
  BSANVIL: 'oCMobInter',
  BSFIRE: 'oCMobInter',
  BSCOOL: 'oCMobInter',
  BSSHARP: 'oCMobInter',
  LAB: 'oCMobInter',
  BOOK: 'oCMobInter',
  BAUMSAEGE: 'oCMobInter',
  RMAKER: 'oCMobInter',
  REPAIR: 'oCMobInter',
  WATERPIPE: 'oCMobInter',
  ORE: 'oCMobInter',
  SMOKE: 'oCMobInter',
  HERB: 'oCMobInter',
  // Shrines.
  INNOS: 'oCMobInter',
  IDOL: 'oCMobInter',
};

/** The classes a placement may hand a visual to: a plain VOB and the MOB family. */
const VISUAL_CLASSES = new Set<string>([
  'zCVob', 'oCMobInter', 'oCMobBed', 'oCMobContainer', 'oCMobDoor', 'oCMobLadder', 'oCMobSwitch', 'oCMobWheel',
]);

export interface MobSuggestion {
  scheme: string;
  class: AuthorableVobClass;
  /** Retail's name for the class where it has one to give — the measured
   *  `focusNameExpectation` for a container and a door. An `oCMobInter`'s name
   *  depends on what it is (30-odd values), so it gets none. */
  focusName?: string;
}

const extensionOf = (name: string) => {
  const bare = name.slice(name.lastIndexOf('/') + 1).toUpperCase();
  const dot = bare.lastIndexOf('.');
  return dot < 0 ? '' : bare.slice(dot);
};

/** Whether `visual` is an animated model — the only kind of visual a scheme can
 *  be played on. A static mesh on a MOB class is a rock that answers the
 *  crosshair and does nothing. */
export function isModelVisual(visual: string): boolean {
  return MODEL_EXTENSIONS.includes(extensionOf(visual));
}

/** The interaction scheme ZenGin would read off `visual`'s name. */
export function schemeOf(visual: string): string {
  const key = assetKey(visual);
  const cut = key.indexOf('_');
  return cut < 0 ? key : key.slice(0, cut);
}

/** The MOB class a placement of `visual` should be, or null for a plain VOB. */
export function mobClassOf(visual: string): MobSuggestion | null {
  if (!isModelVisual(visual)) return null;
  const scheme = schemeOf(visual);
  const cls = MOB_SCHEMES[scheme];
  if (cls === undefined) return null;
  const focusName = cls === 'oCMobInter' ? undefined : focusNameExpectation(cls)?.example;
  return focusName === undefined ? { scheme, class: cls } : { scheme, class: cls, focusName };
}

/** A MOB, any other placeable visual, or null for a file that is not one. */
export function assetRole(name: string): 'mob' | 'vob' | null {
  if (mobClassOf(name) !== null) return 'mob';
  return VISUAL_EXTENSIONS.includes(extensionOf(name)) ? 'vob' : null;
}

/** Whether a placement of `cls` carries a visual. */
export function carriesVisual(cls: string): boolean {
  return VISUAL_CLASSES.has(cls);
}
