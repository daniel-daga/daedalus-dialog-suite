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

  it('catalogues the two classes this increment writes, and only those', () => {
    // The table is additive per class, so what is *not* in it is the statement:
    // a class with no entry has no class section in the grid and no legal key at
    // any layer below it.
    expect(Object.keys(CLASS_FIELDS).sort()).toEqual(['oCItem', 'zCVobLight']);
    expect(classPropKeys('oCItem')).toEqual(['instance']);
    expect(classPropKeys('zCVobLight')).toEqual(['range', 'color']);
  });

  it('records the bounds a value is refused by, per kind', () => {
    // The bounds live here rather than in the validator because the grid needs
    // the same numbers to reject before it commits, and two hand-written copies
    // of "0 to 255" is one copy too many.
    expect(fieldOf('oCItem', 'instance')).toEqual({ key: 'instance', kind: 'string' });
    expect(fieldOf('zCVobLight', 'range')).toEqual({ key: 'range', kind: 'float', min: 0 });
    expect(fieldOf('zCVobLight', 'color'))
      .toEqual({ key: 'color', kind: 'color', min: 0, max: 255 });
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
