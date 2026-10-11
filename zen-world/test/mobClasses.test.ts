// Which class a placed visual should be (#290), and whether an asset is a VOB
// or a MOB (#288). ZenGin reads a MOB's interaction scheme off its visual's
// name — the part before the first underscore — so the name decides both.

import { assetRole, carriesVisual, isModelVisual, mobClassOf, schemeOf } from '../src/model';

describe('schemeOf', () => {
  it('is the bare name up to the first underscore, upper-cased', () => {
    expect(schemeOf('BENCH_1_OC.ASC')).toBe('BENCH');
    expect(schemeOf('Anims/_compiled/chestbig_occhestlarge.msb')).toBe('CHESTBIG');
    expect(schemeOf('LADDER.MDS')).toBe('LADDER');
  });
});

describe('mobClassOf', () => {
  it('names the class retail places each kind of interactive model as', () => {
    expect(mobClassOf('CHESTBIG_OCCHESTLARGE.MDS')).toEqual({ scheme: 'CHESTBIG', class: 'oCMobContainer', focusName: 'MOBNAME_CHEST' });
    expect(mobClassOf('CHESTSMALL_OCCHESTSMALL.MDS')?.class).toBe('oCMobContainer');
    expect(mobClassOf('DOOR_WOODEN.MDS')).toEqual({ scheme: 'DOOR', class: 'oCMobDoor', focusName: 'MOBNAME_DOOR' });
    expect(mobClassOf('LADDER_5.ASC')?.class).toBe('oCMobLadder');
    expect(mobClassOf('LEVER_1_OC.MDS')?.class).toBe('oCMobSwitch');
    expect(mobClassOf('VWHEEL_1_OC.MDS')?.class).toBe('oCMobWheel');
  });

  it('makes seats, beds and workbenches oCMobInter, with no focus name to guess', () => {
    // Beds included: retail has 7 oCMobBed against the oCMobInter beds, so the
    // majority is what an author gets.
    for (const visual of ['BENCH_1_OC.ASC', 'CHAIR_1_OC.ASC', 'THRONE_BIG.ASC', 'BEDHIGH_PC.ASC',
      'CAULDRON_OC.ASC', 'BSANVIL_OC.MDS', 'LAB_PSI.ASC', 'BAUMSAEGE_1.ASC']) {
      expect([visual, mobClassOf(visual)]).toEqual([visual, { scheme: schemeOf(visual), class: 'oCMobInter' }]);
    }
  });

  it('reads a compiled name the same as its source', () => {
    expect(mobClassOf('BENCH_1_OC.MDL')?.class).toBe('oCMobInter');
    expect(mobClassOf('CHESTBIG_OCCHESTLARGE.MSB')?.class).toBe('oCMobContainer');
  });

  it('is nothing for a static mesh, whatever it is called — a rock stays a zCVob', () => {
    // A static mesh has no animations for a scheme to play, so a `BENCH` mesh
    // is a bench-shaped rock.
    for (const visual of ['BENCH_ROCK.3DS', 'NW_NATURE_STONE_01.3DS', 'DOOR_FRAME.MRM', 'NW_NATURE_BUSH_01.3DS']) {
      expect([visual, mobClassOf(visual)]).toEqual([visual, null]);
    }
  });

  it('is nothing for a model with no scheme it knows', () => {
    expect(mobClassOf('SHEEP.MDS')).toBeNull();
    expect(mobClassOf('FIREPLACE_GROUND.ASC')).toBeNull();
  });
});

describe('assetRole', () => {
  it('is mob for an interactive model, vob for any other placeable visual, null for the rest', () => {
    expect(assetRole('CHESTBIG_OCCHESTLARGE.MDS')).toBe('mob');
    expect(assetRole('NW_CRATE.MRM')).toBe('vob');
    expect(assetRole('SHEEP.MDL')).toBe('vob');
    expect(assetRole('NW_WOOD-C.TEX')).toBeNull();
    expect(assetRole('README.TXT')).toBeNull();
  });
});

describe('carriesVisual', () => {
  it('is a zCVob or one of the MOB classes — what a placement can hand a visual to', () => {
    for (const cls of ['zCVob', 'oCMobInter', 'oCMobBed', 'oCMobContainer', 'oCMobDoor', 'oCMobLadder', 'oCMobSwitch', 'oCMobWheel']) {
      expect([cls, carriesVisual(cls)]).toEqual([cls, true]);
    }
    for (const cls of ['oCItem', 'zCVobLight', 'zCTrigger']) expect([cls, carriesVisual(cls)]).toEqual([cls, false]);
  });
});

describe('isModelVisual', () => {
  it('is an animated model, source or compiled — what a scheme can be played on', () => {
    for (const name of ['BENCH_1_OC.ASC', 'SHEEP.MDS', 'SHEEP.MDL', 'X.MDM', 'X.MSB']) expect([name, isModelVisual(name)]).toEqual([name, true]);
    for (const name of ['NW_NATURE_STONE_01.3DS', 'NW_CRATE.MRM', 'X.MSH', 'X.MMB', '']) expect([name, isModelVisual(name)]).toEqual([name, false]);
  });
});
