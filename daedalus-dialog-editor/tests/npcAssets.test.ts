import { npcAssetSuggestions } from '../src/renderer/npc/npcAssets';

const file = (name: string) => ({ name, type: 'file' as const });
const directory = (name: string) => ({ name, type: 'directory' as const });

describe('NPC VFS asset suggestions', () => {
  it('offers unique head meshes without the compiled mesh extension and walk overlays with their extension', () => {
    expect(npcAssetSuggestions(
      [file('hum_head_fatbald.MMB'), file('HUM_HEAD_FATBALD.mmb'), file('HUM_HEAD_BABE.MMB'), file('OTHER_HEAD.MMB'), directory('HUM_HEAD_FOLDER.MMB')],
      [file('HUMANS_S1.MDS'), file('humans_mage.mds'), file('ANIMATED_HUMAN.MDS'), directory('HUMANS_FOLDER.MDS')],
    )).toEqual({
      headMeshes: ['HUM_HEAD_BABE', 'hum_head_fatbald'],
      walkOverlays: ['humans_mage.mds', 'HUMANS_S1.MDS'],
    });
  });
});
