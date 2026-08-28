// Which `oCMob*` classes the engine's crosshair cannot find without a
// `focusName`, and which ones retail leaves empty on purpose.
//
// The editor could place a chest nobody can ever open and say nothing about it
// (level-editor.md §16.15), and the fix cannot be a default: retail sets the
// field per class, and two of the classes that carry it legitimately leave it
// blank because NPC routines use them rather than the player's hand. So this
// is a table of *expectations*, measured, and the grid warns against it.

import { focusNameExpectation } from '../src/model';

describe('focusNameExpectation', () => {
  it('expects one on the classes the player uses by hand', () => {
    // Measured over retail NewWorld and OldWorld, 2026-08-29.
    expect(focusNameExpectation('oCMobContainer')).toEqual({ share: 1.0, example: 'MOBNAME_CHEST' });
    expect(focusNameExpectation('oCMobDoor')?.example).toBe('MOBNAME_DOOR');
    expect(focusNameExpectation('oCMobInter')?.share).toBeGreaterThan(0.9);
    expect(focusNameExpectation('oCMobSwitch')).not.toBeNull();
  });

  it('expects none on the classes NPC routines use', () => {
    // 121 fires and 7 beds carry no focus name in retail. Warning about these
    // would be noise on every one an author places, which is how a warning
    // stops being read.
    expect(focusNameExpectation('oCMobFire')).toBeNull();
    expect(focusNameExpectation('oCMobBed')).toBeNull();
  });

  it('expects none where retail has too few to have a rule', () => {
    // One wheel and no ladder across both worlds. A single instance is not a
    // majority, and guessing from it is what the measurement exists to avoid.
    expect(focusNameExpectation('oCMobWheel')).toBeNull();
    expect(focusNameExpectation('oCMobLadder')).toBeNull();
  });

  it('says nothing about classes that have no focus name at all', () => {
    expect(focusNameExpectation('zCVob')).toBeNull();
    expect(focusNameExpectation('zCVobLight')).toBeNull();
  });

  it('names an example the class actually uses, not the commonest string', () => {
    // 178 of retail's 224 doors say `MOBNAME_BED` — a copy-paste quirk, not a
    // convention to teach. The example has to be the one that describes the
    // class, or the guidance propagates the mistake.
    expect(focusNameExpectation('oCMobDoor')?.example).not.toBe('MOBNAME_BED');
  });

  it('only ever expects a name from a class that has the field', () => {
    // A class outside the `oCMob*` family cannot hold one, so an expectation
    // for it would draw a warning under a field the grid does not render.
    for (const className of ['oCMobContainer', 'oCMobDoor', 'oCMobInter', 'oCMobSwitch']) {
      expect(focusNameExpectation(className)).not.toBeNull();
    }
  });
});
