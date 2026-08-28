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
  AUTHORABLE_VOB_CLASSES, CLASS_FIELDS, classPropKeys, fieldOf, isAuthorableVobClass,
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
      'oCItem', 'oCMOB', 'oCMobContainer', 'oCMobDoor', 'oCMobFire', 'oCMobInter',
      'oCMobLadder', 'oCMobSwitch', 'oCMobWheel', 'oCTriggerChangeLevel', 'oCTriggerScript',
      'oCZoneMusic', 'zCMover', 'zCPFXController', 'zCTrigger', 'zCTriggerWorldStart',
      'zCVobAnimate', 'zCVobLight', 'zCVobSound', 'zCVobSoundDaytime', 'zCZoneVobFarPlane',
      'zCZoneZFog',
    ]);
    expect(classPropKeys('oCItem')).toEqual(['instance']);
    expect(classPropKeys('zCVobLight')).toEqual(['range', 'color']);
    expect(classPropKeys('zCVobSound')).toEqual([
      'soundName', 'volume', 'radius', 'coneAngle',
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
    // `zCMover` inherits the base twelve and adds thirteen of its own
    // fourteen, in the order `VMover` declares them.
    expect(classPropKeys('zCMover')).toEqual([
      ...classPropKeys('zCTrigger'), 'touchBlockerDamage', 'stayOpenTimeSec', 'locked',
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
    // `oCMOB` — the base every `oCMob*` class inherits, and its own nine
    // plain scalars (`soundMaterial` is an enum and stays out).
    expect(classPropKeys('oCMOB')).toEqual([
      'focusName', 'hp', 'damage', 'movable', 'takable', 'focusOverride',
      'visualDestroyed', 'owner', 'ownerGuild', 'destroyed',
    ]);
    expect(fieldOf('oCMOB', 'hp')).toEqual({ key: 'hp', kind: 'int' });
    expect(fieldOf('oCMOB', 'movable')).toEqual({ key: 'movable', kind: 'bool' });
    expect(fieldOf('oCMOB', 'owner')).toEqual({ key: 'owner', kind: 'string' });
    expect(fieldOf('oCMOB', 'soundMaterial')).toBeNull();
    // `oCMobInter` — the base nine plus its own four; `target` (a cross-
    // reference, held out with the rest of the family's target strings) and
    // `item` (a script item-instance name, a decision point of its own) stay
    // out. `oCMobLadder`/`Switch`/`Wheel` add nothing beyond `oCMobInter`, so
    // they share the same key set.
    const OC_MOB_INTER_KEYS = [
      'focusName', 'hp', 'damage', 'movable', 'takable', 'focusOverride',
      'visualDestroyed', 'owner', 'ownerGuild', 'destroyed',
      'stateCount', 'conditionFunction', 'onStateChangeFunction', 'rewind',
    ];
    for (const className of ['oCMobInter', 'oCMobLadder', 'oCMobSwitch', 'oCMobWheel']) {
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
    // `oCMobContainer` — the base nine plus `locked` and `pickString`. `key`
    // (the item instance that unlocks it) stays out with `item`, the same
    // cross-reference decision; `contents` stays out too — it is a single
    // string in the archive but encodes a list of item instances and counts,
    // the same "names script symbols this catalogue cannot validate" shape.
    expect(classPropKeys('oCMobContainer'))
      .toEqual([...OC_MOB_INTER_KEYS, 'locked', 'pickString']);
    expect(fieldOf('oCMobContainer', 'locked')).toEqual({ key: 'locked', kind: 'bool' });
    expect(fieldOf('oCMobContainer', 'pickString')).toEqual({ key: 'pickString', kind: 'string' });
    expect(fieldOf('oCMobContainer', 'key')).toBeNull();
    expect(fieldOf('oCMobContainer', 'contents')).toBeNull();
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
    expect(isAuthorableVobClass('zCMover')).toBe(false);
    expect(classPropKeys('zCMover').length).toBeGreaterThan(0);
    // Every class that *is* authorable and carries fields is catalogued, or the
    // dialog would place a VOB whose own fields the grid cannot then reach.
    for (const className of AUTHORABLE_VOB_CLASSES) {
      if (className === 'zCVob') continue;
      expect(classPropKeys(className).length).toBeGreaterThan(0);
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
