// The per-class field catalogue — the one table the op builder, the IPC
// validator and the property grid all read.
//
// What it is defending against is not a wrong value but three allowlists
// drifting: the binding's key table, the validator's, and the builder's. Two of
// those are TypeScript and share this one; the third is C++ and is tied to it by
// a round-trip test rather than by a constant. So the assertions here are about
// the *shape* of the table — a key that appears twice, a lookup that answers for
// a class nobody catalogued — because those are the failures that reach the
// other two readers unchanged.

import {
  AUTHORABLE_VOB_CLASSES, CLASS_FIELDS, DECAL_FIELDS, baseFieldOf, classPropKeys,
  CLASS_ENUM_FIELDS, EnumValueDescriptor, decalFieldOf, decalSubKey, enumValuesOf, fieldOf,
  isAuthorableVobClass,
} from '../src/model';

describe('the per-class field catalogue', () => {
  it('names each key once per class', () => {
    // Two descriptors for one key make `fieldOf` answer with whichever came
    // first and the grid draw the field twice — and the second one would carry
    // the bounds the validator refuses by.
    for (const [className, fields] of Object.entries(CLASS_FIELDS)) {
      const keys = fields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(classPropKeys(className)).toEqual(keys);
    }
  });

  it('catalogues the classes the increments so far write, and only those', () => {
    // The table is additive per class, so what is *not* in it is the statement:
    // a class with no entry has no class section in the grid and no legal key at
    // any layer below it. The `…Default` zone variants are the pointed absence —
    // a `zCZoneZFogDefault` is a world's fallback fog, not a placed zone.
    expect(Object.keys(CLASS_FIELDS).sort()).toEqual([
      'oCItem', 'oCMOB', 'oCMobBed', 'oCMobContainer', 'oCMobDoor', 'oCMobFire', 'oCMobInter',
      'oCMobLadder', 'oCMobSwitch', 'oCMobWheel', 'oCTouchDamage', 'oCTriggerChangeLevel',
      'oCTriggerScript', 'oCZoneMusic', 'zCCodeMaster', 'zCMessageFilter', 'zCMover',
      'zCPFXController', 'zCTrigger', 'zCTriggerList', 'zCTriggerWorldStart',
      'zCVobAnimate', 'zCVobLight', 'zCVobSound', 'zCVobSoundDaytime', 'zCZoneVobFarPlane',
      'zCZoneZFog',
    ]);
    expect(classPropKeys('oCItem')).toEqual(['instance']);
    expect(classPropKeys('zCVobLight')).toEqual(['lightType', 'range', 'color', 'quality']);
    expect(classPropKeys('zCVobSound')).toEqual([
      'soundName', 'volume', 'mode', 'radius', 'coneAngle', 'volumeType',
      'initiallyPlaying', 'ambient3d', 'obstruction',
    ]);
    expect(classPropKeys('zCZoneVobFarPlane'))
      .toEqual(['vobFarPlaneZ', 'innerRangePercentage']);
    expect(classPropKeys('zCZoneZFog'))
      .toEqual(['rangeCenter', 'innerRangePercentage', 'fadeOutSky', 'overrideColor', 'color']);
    expect(classPropKeys('oCZoneMusic'))
      .toEqual(['enabled', 'priority', 'ellipsoid', 'reverb', 'volume', 'loop']);
    for (const absent of ['zCZoneZFogDefault', 'zCZoneVobFarPlaneDefault', 'oCZoneMusicDefault']) {
      expect(classPropKeys(absent)).toEqual([]);
    }
  });

  it('gives the daytime sound the base sound fields as well as its own three', () => {
    // `zCVobSoundDaytime` derives from `zCVobSound`, and the binding's case is a
    // fallthrough onto the same `VSound` members for exactly that reason. A
    // catalogue that listed only the three extra fields would draw a daytime
    // sound with no volume and no radius, and refuse an op that set one.
    expect(classPropKeys('zCVobSoundDaytime')).toEqual([
      ...classPropKeys('zCVobSound'), 'startTime', 'endTime', 'soundName2',
    ]);
    for (const key of classPropKeys('zCVobSound')) {
      expect(fieldOf('zCVobSoundDaytime', key)).toEqual(fieldOf('zCVobSound', key));
    }
  });

  it('records the bounds a value is refused by, per kind', () => {
    // The bounds live here rather than in the validator because the grid needs
    // the same numbers to reject before it commits, and two hand-written copies
    // of "0 to 255" is one copy too many.
    expect(fieldOf('oCItem', 'instance')).toEqual({ key: 'instance', kind: 'string' });
    expect(fieldOf('zCVobLight', 'range')).toEqual({ key: 'range', kind: 'float', min: 0 });
    expect(fieldOf('zCVobLight', 'color'))
      .toEqual({ key: 'color', kind: 'color', min: 0, max: 255 });
    // No maximum on the sound volume, deliberately: ZenKit documents it as
    // "percent (0-100)", but retail NewWorld holds 130 on two sounds and 150 on
    // four — measured 2026-08-27 over all three retail worlds — so a max of 100
    // refuses values the game itself ships.
    expect(fieldOf('zCVobSound', 'volume'))
      .toEqual({ key: 'volume', kind: 'float', min: 0 });
    expect(fieldOf('zCVobSoundDaytime', 'startTime'))
      .toEqual({ key: 'startTime', kind: 'float', min: 0, max: 24 });
    // `reverb` has no bound at all: it is negative decibels in ZenGin (retail
    // holds -10 to -3.219 and nothing positive), so a `min: 0` would refuse
    // every music zone in the game.
    expect(fieldOf('oCZoneMusic', 'reverb')).toEqual({ key: 'reverb', kind: 'float' });
    // 0..1, not 0..100: measured over the three retail worlds every stored
    // value is in [0.1, 1.0] and the world-default zones hold exactly 1.0 —
    // 100% stored as 1.0. ZenKit's own docs say "Unknown", so the measurement
    // is the whole evidence.
    expect(fieldOf('zCZoneZFog', 'innerRangePercentage'))
      .toEqual({ key: 'innerRangePercentage', kind: 'float', min: 0, max: 1 });
    expect(fieldOf('zCZoneVobFarPlane', 'innerRangePercentage'))
      .toEqual({ key: 'innerRangePercentage', kind: 'float', min: 0, max: 1 });
    // A boolean carries no bounds at all — there is nothing between false and
    // true to refuse — and the descriptor says so by omitting both.
    expect(fieldOf('zCVobSound', 'obstruction'))
      .toEqual({ key: 'obstruction', kind: 'bool' });
    expect(fieldOf('zCZoneZFog', 'overrideColor'))
      .toEqual({ key: 'overrideColor', kind: 'bool' });
    // The only `int` so far, and it is bounded below rather than not at all.
    // The floor was ZenKit's documentation ("`0` is the lowest possible
    // priority") and is now also measured: across the three retail worlds the
    // observed priorities are 0 (the three `oCZoneMusicDefault`s) through 30
    // (AddonWorld), with no negative anywhere.
    expect(fieldOf('oCZoneMusic', 'priority'))
      .toEqual({ key: 'priority', kind: 'int', min: 0 });
    // An `enum` carries no bounds either, and for the opposite reason to a
    // `bool`: there is plenty outside the set, and every bit of it is a value
    // some world holds. The set is offered by the grid, not enforced here.
    expect(fieldOf('zCVobLight', 'lightType')).toEqual({ key: 'lightType', kind: 'enum' });
    expect(fieldOf('oCMobDoor', 'soundMaterial'))
      .toEqual({ key: 'soundMaterial', kind: 'enum' });
    expect(classPropKeys('zCVobAnimate')).toEqual(['startOn']);
    expect(fieldOf('zCVobAnimate', 'startOn')).toEqual({ key: 'startOn', kind: 'bool' });
    expect(classPropKeys('zCPFXController'))
      .toEqual(['pfxName', 'killWhenDone', 'initiallyRunning']);
    expect(fieldOf('zCPFXController', 'pfxName')).toEqual({ key: 'pfxName', kind: 'string' });
    expect(fieldOf('zCPFXController', 'killWhenDone'))
      .toEqual({ key: 'killWhenDone', kind: 'bool' });
    expect(fieldOf('zCPFXController', 'initiallyRunning'))
      .toEqual({ key: 'initiallyRunning', kind: 'bool' });
    expect(classPropKeys('zCTriggerWorldStart')).toEqual(['fireOnce']);
    expect(fieldOf('zCTriggerWorldStart', 'fireOnce')).toEqual({ key: 'fireOnce', kind: 'bool' });
    expect(classPropKeys('oCTriggerScript')).toEqual(['function']);
    expect(fieldOf('oCTriggerScript', 'function')).toEqual({ key: 'function', kind: 'string' });
    expect(classPropKeys('zCTrigger')).toEqual([
      'startEnabled', 'sendUntrigger', 'reactToOnTrigger', 'reactToOnTouch', 'reactToOnDamage',
      'respondToObject', 'respondToPc', 'respondToNpc', 'maxActivationCount',
      'retriggerDelaySec', 'damageThreshold', 'fireDelaySec',
    ]);
    // Left unbounded: ZenKit documents `-1` as "process an infinite number of
    // events", so a floor at 0 would refuse the one negative value the field
    // is documented to mean something by.
    expect(fieldOf('zCTrigger', 'maxActivationCount'))
      .toEqual({ key: 'maxActivationCount', kind: 'int' });
    expect(fieldOf('zCTrigger', 'fireDelaySec'))
      .toEqual({ key: 'fireDelaySec', kind: 'float', min: 0 });
    expect(fieldOf('zCTrigger', 'startEnabled')).toEqual({ key: 'startEnabled', kind: 'bool' });
    // `oCTriggerChangeLevel` inherits the base twelve and adds its own two —
    // plain config, not cross-references the way `target`/`vobTarget` are, so
    // they join rather than stay held out with the family's target strings.
    expect(classPropKeys('oCTriggerChangeLevel')).toEqual([
      ...classPropKeys('zCTrigger'), 'levelName', 'startVob',
    ]);
    for (const key of classPropKeys('zCTrigger')) {
      expect(fieldOf('oCTriggerChangeLevel', key)).toEqual(fieldOf('zCTrigger', key));
    }
    expect(fieldOf('oCTriggerChangeLevel', 'levelName'))
      .toEqual({ key: 'levelName', kind: 'string' });
    expect(fieldOf('oCTriggerChangeLevel', 'startVob'))
      .toEqual({ key: 'startVob', kind: 'string' });
    // `zCMover` inherits the base twelve and adds fourteen of its own
    // seventeen, in the order `VMover` declares them — `behavior` first.
    expect(classPropKeys('zCMover')).toEqual([
      ...classPropKeys('zCTrigger'),
      'behavior', 'touchBlockerDamage', 'stayOpenTimeSec', 'locked',
      'autoLink', 'autoRotate', 'sfxOpenStart', 'sfxOpenEnd', 'sfxTransitioning',
      'sfxCloseStart', 'sfxCloseEnd', 'sfxLock', 'sfxUnlock', 'sfxUseLocked',
    ]);
    for (const key of classPropKeys('zCTrigger')) {
      expect(fieldOf('zCMover', key)).toEqual(fieldOf('zCTrigger', key));
    }
    expect(fieldOf('zCMover', 'touchBlockerDamage'))
      .toEqual({ key: 'touchBlockerDamage', kind: 'float', min: 0 });
    expect(fieldOf('zCMover', 'stayOpenTimeSec'))
      .toEqual({ key: 'stayOpenTimeSec', kind: 'float', min: 0 });
    expect(fieldOf('zCMover', 'locked')).toEqual({ key: 'locked', kind: 'bool' });
    // `speed` is held out: ZenKit only writes it (and the two lerp/speed
    // enums) when `keyframes` is non-empty, and this catalogue cannot author
    // `keyframes` — so it is a legal write the engine silently drops on the
    // many movers that animate from their visual instead.
    expect(fieldOf('zCMover', 'speed')).toBeNull();
    expect(fieldOf('zCMover', 'sfxLock')).toEqual({ key: 'sfxLock', kind: 'string' });
    // `oCMOB` — the base every `oCMob*` class inherits: all ten fields
    // `VMovableObject` declares, `soundMaterial` in its own stored position.
    expect(classPropKeys('oCMOB')).toEqual([
      'focusName', 'hp', 'damage', 'movable', 'takable', 'focusOverride',
      'soundMaterial', 'visualDestroyed', 'owner', 'ownerGuild', 'destroyed',
    ]);
    expect(fieldOf('oCMOB', 'hp')).toEqual({ key: 'hp', kind: 'int' });
    expect(fieldOf('oCMOB', 'movable')).toEqual({ key: 'movable', kind: 'bool' });
    expect(fieldOf('oCMOB', 'owner')).toEqual({ key: 'owner', kind: 'string' });
    expect(fieldOf('oCMOB', 'soundMaterial'))
      .toEqual({ key: 'soundMaterial', kind: 'enum' });
    // `oCMobInter` — the base nine plus its own four; `target` (a cross-
    // reference, held out with the rest of the family's target strings) and
    // `item` (a script item-instance name, a decision point of its own) stay
    // out. `oCMobBed`/`Ladder`/`Switch`/`Wheel` add nothing beyond `oCMobInter`,
    // so they share the same key set.
    const OC_MOB_INTER_KEYS = [
      'focusName', 'hp', 'damage', 'movable', 'takable', 'focusOverride',
      'soundMaterial', 'visualDestroyed', 'owner', 'ownerGuild', 'destroyed',
      'stateCount', 'conditionFunction', 'onStateChangeFunction', 'rewind',
    ];
    for (const className of ['oCMobInter', 'oCMobBed', 'oCMobLadder', 'oCMobSwitch', 'oCMobWheel']) {
      expect(classPropKeys(className)).toEqual(OC_MOB_INTER_KEYS);
    }
    expect(fieldOf('oCMobInter', 'stateCount')).toEqual({ key: 'stateCount', kind: 'int' });
    expect(fieldOf('oCMobInter', 'rewind')).toEqual({ key: 'rewind', kind: 'bool' });
    expect(fieldOf('oCMobInter', 'target')).toBeNull();
    expect(fieldOf('oCMobInter', 'item')).toBeNull();
    // `oCMobFire` — the base nine plus its own two plain strings (a rigged
    // model's bone, and the fire-effect template file). Neither names a script
    // symbol, so nothing on it is held out.
    expect(classPropKeys('oCMobFire')).toEqual([...OC_MOB_INTER_KEYS, 'slot', 'vobTree']);
    expect(fieldOf('oCMobFire', 'slot')).toEqual({ key: 'slot', kind: 'string' });
    expect(fieldOf('oCMobFire', 'vobTree')).toEqual({ key: 'vobTree', kind: 'string' });
    // `oCMobContainer` — the base nine plus `locked`, `pickString` and, since
    // §16.26 row 2, `contents`: the archive's own `contains` string, a string
    // at this layer exactly as `oCItem.instance` is, with its grammar checked
    // by the IPC validator and its instances by the renderer. `key` (the item
    // instance that unlocks it) stays out with `item`.
    expect(classPropKeys('oCMobContainer'))
      .toEqual([...OC_MOB_INTER_KEYS, 'locked', 'pickString', 'contents']);
    expect(fieldOf('oCMobContainer', 'locked')).toEqual({ key: 'locked', kind: 'bool' });
    expect(fieldOf('oCMobContainer', 'pickString')).toEqual({ key: 'pickString', kind: 'string' });
    expect(fieldOf('oCMobContainer', 'contents')).toEqual({ key: 'contents', kind: 'string' });
    expect(fieldOf('oCMobContainer', 'key')).toBeNull();
    // `oCMobDoor` — the base nine plus `locked` and `pickString`; `key` stays
    // out for the same cross-reference reason as the container's.
    expect(classPropKeys('oCMobDoor')).toEqual([...OC_MOB_INTER_KEYS, 'locked', 'pickString']);
    expect(fieldOf('oCMobDoor', 'locked')).toEqual({ key: 'locked', kind: 'bool' });
    expect(fieldOf('oCMobDoor', 'pickString')).toEqual({ key: 'pickString', kind: 'string' });
    expect(fieldOf('oCMobDoor', 'key')).toBeNull();
  });

  it('puts a fog zone\'s overrideColor next to the colour it governs', () => {
    // The pairing is the whole point of the ordering: ZenGin reads
    // `zCZoneZFog.color` only while `overrideColor` is true, so a colour drawn
    // anywhere but directly under its switch is a write that reads to a user as
    // "the editor did nothing". Catalogue order is draw order.
    const keys = classPropKeys('zCZoneZFog');
    expect(keys.indexOf('color')).toBe(keys.indexOf('overrideColor') + 1);
  });

  it('gives the sound family its booleans and keeps the daytime three last', () => {
    // The booleans are base-`VSound` members, so the daytime sound inherits them
    // through the same spread its floats come through — and its own three stay
    // at the end, where the grid draws them after everything shared.
    expect(classPropKeys('zCVobSoundDaytime').slice(-3))
      .toEqual(['startTime', 'endTime', 'soundName2']);
    for (const key of ['initiallyPlaying', 'ambient3d', 'obstruction']) {
      expect(fieldOf('zCVobSoundDaytime', key)).toEqual({ key, kind: 'bool' });
    }
  });


  it('separates the classes it can place from the ones it can edit', () => {
    // Two different questions (level-editor.md §16.15): a class is editable when
    // this file lists its fields, and authorable only when the binding has a
    // field-complete construction for it. `zCVob` is authorable with no fields
    // at all, and every catalogued mover, trigger and zone is editable with no
    // construction — so neither list is a subset of the other.
    expect(isAuthorableVobClass('zCVob')).toBe(true);
    expect(classPropKeys('zCVob')).toEqual([]);
    expect(isAuthorableVobClass('zCTriggerWorldStart')).toBe(false);
    expect(classPropKeys('zCTriggerWorldStart').length).toBeGreaterThan(0);
    // And the other direction still has examples, but only the ones with no
    // fields at all: `zCVob` above and the two markers. The three I3 left
    // authorable-with-nothing-catalogued — a trigger list, a code master and a
    // message filter — are catalogued since the enums landed, so what used to
    // be "the catalogue holds neither an enum nor a list" is now only the list.
    for (const className of ['zCTriggerList', 'zCCodeMaster', 'zCMessageFilter']) {
      expect(isAuthorableVobClass(className)).toBe(true);
      expect(classPropKeys(className).length).toBeGreaterThan(0);
    }
    for (const className of ['zCVobSpot', 'zCVobStartpoint']) {
      expect(isAuthorableVobClass(className)).toBe(true);
      expect(classPropKeys(className)).toEqual([]);
    }
  });

  it('gives the trigger list the twelve it inherits and the one enum it adds', () => {
    // `VTriggerList` derives from `VTrigger`, so its case inherits the twelve
    // exactly as `zCMover`'s and `oCTriggerChangeLevel`'s do — and `mode` is
    // the one field of its own that is not the `targets` list.
    expect(classPropKeys('zCTriggerList')).toEqual([...classPropKeys('zCTrigger'), 'mode']);
    for (const key of classPropKeys('zCTrigger')) {
      expect(fieldOf('zCTriggerList', key)).toEqual(fieldOf('zCTrigger', key));
    }
    // The list itself and the target strings stay out, by the rules at the top
    // of the catalogue.
    expect(fieldOf('zCTriggerList', 'targets')).toBeNull();
    expect(fieldOf('zCTriggerList', 'target')).toBeNull();
  });

  it('catalogues the code master`s three booleans and neither its slaves nor its targets', () => {
    // The one of the four with no enum at all: what held it out was the
    // `slaves` list and the two cross-reference strings, and the three
    // booleans that steer the sequence were held out with them.
    expect(classPropKeys('zCCodeMaster'))
      .toEqual(['ordered', 'firstFalseIsFailure', 'untriggeredCancels']);
    for (const key of ['slaves', 'target', 'failureTarget']) {
      expect(fieldOf('zCCodeMaster', key)).toBeNull();
    }
  });

  it('catalogues the message filter`s two enums and not the target they relay to', () => {
    expect(classPropKeys('zCMessageFilter')).toEqual(['onTrigger', 'onUntrigger']);
    expect(fieldOf('zCMessageFilter', 'target')).toBeNull();
  });

  it('catalogues a damage volume whole — eleven scalars and the collision enum', () => {
    // `oCTouchDamage` derives straight from `zCVob` and shares nothing with the
    // movable-object family it is placed beside. Nothing on it is a list, a
    // cross-reference string or save-game-only, so the class is complete.
    expect(classPropKeys('oCTouchDamage')).toEqual([
      'damage', 'barrier', 'blunt', 'edge', 'fire', 'fly', 'magic', 'point', 'fall',
      'repeatDelaySec', 'volumeScale', 'collision',
    ]);
    // The three floors, measured over retail's 51 volumes: damage is 1000 on 49
    // and 50 on 2, the tick is 2s/0.5s/0 and the scale is 1 on every one. None
    // has a maximum — a modded volume may deal more than retail does — and none
    // may be negative: a negative scale is not a smaller box.
    expect(fieldOf('oCTouchDamage', 'damage')).toEqual({ key: 'damage', kind: 'float', min: 0 });
    expect(fieldOf('oCTouchDamage', 'repeatDelaySec'))
      .toEqual({ key: 'repeatDelaySec', kind: 'float', min: 0 });
    expect(fieldOf('oCTouchDamage', 'volumeScale'))
      .toEqual({ key: 'volumeScale', kind: 'float', min: 0 });
    expect(fieldOf('oCTouchDamage', 'blunt')).toEqual({ key: 'blunt', kind: 'bool' });
  });

  it('places the whole trigger family, under the names the archive uses', () => {
    // I3 (level-editor.md §16.15). The two `oC*` names are the trap: the board
    // card and everyday speech say `zCTriggerScript` and `zCTriggerChangeLevel`,
    // and a world — and therefore `CLASS_FIELDS`, the dump and the binding —
    // spells both with the `oC` prefix. A list that carried the spoken name
    // would offer the dialog a class the binding refuses.
    expect(AUTHORABLE_VOB_CLASSES).toEqual([
      'zCVob', 'oCItem', 'zCVobLight', 'zCVobSound', 'zCVobSoundDaytime',
      'zCTrigger', 'zCTriggerList', 'oCTriggerScript', 'oCTriggerChangeLevel',
      'zCMover', 'zCCodeMaster', 'zCMessageFilter',
      'oCMobInter', 'oCMobBed', 'oCMobLadder', 'oCMobSwitch', 'oCMobWheel',
      'oCMobDoor', 'oCMobContainer', 'oCTouchDamage',
      'oCZoneMusic', 'zCZoneZFog', 'zCZoneVobFarPlane',
      'zCVobStartpoint', 'zCVobSpot', 'zCVobAnimate', 'zCPFXController',
    ]);
    expect(isAuthorableVobClass('zCTriggerScript')).toBe(false);
    expect(isAuthorableVobClass('zCTriggerChangeLevel')).toBe(false);
  });

  it('places the movable-object family, and not the two of it that are only editable', () => {
    // I4 (level-editor.md §16.15). `oCTouchDamage` travels with them because it
    // is the other volume a designer places by hand, and it carries the same
    // name trap the trigger family had: ZenKit's own documentation says
    // `zCTouchDamage` and a world says `oC`.
    for (const className of [
      'oCMobInter', 'oCMobBed', 'oCMobLadder', 'oCMobSwitch', 'oCMobWheel',
      'oCMobDoor', 'oCMobContainer', 'oCTouchDamage',
    ]) {
      expect(isAuthorableVobClass(className)).toBe(true);
    }
    expect(isAuthorableVobClass('zCTouchDamage')).toBe(false);
    // The two the family's catalogue holds that I4 did *not* make authorable,
    // and they are editable-only on purpose rather than by oversight: neither
    // is in the card's list, and an `oCMobFire` in particular is only ever a
    // rigged model with a fire template on a bone, which nothing here can name.
    expect(isAuthorableVobClass('oCMOB')).toBe(false);
    expect(isAuthorableVobClass('oCMobFire')).toBe(false);
    expect(classPropKeys('oCMobFire').length).toBeGreaterThan(0);
    // The bed was the third authorable-with-nothing-catalogued class and is not
    // one any more: its fields are exactly `oCMobInter`'s, and it now carries
    // them here and a `case oCMobBed:` in the binding's `setVobClassProp`
    // switch. `oCTouchDamage` was the last of that state in this family and is
    // catalogued too — twelve fields, the collision enum among them.
    expect(classPropKeys('oCTouchDamage')).toHaveLength(12);
  });

  it('places the zones, the markers and the two effect classes (I5)', () => {
    // I5 (level-editor.md §16.15), the increment that closes §14.1 1.3. Five of
    // the seven were catalogued-but-unplaceable, which is the state the
    // separation test used `zCVobAnimate` to stand for until this landed — so
    // the row it closes is exactly the one that made "editable" and
    // "authorable" different words.
    for (const className of [
      'oCZoneMusic', 'zCZoneZFog', 'zCZoneVobFarPlane', 'zCVobAnimate', 'zCPFXController',
    ]) {
      expect(isAuthorableVobClass(className)).toBe(true);
      expect(classPropKeys(className).length).toBeGreaterThan(0);
    }
    // The other two are markers: `VSpot` and `VStartPoint` declare not one
    // field beyond `zCVob`, so they join `zCVob` itself in being authorable
    // with nothing to edit — and for the opposite reason to a code master's,
    // which has fields the catalogue refuses rather than no fields at all.
    for (const className of ['zCVobSpot', 'zCVobStartpoint']) {
      expect(isAuthorableVobClass(className)).toBe(true);
      expect(classPropKeys(className)).toEqual([]);
    }
    // The `…Default` zone variants stay refused. They are a world's fallback
    // settings rather than placed zones, the catalogue holds none of them, and
    // a second one placed by hand is not a thing a world has.
    for (const className of [
      'oCZoneMusicDefault', 'zCZoneZFogDefault', 'zCZoneVobFarPlaneDefault',
    ]) {
      expect(isAuthorableVobClass(className)).toBe(false);
    }
  });

  it('refuses a class name that is a property of every object', () => {
    expect(isAuthorableVobClass('toString')).toBe(false);
    expect(isAuthorableVobClass('')).toBe(false);
    expect(isAuthorableVobClass(7)).toBe(false);
  });

  it('answers null for a key of another class, and for a class it does not have', () => {
    expect(fieldOf('oCItem', 'range')).toBeNull();
    expect(fieldOf('zCVobLight', 'instance')).toBeNull();
    expect(fieldOf('zCMover', 'keyframes')).toBeNull();
    expect(classPropKeys('zCVob')).toEqual([]);
  });

  it('answers null for a class name that is a property of every object', () => {
    // The class name arrives from a world, so the lookup is a boundary: a plain
    // object literal answers `CLASS_FIELDS['toString']` with a *function*, and a
    // `?? []` behind that lookup would hand the grid a method to iterate.
    expect(fieldOf('toString', 'instance')).toBeNull();
    expect(fieldOf('constructor', 'key')).toBeNull();
    expect(classPropKeys('toString')).toEqual([]);
    expect(classPropKeys('__proto__')).toEqual([]);
  });
});

describe('the base fields no class owns', () => {
  it('bounds the two numbers by the packed layout, not by the archive type', () => {
    // `visualCamAlign` is two bits and `bias` is five in the packed `zCVob`
    // layout, and a wider value is written truncated and reported as written.
    // The alignment's max is 3 rather than the enum's 2 because retail carries
    // 3 — an inverse has to be able to write back what was there.
    expect(baseFieldOf('visualCamAlign')).toEqual({ key: 'visualCamAlign', kind: 'int', min: 0, max: 3 });
    expect(baseFieldOf('bias')).toEqual({ key: 'bias', kind: 'int', min: 0, max: 31 });
    expect(baseFieldOf('presetName')).toEqual({ key: 'presetName', kind: 'string' });
  });

  it('bounds dynamicShadows by the same two bits, not by ShadowType', () => {
    // `dynamicShadows` is `(bit0 & 0b11000000) >> 6` in the packed layout, so
    // the bound is 0-3 and not `ShadowType`'s two named values — the same rule
    // `visualCamAlign` above is bounded by, and for the same reason: an inverse
    // has to be able to write back whatever a world was holding.
    expect(baseFieldOf('dynamicShadows')).toEqual({ key: 'dynamicShadows', kind: 'int', min: 0, max: 3 });
  });

  it('leaves sleepMode out — it is a save-game field a world never carries', () => {
    // `VirtualObject::save` writes `sleepMode` only under `is_save_game()`, so a
    // value set on a world archive is dropped on write and read back as 0.
    // Measured 2026-08-28: 0 on all 41,393 retail VOBs.
    expect(baseFieldOf('sleepMode')).toBeNull();
  });

  it('is not a class entry, so an unknown class stays unknown', () => {
    // `SetVobClassProp` refuses a class the catalogue does not know by asking
    // whether it has any keys at all. Folding the base fields into `CLASS_FIELDS`
    // would answer "yes" for every string.
    expect(classPropKeys('zCVob')).toEqual([]);
    expect(fieldOf('zCVob', 'bias')).toBeNull();
    expect(baseFieldOf('name')).toBeNull();
    expect(baseFieldOf('toString')).toBeNull();
  });
});

describe('the decal fields, which live on the visual and not on the vob', () => {
  it('catalogues all seven, prefixed so the op stays a flat walk over keys', () => {
    // A decal is the one visual that carries data of its own, and `getVobProps`
    // answers it as a nested `decal` record. The catalogue keeps the flat shape
    // every other field has — the prefix is what makes the two views one key
    // set, and `decalSubKey` is the only place that mapping is written down.
    expect(DECAL_FIELDS.map((field) => field.key)).toEqual([
      'decalDimension', 'decalOffset', 'decalTwoSided', 'decalAlphaFunc',
      'decalTextureAnimFps', 'decalAlphaWeight', 'decalIgnoreDaylight',
    ]);
    for (const field of DECAL_FIELDS) {
      expect(decalFieldOf(field.key)).toEqual(field);
    }
    expect(decalFieldOf('dimension')).toBeNull();
    expect(decalFieldOf('presetName')).toBeNull();
    expect(decalFieldOf('toString')).toBeNull();
  });

  it('maps each key onto the name the props record answers it under', () => {
    expect(DECAL_FIELDS.map((field) => decalSubKey(field.key))).toEqual([
      'dimension', 'offset', 'twoSided', 'alphaFunc',
      'textureAnimFps', 'alphaWeight', 'ignoreDaylight',
    ]);
  });

  it('bounds each field by what the archive holds, measured over retail', () => {
    // Swept 2026-08-28 over NewWorld/OldWorld/AddonWorld: 1,932 of the 41,393
    // VOBs carry a decal, all of them plain `zCVob`. Dimensions run 10-550 and
    // an offset is always [0,0] — a size cannot be negative, an offset can, so
    // only the first is floored. `alphaFunc` is an `AlphaFunction`, whose seven
    // values retail stays inside (1, 2, 3 and one 6); `alphaWeight` is the byte
    // `write_byte` puts in the archive, so 0-255 and whole.
    expect(decalFieldOf('decalDimension')).toEqual({ key: 'decalDimension', kind: 'vec2', min: 0 });
    expect(decalFieldOf('decalOffset')).toEqual({ key: 'decalOffset', kind: 'vec2' });
    expect(decalFieldOf('decalTwoSided')).toEqual({ key: 'decalTwoSided', kind: 'bool' });
    expect(decalFieldOf('decalAlphaFunc')).toEqual({ key: 'decalAlphaFunc', kind: 'int', min: 0, max: 6 });
    expect(decalFieldOf('decalTextureAnimFps')).toEqual({ key: 'decalTextureAnimFps', kind: 'float', min: 0 });
    expect(decalFieldOf('decalAlphaWeight')).toEqual({ key: 'decalAlphaWeight', kind: 'int', min: 0, max: 255 });
    expect(decalFieldOf('decalIgnoreDaylight')).toEqual({ key: 'decalIgnoreDaylight', kind: 'bool' });
  });

  it('is not a base field and not a class field', () => {
    // Three separate lookups over three separate tables, because a decal field
    // is legal only on a VOB whose visual is one — the check `baseFieldOf`
    // cannot make and `classPropKeys` must go on answering empty for `zCVob`.
    expect(baseFieldOf('decalDimension')).toBeNull();
    expect(fieldOf('zCVob', 'decalDimension')).toBeNull();
    expect(classPropKeys('zCVob')).toEqual([]);
  });
});

describe('the enum sets (level-editor.md §16.21)', () => {
  it('names an enum on every class that has one, and no field twice', () => {
    // The set is per class and per key, so the two failures that reach a reader
    // are a class the grid never draws, whose set nothing can read, and a key
    // whose set and whose descriptor disagree about which of the two it is.
    expect(Object.keys(CLASS_ENUM_FIELDS).sort()).toEqual([
      'oCMOB', 'oCMobBed', 'oCMobContainer', 'oCMobDoor', 'oCMobFire', 'oCMobInter',
      'oCMobLadder', 'oCMobSwitch', 'oCMobWheel', 'oCTouchDamage', 'zCMessageFilter',
      'zCMover', 'zCTriggerList', 'zCVobLight', 'zCVobSound', 'zCVobSoundDaytime',
    ]);
    for (const [className, fields] of Object.entries(CLASS_ENUM_FIELDS)) {
      expect(Object.keys(CLASS_FIELDS)).toContain(className);
      for (const key of Object.keys(fields)) {
        expect(classPropKeys(className)).toContain(key);
        expect(fieldOf(className, key)?.kind).toBe('enum');
      }
    }
  });

  it('gives every `enum` field a set, and every set a field', () => {
    // The two tables are read by different layers — the grid asks the fourth
    // for its options and the IPC validator asks the third for the kind — so a
    // key in one and not the other is a dropdown with nothing to offer, or a
    // number field on an archive member that is an enumeration.
    for (const className of Object.keys(CLASS_FIELDS)) {
      for (const key of classPropKeys(className)) {
        const isEnum = fieldOf(className, key)?.kind === 'enum';
        expect([key, isEnum]).toEqual([key, enumValuesOf(className, key) !== null]);
      }
    }
  });

  it('bounds no enum field, because a value outside the set is kept', () => {
    // The whole of §16.21: offering is not coercing. A value retail holds and
    // the set does not is shown as itself and written back unchanged on an
    // undo, so a `min`/`max` here would be the coercion the card refuses —
    // reached by the validator instead of by the dropdown.
    for (const className of Object.keys(CLASS_FIELDS)) {
      for (const key of classPropKeys(className)) {
        const field = fieldOf(className, key)!;
        if (field.kind !== 'enum') continue;
        expect([key, field.min, field.max]).toEqual([key, undefined, undefined]);
      }
    }
  });

  it('reads each set out of ZenKit`s header, whole and in stored order', () => {
    // The values are the enumerators of the C++ enum the archive member has,
    // in declaration order, labelled with the enumerator`s own name — a set
    // read rather than invented, which is the property the card exists for.
    expect(enumValuesOf('zCVobLight', 'lightType')).toEqual([
      { value: 0, label: 'POINT' }, { value: 1, label: 'SPOT' },
      { value: 2, label: 'RESERVED0' }, { value: 3, label: 'RESERVED1' },
    ]);
    expect(enumValuesOf('zCVobLight', 'quality')).toEqual([
      { value: 0, label: 'HIGH' }, { value: 1, label: 'MEDIUM' }, { value: 2, label: 'LOW' },
    ]);
    expect(enumValuesOf('zCVobSound', 'mode')).toEqual([
      { value: 0, label: 'LOOP' }, { value: 1, label: 'ONCE' }, { value: 2, label: 'RANDOM' },
    ]);
    expect(enumValuesOf('zCVobSound', 'volumeType')).toEqual([
      { value: 0, label: 'SPHERICAL' }, { value: 1, label: 'ELLIPSOIDAL' },
    ]);
    expect(enumValuesOf('zCMover', 'behavior')).toEqual([
      { value: 0, label: 'TOGGLE' }, { value: 1, label: 'TRIGGER_CONTROL' },
      { value: 2, label: 'OPEN_TIME' }, { value: 3, label: 'LOOP' },
      { value: 4, label: 'SINGLE_KEYS' },
    ]);
    expect(enumValuesOf('zCTriggerList', 'mode')).toEqual([
      { value: 0, label: 'ALL' }, { value: 1, label: 'NEXT' }, { value: 2, label: 'RANDOM' },
    ]);
    expect(enumValuesOf('oCTouchDamage', 'collision')).toEqual([
      { value: 0, label: 'NONE' }, { value: 1, label: 'BOX' }, { value: 2, label: 'POINT' },
    ]);
    for (const key of ['onTrigger', 'onUntrigger']) {
      expect(enumValuesOf('zCMessageFilter', key)).toEqual([
        { value: 0, label: 'NONE' }, { value: 1, label: 'TRIGGER' },
        { value: 2, label: 'UNTRIGGER' }, { value: 3, label: 'ENABLE' },
        { value: 4, label: 'DISABLE' }, { value: 5, label: 'TOGGLE' },
      ]);
    }
    expect(enumValuesOf('oCMobDoor', 'soundMaterial')).toEqual([
      { value: 0, label: 'WOOD' }, { value: 1, label: 'STONE' }, { value: 2, label: 'METAL' },
      { value: 3, label: 'LEATHER' }, { value: 4, label: 'CLAY' }, { value: 5, label: 'GLASS' },
    ]);
  });

  it('gives the daytime sound the base sound`s two enums, as the fields do', () => {
    expect(enumValuesOf('zCVobSoundDaytime', 'mode')).toEqual(enumValuesOf('zCVobSound', 'mode'));
    expect(enumValuesOf('zCVobSoundDaytime', 'volumeType'))
      .toEqual(enumValuesOf('zCVobSound', 'volumeType'));
  });

  it('gives every movable-object class the same one enum', () => {
    // `soundMaterial` is `VMovableObject`s, so every `oCMob*` inherits it — the
    // same shape `OC_MOB_FIELDS` has, and an editor that offered it on the door
    // and not the chest would be describing the hierarchy wrongly.
    for (const className of ['oCMOB', 'oCMobInter', 'oCMobBed', 'oCMobLadder',
      'oCMobSwitch', 'oCMobWheel', 'oCMobFire', 'oCMobContainer', 'oCMobDoor']) {
      expect(enumValuesOf(className, 'soundMaterial')).toEqual(enumValuesOf('oCMOB', 'soundMaterial'));
    }
  });

  it('holds out the two mover enums a save would drop', () => {
    // `VMover::save` writes `posLerpType` and `speedType` only when the mover
    // has keyframes, which this catalogue cannot author — so on a mover that
    // animates from its visual, a write of either is dropped on save and reads
    // to a user as the editor having done nothing. The same reason `speed` is
    // not a field, and `lerpMode` is also the field the retail sweep found
    // outside its own set (120 three times, 132198264 once).
    expect(enumValuesOf('zCMover', 'lerpMode')).toBeNull();
    expect(enumValuesOf('zCMover', 'speedMode')).toBeNull();
  });

  it('answers null for a key that is not an enum, and for a prototype member', () => {
    expect(enumValuesOf('zCVobLight', 'range')).toBeNull();
    expect(enumValuesOf('oCItem', 'instance')).toBeNull();
    expect(enumValuesOf('zCVob', 'mode')).toBeNull();
    expect(enumValuesOf('toString', 'mode')).toBeNull();
    expect(enumValuesOf('zCVobSound', 'toString')).toBeNull();
  });

  it('gives each set unique values and unique labels', () => {
    // A repeated value makes two options write the same number; a repeated
    // label makes them indistinguishable in the list.
    const table: Readonly<Record<string, Readonly<Record<string, readonly EnumValueDescriptor[]>>>>
      = CLASS_ENUM_FIELDS;
    for (const fields of Object.values(table)) {
      for (const values of Object.values(fields)) {
        expect(new Set(values.map((v) => v.value)).size).toBe(values.length);
        expect(new Set(values.map((v) => v.label)).size).toBe(values.length);
        expect(values.every((v) => Number.isInteger(v.value) && v.value >= 0)).toBe(true);
      }
    }
  });
});
