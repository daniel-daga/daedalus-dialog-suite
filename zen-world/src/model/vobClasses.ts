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
 * Six kinds: a plain string, a finite scalar, a whole number, a flag, a small
 * fixed-arity array of integers (`color`, four channels) and one of floats
 * (`vec2`, the two components of a decal's size or offset). Nothing here is a
 * nested record, which is what keeps the op's IPC assertion a flat walk over
 * keys — `DECAL_FIELDS` below is flat for exactly that reason, even though the
 * props record answers those seven fields nested.
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
 * The whole record `getVobProps` answers, as the op builders read it.
 *
 * Wider than `ClassProps` in one way only: the reader carries a nested record
 * for a decal visual, and an op that names a decal field reads its `from` side
 * out of it. Nothing writes nested — `DECAL_FIELDS` is flat — so this shape is
 * the *read* side alone.
 */
export interface ReadProps {
  [key: string]: ClassPropValue | ReadProps | null | undefined;
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
  kind: 'string' | 'float' | 'int' | 'bool' | 'color' | 'vec2';
  min?: number;
  max?: number;
}

/** The Daedalus instance the item spawns from — free text *at this layer*, with
 *  the same trust level `name` has.
 *
 *  It is no longer free text end to end. `zen-world` is a pure domain package
 *  and holds no script project, so the catalogue cannot say which instances
 *  exist; the two layers that can, do. The editor's property grid refuses a name
 *  absent from the parser's item index when one is loaded (and refuses nothing
 *  when none is, since a world may be edited with no project open), and
 *  `assertApplyOpsRequest` refuses a `to.instance` that is not the shape of a
 *  Daedalus symbol — the strongest check a process holding no item index can
 *  make. A name no script declares crashes ZenGin when the item spawns
 *  (level-editor.md §14.1). */
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
 *
 * `coneAngle` 0-360 was documentation-only until swept 2026-08-27 over the same
 * three worlds: every one of 1,237 `zCVobSound`/`zCVobSoundDaytime` VOBs holds
 * `0` (retail never uses a directional cone), so nothing in the corpus tests the
 * bound — but nothing refutes it either, and 0-360 is what a cone angle means.
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
 *
 * 0-24 was documentation-only until swept 2026-08-27 over the three retail
 * worlds: 84 `zCVobSoundDaytime` VOBs hold `startTime` in [5, 8] and `endTime`
 * in [12, 23] — well inside the bound, so the sweep confirms rather than
 * falsifies it.
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

/** Whether to start the animation when the level loads — the one field
 *  `zCVobAnimate` has. Started/stopped at runtime via `OnTrigger`/`OnUntrigger`,
 *  which are events, not state this catalogue holds. */
const ZC_VOB_ANIMATE_FIELDS = [
  { key: 'startOn', kind: 'bool' },
] as const satisfies readonly FieldDescriptor[];

/** All three of `zCPFXController`'s fields: which effect to play, whether it
 *  is removed once its cycle finishes, and whether it starts running when the
 *  level loads. None is an enum, so nothing on this class is held out. */
const ZC_PFX_CONTROLLER_FIELDS = [
  { key: 'pfxName', kind: 'string' },
  { key: 'killWhenDone', kind: 'bool' },
  { key: 'initiallyRunning', kind: 'bool' },
] as const satisfies readonly FieldDescriptor[];

/**
 * The eight bools and four numerics `VTrigger` itself declares — the base
 * every other class in the trigger family inherits, `zCTriggerWorldStart` and
 * `zCTriggerUntouch` excepted (neither derives from `VTrigger`). `target` and
 * `vobTarget` stay out with the rest of the family's target strings, in the
 * order the archive stores them so the grid draws like the file.
 *
 * `maxActivationCount` is left unbounded: ZenKit documents `-1` as "process an
 * infinite number of events", so a floor at 0 would refuse the one negative
 * value the field is documented to mean something by. The three delay/damage
 * floats are bounded at 0 for the same reason `radius` is on the sound family
 * — none of "seconds to wait" or "damage to react to" has a meaning below
 * zero.
 */
const ZC_TRIGGER_FIELDS = [
  { key: 'startEnabled', kind: 'bool' },
  { key: 'sendUntrigger', kind: 'bool' },
  { key: 'reactToOnTrigger', kind: 'bool' },
  { key: 'reactToOnTouch', kind: 'bool' },
  { key: 'reactToOnDamage', kind: 'bool' },
  { key: 'respondToObject', kind: 'bool' },
  { key: 'respondToPc', kind: 'bool' },
  { key: 'respondToNpc', kind: 'bool' },
  { key: 'maxActivationCount', kind: 'int' },
  { key: 'retriggerDelaySec', kind: 'float', min: 0 },
  { key: 'damageThreshold', kind: 'float', min: 0 },
  { key: 'fireDelaySec', kind: 'float', min: 0 },
] as const satisfies readonly FieldDescriptor[];

/** The first field of the trigger family, and the one non-enum, non-list field
 *  `zCTriggerWorldStart` has: whether the `OnTrigger` it fires at level load
 *  fires only the first time the level loads. `target` is the class's other
 *  field but is out for now with the rest of the family's target strings; its
 *  save-game-only `s_has_fired` needs nothing held out either, the same shape
 *  as `zCVobAnimate`'s one field. */
const ZC_TRIGGER_WORLD_START_FIELDS = [
  { key: 'fireOnce', kind: 'bool' },
] as const satisfies readonly FieldDescriptor[];

/** The one non-enum, non-list field `oCTriggerScript` has beyond the base
 *  `VTrigger` fields it holds out with the rest of the family: the script
 *  function it calls when it is about to fire an `OnTrigger`. `target` stays
 *  out with the rest of the family's target strings — the same "one field,
 *  nothing else to hold out yet" shape as `zCTriggerWorldStart`'s. */
const OC_TRIGGER_SCRIPT_FIELDS = [
  { key: 'function', kind: 'string' },
] as const satisfies readonly FieldDescriptor[];

/** The base `VTrigger` twelve, plus `oCTriggerChangeLevel`'s own two: the
 *  level to load and the VObject to place the player at in it. Both are
 *  plain config, not cross-references the way `target`/`vobTarget` are —
 *  nothing in the world names them back — so they join rather than stay held
 *  out with the rest of the family's target strings. */
const OC_TRIGGER_CHANGE_LEVEL_FIELDS = [
  ...ZC_TRIGGER_FIELDS,
  { key: 'levelName', kind: 'string' },
  { key: 'startVob', kind: 'string' },
] as const satisfies readonly FieldDescriptor[];

/** The base `VTrigger` twelve, plus thirteen of the fourteen fields `zCMover`
 *  declares beyond them, in the order `VMover` declares them. `behavior`,
 *  `lerpMode` and `speedMode` are enums and stay out with the rest of the
 *  catalogue's enums; `keyframes` is an unbounded list and stays out with the
 *  rest of those; the `s_*` save-game fields need nothing held out either.
 *  The two delay/damage-shaped floats are bounded at 0 for the same reason
 *  the base twelve's are — neither "damage to deal" nor "seconds to stay
 *  open" has a meaning below zero.
 *
 *  `speed` is held out too, and for a reason none of the rest of the family
 *  has: ZenKit's `VMover::save` writes `moveSpeed` (with `lerpMode` and
 *  `speedMode`) only `if (!keyframes.empty())` — and this catalogue cannot
 *  author `keyframes`, so on the many movers that drive their animation from
 *  the visual instead of manual keyframes, a `speed` write is silently
 *  dropped on save. The same "legal write the engine ignores" shape as
 *  `zCVobSound`'s `randomDelay`. */
const ZC_MOVER_FIELDS = [
  ...ZC_TRIGGER_FIELDS,
  { key: 'touchBlockerDamage', kind: 'float', min: 0 },
  { key: 'stayOpenTimeSec', kind: 'float', min: 0 },
  { key: 'locked', kind: 'bool' },
  { key: 'autoLink', kind: 'bool' },
  { key: 'autoRotate', kind: 'bool' },
  { key: 'sfxOpenStart', kind: 'string' },
  { key: 'sfxOpenEnd', kind: 'string' },
  { key: 'sfxTransitioning', kind: 'string' },
  { key: 'sfxCloseStart', kind: 'string' },
  { key: 'sfxCloseEnd', kind: 'string' },
  { key: 'sfxLock', kind: 'string' },
  { key: 'sfxUnlock', kind: 'string' },
  { key: 'sfxUseLocked', kind: 'string' },
] as const satisfies readonly FieldDescriptor[];

/** The nine plain scalars `VMovableObject` declares — the base every
 *  `oCMob*` class inherits, `oCMOB` itself included (a plain, non-interactive
 *  movable object has no subclass of its own). `soundMaterial` is an enum and
 *  stays out with the rest of the catalogue's enums; nothing here is a list or
 *  save-game-only, so that is the whole of what is held out. */
const OC_MOB_FIELDS = [
  { key: 'focusName', kind: 'string' },
  { key: 'hp', kind: 'int' },
  { key: 'damage', kind: 'int' },
  { key: 'movable', kind: 'bool' },
  { key: 'takable', kind: 'bool' },
  { key: 'focusOverride', kind: 'bool' },
  { key: 'visualDestroyed', kind: 'string' },
  { key: 'owner', kind: 'string' },
  { key: 'ownerGuild', kind: 'string' },
  { key: 'destroyed', kind: 'bool' },
] as const satisfies readonly FieldDescriptor[];

/** The base nine plus the four `VInteractiveObject` adds. `target` stays out
 *  with the rest of the family's cross-reference strings; `item` (a script
 *  item-instance name) is a decision point of its own — the editor's
 *  `oCItem.instance` index check does not currently extend to it. Nothing else
 *  is a list or save-game-only. `oCMobLadder`, `oCMobSwitch` and `oCMobWheel`
 *  add nothing of their own beyond `oCMobInter`, so they share this array. */
const OC_MOB_INTER_FIELDS = [
  ...OC_MOB_FIELDS,
  { key: 'stateCount', kind: 'int' },
  { key: 'conditionFunction', kind: 'string' },
  { key: 'onStateChangeFunction', kind: 'string' },
  { key: 'rewind', kind: 'bool' },
] as const satisfies readonly FieldDescriptor[];

/** The base thirteen plus `VFire`'s own two: the bone of the rigged model the
 *  fire effect sits at, and the name of the template file that configures it.
 *  Both are plain config — neither names a script symbol — so nothing on this
 *  class is held out. */
const OC_MOB_FIRE_FIELDS = [
  ...OC_MOB_INTER_FIELDS,
  { key: 'slot', kind: 'string' },
  { key: 'vobTree', kind: 'string' },
] as const satisfies readonly FieldDescriptor[];

/** The base thirteen plus `VContainer`'s `locked` and `pickString`. `key` (the
 *  item instance that unlocks it) stays out with `item`, the same cross-
 *  reference decision. `contents` stays out too: it is a single string in the
 *  archive, but it encodes a comma-separated list of item instances and
 *  counts, the same "names script symbols this catalogue cannot validate"
 *  shape as `key` — not the unbounded-list reason `keyframes` is held out by. */
const OC_MOB_CONTAINER_FIELDS = [
  ...OC_MOB_INTER_FIELDS,
  { key: 'locked', kind: 'bool' },
  { key: 'pickString', kind: 'string' },
] as const satisfies readonly FieldDescriptor[];

/** The base thirteen plus `VDoor`'s `locked` and `pickString`; `key` stays out
 *  for the same cross-reference reason as the container's. */
const OC_MOB_DOOR_FIELDS = [
  ...OC_MOB_INTER_FIELDS,
  { key: 'locked', kind: 'bool' },
  { key: 'pickString', kind: 'string' },
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
  zCVobAnimate: ZC_VOB_ANIMATE_FIELDS,
  zCPFXController: ZC_PFX_CONTROLLER_FIELDS,
  zCTrigger: ZC_TRIGGER_FIELDS,
  zCTriggerWorldStart: ZC_TRIGGER_WORLD_START_FIELDS,
  oCTriggerScript: OC_TRIGGER_SCRIPT_FIELDS,
  oCTriggerChangeLevel: OC_TRIGGER_CHANGE_LEVEL_FIELDS,
  zCMover: ZC_MOVER_FIELDS,
  oCMOB: OC_MOB_FIELDS,
  oCMobInter: OC_MOB_INTER_FIELDS,
  oCMobLadder: OC_MOB_INTER_FIELDS,
  oCMobSwitch: OC_MOB_INTER_FIELDS,
  oCMobWheel: OC_MOB_INTER_FIELDS,
  oCMobFire: OC_MOB_FIRE_FIELDS,
  oCMobContainer: OC_MOB_CONTAINER_FIELDS,
  oCMobDoor: OC_MOB_DOOR_FIELDS,
} as const satisfies Record<string, readonly FieldDescriptor[]>;

/**
 * The classes the editor can *place*, as against the ones it can edit
 * (level-editor.md §16.15).
 *
 * Two different questions, and the answer to the second is longer: a class is
 * editable when this file lists its fields, and authorable only when the binding
 * has a field-complete construction for it — ZenKit's structs leave fields
 * uninitialized, so a class authored from a type tag would be garbage the writer
 * happily saves.
 *
 * It lives here so the list is written **twice and not four times**. The op's
 * `class`, the IPC validator's closed set and the placement dialog's options all
 * read it, and a class added to two of the three used to be a class the third
 * refused. What stays separate is the C++ dispatch, which is the construction
 * itself and cannot be shared; a per-class insertion test in `zenkit-node` is
 * what ties the two lists together.
 *
 * **Every trigger I3 added is inert until its `target` is reachable, and
 * `target` is not in the catalogue.** A trigger's whole purpose is the
 * `OnTrigger` it forwards, and the field naming where it goes is held out with
 * the rest of the family's cross-reference strings — so a placed `zCTrigger`
 * fires at nothing and the grid offers no way to change that. Not a defect of
 * the construction: the same holds for every retail trigger the editor can
 * already *edit*. A `zCMover` is the one member that does something on its own,
 * since it moves along its visual's animation.
 *
 * Three of the seven go further and carry no catalogued field at all —
 * `zCTriggerList`, `zCCodeMaster` and `zCMessageFilter` — because what
 * configures each is a list (`targets`, `slaves`) or an enum (`mode`,
 * `onTrigger`/`onUntrigger`), and the catalogue holds neither by the rules at
 * the top of this file. **Authorable with no editable field is a real state
 * since I3**, and the dialog offers those three knowing it.
 */
export const AUTHORABLE_VOB_CLASSES = [
  'zCVob',
  'oCItem',
  'zCVobLight',
  'zCVobSound',
  'zCVobSoundDaytime',
  // The trigger family (I3). Two of the names are the trap: everyday speech and
  // the board card say `zCTriggerScript` and `zCTriggerChangeLevel`, and both
  // are spelled with the `oC` prefix everywhere a world, a dump or the binding
  // is involved — so those are the names here.
  'zCTrigger',
  'zCTriggerList',
  'oCTriggerScript',
  'oCTriggerChangeLevel',
  'zCMover',
  'zCCodeMaster',
  'zCMessageFilter',
  // The movable-object family (I4), and `oCTouchDamage` with it -- not one of
  // them (it derives straight from `zCVob`) but the other volume a designer
  // places by hand, and carrying the same name trap the trigger family did:
  // ZenKit's own documentation says `zCTouchDamage`, and a world says `oC`.
  //
  // Two classes of this family stay editable-only. `oCMOB` and `oCMobFire` are
  // catalogued above and are not in I4's list; a fire is only ever a rigged
  // model with a fire template on a named bone, none of which is authorable
  // here. And two of the eight are the I3 state from the other side --
  // `oCMobBed` and `oCTouchDamage` are placeable with no catalogued field,
  // the bed because `CLASS_FIELDS` has no entry for it though its fields are
  // exactly `oCMobInter`'s, the damage volume because it has never been
  // catalogued. Both work unaided: a placed bed is a bed and a placed damage
  // volume deals retail's own 1000 point damage.
  'oCMobInter',
  'oCMobBed',
  'oCMobLadder',
  'oCMobSwitch',
  'oCMobWheel',
  'oCMobDoor',
  'oCMobContainer',
  'oCTouchDamage',
] as const;


/** A class `insertVob` can construct. */
export type AuthorableVobClass = (typeof AUTHORABLE_VOB_CLASSES)[number];

/** Whether a value names a class the binding can author — the check the IPC
 *  validator makes on an `AddVob`, on a value that arrived from a renderer. */
export function isAuthorableVobClass(value: unknown): value is AuthorableVobClass {
  return typeof value === 'string'
    && (AUTHORABLE_VOB_CLASSES as readonly string[]).includes(value);
}

/** A class the catalogue knows. Not every class in a world is one — a world has
 *  37 and this has eighteen, which is the point of asking through `fieldOf`. The
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

/**
 * The `zCVob` base fields the property grid writes that are **not** in the
 * columnar index (level-editor.md §16.17, V1).
 *
 * They are descriptors rather than a bare key list for the reason the class
 * fields are: the grid parses a typed value against the same bounds the IPC
 * validator refuses one by, and two hand-written copies of "0 to 31" is one copy
 * too many. They are kept out of `CLASS_FIELDS` because they belong to no class
 * — every VOB has them — and folding them in would make `classPropKeys` answer
 * non-empty for a class the catalogue does not know, which is the check
 * `SetVobClassProp` refuses an unknown class by.
 *
 * **Both numbers are bounded by the packed vob layout, not by their archive
 * types.** ZenGin writes a VObject either packed — every scalar in one `dataRaw`
 * blob — or unpacked, and the packed layout gives `visualCamAlign` two bits and
 * `bias` five: an `int32_t` bias of 32 is written as 0 and reported as written.
 * The alignment's bound is those two bits rather than `SpriteAlignment`'s three
 * named values, because retail carries the fourth — 7 VOBs of the three worlds'
 * 41,393 hold 3 — and a bound that refused it would make an edit on one of them
 * un-undoable, since the inverse writes back the value that was there.
 *
 * **`dynamicShadows` (V2) is bounded the same way**: `(bit0 & 0b11000000) >> 6`,
 * so 0-3 rather than `ShadowType`'s NONE and BLOB. Retail holds only those two
 * (41,260 zero and 133 one over the same 41,393), so nothing in the corpus needs
 * the wider bound — it is here because the *layout* is what silently truncates,
 * and V1 already settled that as the rule.
 *
 * **`sleepMode` is deliberately not here.** `VirtualObject` reads and writes it
 * only under `is_save_game()`, so a value set on a world archive is dropped on
 * write and reads back as 0 — which is what all 41,393 retail VOBs hold. An
 * editable field whose write does not survive a save is worse than a missing
 * one. It was listed for V2 (§16.17) before the field was traced.
 */
export const BASE_FIELDS = [
  { key: 'presetName', kind: 'string' },
  { key: 'visualCamAlign', kind: 'int', min: 0, max: 3 },
  { key: 'bias', kind: 'int', min: 0, max: 31 },
  { key: 'dynamicShadows', kind: 'int', min: 0, max: 3 },
] as const satisfies readonly FieldDescriptor[];

/** The descriptor for a base field, or null for a key that is not one — the
 *  `fieldOf` of the fields no class owns. */
export function baseFieldOf(key: string): FieldDescriptor | null {
  return BASE_FIELDS.find((field) => field.key === key) ?? null;
}

/**
 * The fields of a decal visual (level-editor.md §16.17, V2).
 *
 * A third table for a third reason. These are not class fields — every one of
 * the 1,932 decals in retail NewWorld/OldWorld/AddonWorld sits on a plain
 * `zCVob`, so no class implies them — and they are not base fields either,
 * because they are legal only on a VOB whose visual *is* a decal. That is a
 * per-VOB condition no class name answers, so it is a table of its own and the
 * three lookups stay separate.
 *
 * **The keys are prefixed and flat.** `getVobProps` answers a decal as a nested
 * record, but an op that carried one would be the first nested payload in the
 * key set the IPC assertion walks. `decalSubKey` is the one place the two views
 * are tied together.
 *
 * Bounds measured 2026-08-28 over the same three worlds: dimensions run 10-550
 * and every offset is [0,0]. A size cannot be negative and an offset can, so
 * only `decalDimension` is floored. `decalAlphaFunc` is an `AlphaFunction` and
 * retail stays inside its seven values (1, 2, 3, and 6 once) — unlike
 * `zCMover.lerpMode`, which is why enums are otherwise out of the catalogue.
 * `decalAlphaWeight` is the byte `write_byte` puts in the archive.
 */
export const DECAL_FIELDS = [
  { key: 'decalDimension', kind: 'vec2', min: 0 },
  { key: 'decalOffset', kind: 'vec2' },
  { key: 'decalTwoSided', kind: 'bool' },
  { key: 'decalAlphaFunc', kind: 'int', min: 0, max: 6 },
  { key: 'decalTextureAnimFps', kind: 'float', min: 0 },
  { key: 'decalAlphaWeight', kind: 'int', min: 0, max: 255 },
  { key: 'decalIgnoreDaylight', kind: 'bool' },
] as const satisfies readonly FieldDescriptor[];

/** The descriptor for a decal field, or null for a key that is not one. */
export function decalFieldOf(key: string): FieldDescriptor | null {
  return DECAL_FIELDS.find((field) => field.key === key) ?? null;
}

/** The name the props record answers a decal field under — `decalTwoSided` is
 *  `decal.twoSided`. Derived rather than tabulated, so a field added above
 *  cannot be added here wrongly. */
export function decalSubKey(key: string): string {
  const rest = key.slice('decal'.length);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}
