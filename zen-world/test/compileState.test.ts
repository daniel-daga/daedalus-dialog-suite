// Whether a mod's source asset has been compiled (#294). ZenKit reads only the
// compiled formats, so a `.3DS` a GMBT build has not turned into a `.MRM` yet is
// listed by the browser and then resolves to nothing — which read as "the tool
// is missing my assets" rather than as "this one is not compiled".

import { compileState, isSourceAsset } from '../src/assets';

describe('isSourceAsset', () => {
  it('is a mesh, model, morph or texture source ZenGin compiles before it reads it', () => {
    for (const name of ['KM_VOB_BIG_BUSH_01.3DS', 'HUM_BODY.ASC', 'FIRE.MMS', 'NW_WOOD.TGA', 'nw_wood.tga']) {
      expect([name, isSourceAsset(name)]).toEqual([name, true]);
    }
  });

  it('is not a compiled file, a script, or anything else', () => {
    for (const name of ['NW_CRATE.MRM', 'NW_WOOD-C.TEX', 'HUMANS.MDS', 'FIRE.MMB', 'README.TXT', 'MESHES']) {
      expect([name, isSourceAsset(name)]).toEqual([name, false]);
    }
  });
});

describe('compileState', () => {
  it('is compiled when the name resolves to a compiled file', () => {
    expect(compileState('NW_CRATE.3DS', 'NW_CRATE.MRM')).toBe('compiled');
    expect(compileState('NW_CRATE.3DS', 'NW_CRATE.MSH')).toBe('compiled');
    expect(compileState('HUM_BODY.ASC', 'HUM_BODY.MDL')).toBe('compiled');
    expect(compileState('FIRE.MMS', 'FIRE.MMB')).toBe('compiled');
    expect(compileState('NW_WOOD.TGA', 'NW_WOOD-C.TEX')).toBe('compiled');
  });

  it('is uncompiled when it resolves to nothing', () => {
    expect(compileState('KM_VOB_BIG_BUSH_01.3DS', null)).toBe('uncompiled');
  });

  it('is uncompiled when it resolves only to the source file itself', () => {
    // `vfsResolve` falls back to the name as given, so a mounted raw `.3DS`
    // "resolves" — to a file ZenKit cannot read.
    expect(compileState('KM_VOB_BIG_BUSH_01.3DS', 'KM_VOB_BIG_BUSH_01.3DS')).toBe('uncompiled');
    expect(compileState('NW_WOOD.TGA', 'NW_WOOD.TGA')).toBe('uncompiled');
  });

  it('reads a path by its file name, in any case', () => {
    expect(compileState('mod/Meshes/Archolos_stuff/km_vob_big_bush_01.3ds', null)).toBe('uncompiled');
    expect(compileState('mod/Meshes/nw_crate.3ds', 'NW_CRATE.MRM')).toBe('compiled');
  });

  it('has nothing to say about a name that is not a source', () => {
    expect(compileState('NW_CRATE.MRM', 'NW_CRATE.MRM')).toBeNull();
    expect(compileState('README.TXT', null)).toBeNull();
  });
});
