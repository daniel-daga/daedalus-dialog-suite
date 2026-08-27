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

import { CLASS_FIELDS, classPropKeys, fieldOf } from '../src/model';

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
      'oCItem', 'oCZoneMusic', 'zCVobLight', 'zCVobSound', 'zCVobSoundDaytime',
      'zCZoneVobFarPlane', 'zCZoneZFog',
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
    expect(fieldOf('zCVobSound', 'volume'))
      .toEqual({ key: 'volume', kind: 'float', min: 0, max: 100 });
    expect(fieldOf('zCVobSoundDaytime', 'startTime'))
      .toEqual({ key: 'startTime', kind: 'float', min: 0, max: 24 });
    // Two fields with no bound at all, and each is a decision: `reverb` is
    // negative decibels in ZenGin, and `innerRangePercentage` is stored as 0..1
    // or as 0..100 depending on nothing anybody has measured — so an upper bound
    // invented here would refuse a value a retail world already contains.
    expect(fieldOf('oCZoneMusic', 'reverb')).toEqual({ key: 'reverb', kind: 'float' });
    expect(fieldOf('zCZoneZFog', 'innerRangePercentage'))
      .toEqual({ key: 'innerRangePercentage', kind: 'float', min: 0 });
    // A boolean carries no bounds at all — there is nothing between false and
    // true to refuse — and the descriptor says so by omitting both.
    expect(fieldOf('zCVobSound', 'obstruction'))
      .toEqual({ key: 'obstruction', kind: 'bool' });
    expect(fieldOf('zCZoneZFog', 'overrideColor'))
      .toEqual({ key: 'overrideColor', kind: 'bool' });
    // The only `int` so far, and it is bounded below rather than not at all:
    // ZenKit documents `0` as the lowest possible priority.
    expect(fieldOf('oCZoneMusic', 'priority'))
      .toEqual({ key: 'priority', kind: 'int', min: 0 });
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
