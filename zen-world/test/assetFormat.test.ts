// The asset browser's format facet (#289): Florian thinks in source formats —
// ".3DS, TGA, ASC" — and the mounted namespace lists what the compiler made of
// them. A group is the kind of asset, so either spelling of one lands in it.

import { ASSET_FORMATS, assetFormat } from '../src/assets';

describe('assetFormat', () => {
  it('puts a source and its compiled forms in one group', () => {
    const cases: Array<[string, string]> = [
      ['NW_CRATE.3DS', 'mesh'], ['NW_CRATE.MRM', 'mesh'], ['NW_PART.MSH', 'mesh'],
      ['HUM_BODY.ASC', 'model'], ['HUMANS.MDS', 'model'], ['CHEST.MDL', 'model'],
      ['HUM_BODY.MDM', 'model'], ['HUMANS.MDH', 'model'], ['HUMANS.MSB', 'model'],
      ['FIRE.MMS', 'morph'], ['FIRE.MMB', 'morph'],
      ['NW_WOOD.TGA', 'texture'], ['NW_WOOD-C.TEX', 'texture'],
      ['HUMANS-T_WALK.MAN', 'animation'],
      ['README.TXT', 'other'], ['NOEXTENSION', 'other'],
    ];
    for (const [name, format] of cases) expect([name, assetFormat(name)]).toEqual([name, format]);
  });

  it('reads a path by its file name, in any case', () => {
    expect(assetFormat('Meshes/_compiled/nw_crate.mrm')).toBe('mesh');
    expect(assetFormat('mod/Textures/new_wall.tga')).toBe('texture');
  });

  it('labels every group with the spellings it covers, source first', () => {
    expect(ASSET_FORMATS.map((format) => format.id)).toEqual(['mesh', 'model', 'morph', 'texture', 'animation', 'other']);
    expect(ASSET_FORMATS.find((format) => format.id === 'mesh')?.label).toBe('Meshes (3DS → MRM, MSH)');
    expect(ASSET_FORMATS.find((format) => format.id === 'texture')?.label).toBe('Textures (TGA → TEX)');
  });
});
