// What the asset browser lists by default (#399): the source files a modder
// works in, with everything else behind the browser's "compiled" and "all
// files" settings. A retail install mounts only compiled files, so the default
// listing is empty there — accepted, because normal work is in sources.
import { isCompiledAsset, isSourceAssetFile } from '../src/assets';

describe('isSourceAssetFile', () => {
  it('is a mesh, model, morph or texture source', () => {
    for (const name of ['NW_CRATE.3DS', 'BENCH_1_OC.ASC', 'CHESTBIG_OCCHESTLARGE.MDS', 'FIRE.MMS', 'NW_WOOD.TGA', 'nw_wood.tga']) {
      expect([name, isSourceAssetFile(name)]).toEqual([name, true]);
    }
  });

  it('is not a compiled file, a script, a sound or anything else', () => {
    for (const name of ['NW_CRATE.MRM', 'NW_WOOD-C.TEX', 'HUM_BODY.MDL', 'STEFAN.MAN', 'README.TXT', 'Meshes']) {
      expect([name, isSourceAssetFile(name)]).toEqual([name, false]);
    }
  });
});

describe('isCompiledAsset', () => {
  it('is what the asset compiler makes of a source', () => {
    for (const name of ['NW_CRATE.MRM', 'NW_CRATE.MSH', 'HUM_BODY.MDL', 'HUM_BODY.MDM', 'HUM_BODY.MDH', 'CHESTBIG.MSB', 'FIRE.MMB', 'NW_WOOD-C.TEX']) {
      expect([name, isCompiledAsset(name)]).toEqual([name, true]);
    }
  });

  it('is not a source, a script or anything else', () => {
    for (const name of ['NW_CRATE.3DS', 'NW_WOOD.TGA', 'STEFAN.MAN', 'README.TXT']) {
      expect([name, isCompiledAsset(name)]).toEqual([name, false]);
    }
  });
});
