// The per-class field catalogue (level-editor.md §14.1 item 1.4, Phase 1b-2).
//
// Everything the editor has written so far is on `zCVob`: a position, a
// rotation, a name, a visual, six flags. The fields that make a VOB the thing it
// *is* — the Daedalus instance an `oCItem` spawns, the range and the colour a
// `zCVobLight` lights with — live on the subclasses, and **none of them are in
// the columnar index**: `vobIndex` interns the class *name* and carries not one
// field of the class. That is the fact the whole per-class op is shaped around,
// and it is why this table exists rather than eight more optional keys on
// `VobProps`.
//
// One table, here, because three allowlists already have to move in lockstep
// with nothing shared between them: the binding's `kKnownKeys`, the editor's
// `VOB_FLAG_KEYS`, and `PROP_KEYS` next door. The op builder, the IPC validator
// and the property grid can all read this one, so adding a class is one entry
// rather than three that agree by hand. The C++ table stays separate and
// unavoidable — what ties it to this one is a per-key round-trip test in
// `zenkit-node`, not a shared constant.
//
// It is deliberately narrow. Enums are out because retail data contains
// out-of-range enum values (`zCMover.lerpMode` is 120 on three VOBs) and a
// dropdown that cannot represent one destroys it on write; unbounded lists are
// out because they are the first payloads with no length to cap; and
// `zCVobLight.isStatic` is out because flipping it changes *which fields the
// archive contains*, so its inverse does not restore the world. Each of those is
// a decision, and each belongs with the first class that forces it.

/**
 * What a class field's value can be.
 *
 * Five kinds: a plain string, a finite scalar, a whole number, a flag, and a
 * small fixed-arity array of integers. Nothing here is a nested record, which is
 * what keeps the op's IPC assertion a flat walk over keys.
 *
 * `int` is not a `float` with a rule attached. A `float` field whose archive
 * member is an `int32_t` truncates on write and reports success, so the two are
 * separated at the *type* rather than at the one validator that happens to
 * remember — the grid, the IPC check and the binding each read `kind`.
 */
export type ClassPropValue = string | number | boolean | readonly number[];

/** A VOB's class fields as an op carries them — only the keys being written. */
export interface ClassProps {
  [key: string]: ClassPropValue;
}

/**
 * One field: what it is called, what kind of value it takes, and the bounds a
 * value outside of which is refused.
 *
 * The bounds live in the catalogue rather than in the validator because the grid
 * needs the same numbers to reject a typed value before it commits one, and two
 * hand-written copies of "0 to 255" is one copy too many. For a colour they are
 * per channel. A `bool` has none: there is nothing between false and true to
 * refuse.
 */
export interface FieldDescriptor {
  key: string;
  kind: 'string' | 'float' | 'int' | 'bool' | 'color';
  min?: number;
  max?: number;
}

/** The Daedalus instance the item spawns from — free text at this layer, with
 *  the same trust level `name` has: validating it against the parser's item
 *  index would couple the World surface to the semantic model. */
const OC_ITEM_FIELDS = [
  { key: 'instance', kind: 'string' },
] as const satisfies readonly FieldDescriptor[];

const ZC_VOB_LIGHT_FIELDS = [
  { key: 'range', kind: 'float', min: 0 },
  { key: 'color', kind: 'color', min: 0, max: 255 },
] as const satisfies readonly FieldDescriptor[];

/**
 * What a sound is: which script instance it plays, how loud, how far, and the
 * cone it is audible in.
 *
 * `mode` and `volumeType` are enums and stay out by the rules at the top of this
 * file. `randomDelay` and `randomDelayVar` are left out for a different reason:
 * the engine reads them only when `mode` is RANDOM, and `mode` is precisely what
 * this catalogue cannot set — so both would be legal writes the engine ignores,
 * which reads to a user as the editor having done nothing.
 *
 * `volume` has no maximum, against ZenKit's own "percent (0-100)" doc comment:
 * measured 2026-08-27 over the three retail worlds, NewWorld holds 130 on two
 * sounds and 150 on four, so a max of 100 refuses values the game itself ships.
 */
const ZC_VOB_SOUND_FIELDS = [
  { key: 'soundName', kind: 'string' },
  { key: 'volume', kind: 'float', min: 0 },
  { key: 'radius', kind: 'float', min: 0 },
  { key: 'coneAngle', kind: 'float', min: 0, max: 360 },
  { key: 'initiallyPlaying', kind: 'bool' },
  { key: 'ambient3d', kind: 'bool' },
  { key: 'obstruction', kind: 'bool' },
] as const satisfies readonly FieldDescriptor[];

/**
 * `zCVobSoundDaytime` **derives from** `zCVobSound`, so its entry inherits the
 * base fields rather than restating them — the binding's case does the same, and
 * an editor that offered a radius on one and not on the other would be
 * describing the class hierarchy wrongly.
 *
 * The two times are hours of the day, `13.5` being 13:30. They are bounded
 * rather than wrapped: a caller who means midnight means 0.
 */
const ZC_VOB_SOUND_DAYTIME_FIELDS = [
  ...ZC_VOB_SOUND_FIELDS,
  { key: 'startTime', kind: 'float', min: 0, max: 24 },
  { key: 'endTime', kind: 'float', min: 0, max: 24 },
  { key: 'soundName2', kind: 'string' },
] as const satisfies readonly FieldDescriptor[];

/** `innerRangePercentage` is stored 0..1, not 0..100 — measured, 2026-08-27,
 *  because ZenKit's docs say "Unknown": across the three retail worlds every
 *  stored value (far-plane and fog zones alike, placed and `…Default`) is in
 *  [0.1, 1.0], and the world-default zones hold exactly 1.0 — 100% stored as
 *  1.0. Hence `max: 1`. */
const ZC_ZONE_VOB_FAR_PLANE_FIELDS = [
  { key: 'vobFarPlaneZ', kind: 'float', min: 0 },
  { key: 'innerRangePercentage', kind: 'float', min: 0, max: 1 },
] as const satisfies readonly FieldDescriptor[];

/**
 * `overrideColor` is deliberately the field *immediately before* the colour,
 * because catalogue order is the order the grid draws in and the two are one
 * setting: ZenGin reads `color` only while `overrideColor` is true, so a colour
 * shipped without its switch was a legal write the engine ignored, and that
 * reads to a user as the editor having done nothing.
 */
const ZC_ZONE_Z_FOG_FIELDS = [
  { key: 'rangeCenter', kind: 'float', min: 0 },
  // 0..1 by the same measurement as the far-plane zone's entry above.
  { key: 'innerRangePercentage', kind: 'float', min: 0, max: 1 },
  { key: 'fadeOutSky', kind: 'bool' },
  { key: 'overrideColor', kind: 'bool' },
  { key: 'color', kind: 'color', min: 0, max: 255 },
] as const satisfies readonly FieldDescriptor[];

/**
 * All six fields, in the order `VZoneMusic` declares them — which is also the
 * order the archive stores them in, so the grid reads like the file.
 *
 * `priority` is the catalogue's first `int`, and it is the field the `int` kind
 * exists for: it is an `int32_t` in the struct, and offered as a `float` it
 * would take `2.5`, truncate on the cast and report success. Its `min: 0` was
 * ZenKit's documented floor ("`0` is the lowest possible priority") and is now
 * also measured (2026-08-27): across the three retail worlds the observed
 * priorities run 0 (the three `oCZoneMusicDefault`s) to 30 (AddonWorld), with
 * no negative anywhere.
 *
 * Neither float is bounded. ZenKit documents both as "unclear", ZenGin's reverb
 * level is negative decibels, and an invented bound refuses data a world holds.
 */
const OC_ZONE_MUSIC_FIELDS = [
  { key: 'enabled', kind: 'bool' },
  { key: 'priority', kind: 'int', min: 0 },
  { key: 'ellipsoid', kind: 'bool' },
  { key: 'reverb', kind: 'float' },
  { key: 'volume', kind: 'float' },
  { key: 'loop', kind: 'bool' },
] as const satisfies readonly FieldDescriptor[];

/**
 * Class name → the fields the editor writes on it, in the order it draws them.
 *
 * `as const satisfies` for the same reason `PROP_KEYS` has it: the literal types
 * survive, so `kind` is checked against the three the validator switches on
 * rather than being widened to `string` and discovered at runtime.
 */
export const CLASS_FIELDS = {
  oCItem: OC_ITEM_FIELDS,
  zCVobLight: ZC_VOB_LIGHT_FIELDS,
  zCVobSound: ZC_VOB_SOUND_FIELDS,
  zCVobSoundDaytime: ZC_VOB_SOUND_DAYTIME_FIELDS,
  zCZoneVobFarPlane: ZC_ZONE_VOB_FAR_PLANE_FIELDS,
  zCZoneZFog: ZC_ZONE_Z_FOG_FIELDS,
  oCZoneMusic: OC_ZONE_MUSIC_FIELDS,
} as const satisfies Record<string, readonly FieldDescriptor[]>;

/** A class the catalogue knows. Not every class in a world is one — a world has
 *  37 and this has seven, which is the point of asking through `fieldOf`. The
 *  `…Default` zone variants are deliberately absent: `zCZoneZFogDefault` and its
 *  two siblings are a world's fallback settings rather than placed zones. */
export type ClassName = keyof typeof CLASS_FIELDS;

/** Shared rather than allocated per miss: `classPropKeys` is called on every
 *  render of the property grid, and most VOBs are of a class with no entry. */
const NO_FIELDS: readonly FieldDescriptor[] = [];

/**
 * The fields catalogued for `className`, empty for one that is not catalogued.
 *
 * The class name arrives from a world, so the lookup is a boundary and is
 * `hasOwnProperty` rather than an index plus `??`: a plain object literal answers
 * `CLASS_FIELDS['toString']` with a *function*, and the grid would be handed a
 * method to iterate.
 */
function fieldsOf(className: string): readonly FieldDescriptor[] {
  return Object.prototype.hasOwnProperty.call(CLASS_FIELDS, className)
    ? CLASS_FIELDS[className as ClassName]
    : NO_FIELDS;
}

/** The keys of `className`'s fields, in catalogue order — the per-class
 *  analogue of `PROP_KEYS`, and the order an op writes them in so that two ops
 *  built from the same edit are the same object. */
export function classPropKeys(className: string): readonly string[] {
  return fieldsOf(className).map((field) => field.key);
}

/** The descriptor for one key of one class, or null when that class does not
 *  have it — which is how a cross-class key is refused before it is ever built
 *  into an op. */
export function fieldOf(className: string, key: string): FieldDescriptor | null {
  return fieldsOf(className).find((field) => field.key === key) ?? null;
}
