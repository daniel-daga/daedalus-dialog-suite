/**
 * Create NPC (#285): a new NPC is in the list and editable at once, without
 * the reindex that would otherwise be the only way the project learns of it.
 */
import { useProjectStore } from '../src/renderer/store/projectStore';

describe('projectStore.addNpcToIndex', () => {
  beforeEach(() => {
    useProjectStore.setState({
      npcList: ['VLK_1_A'],
      npcFileIndex: { VLK_1_A: 'C:/mod/NPC/VLK_1_A.d' },
      allDialogFiles: ['C:/mod/NPC/VLK_1_A.d']
    });
  });

  test('lists the NPC sorted, maps it to its file uppercased, and knows the file', () => {
    useProjectStore.getState().addNpcToIndex('BAU_950_Harald', 'C:/mod/NPC/BAU_950_Harald.d');
    const state = useProjectStore.getState();
    expect(state.npcList).toEqual(['BAU_950_Harald', 'VLK_1_A']);
    expect(state.npcFileIndex.BAU_950_HARALD).toBe('C:/mod/NPC/BAU_950_Harald.d');
    expect(state.allDialogFiles).toContain('C:/mod/NPC/BAU_950_Harald.d');
  });

  test('adding it twice lists it once', () => {
    const { addNpcToIndex } = useProjectStore.getState();
    addNpcToIndex('BAU_950_Harald', 'C:/mod/NPC/BAU_950_Harald.d');
    addNpcToIndex('BAU_950_Harald', 'C:/mod/NPC/BAU_950_Harald.d');
    expect(useProjectStore.getState().npcList.filter((n) => n === 'BAU_950_Harald')).toHaveLength(1);
  });
});
