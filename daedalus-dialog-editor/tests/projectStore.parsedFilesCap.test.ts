/**
 * P0 perf: parsedFiles must not grow without bound.
 *
 * The cache is capped at PARSED_FILES_CAP entries. Merged-model contributors
 * are pinned and never evicted: global (dialog-less) files listed in
 * allDialogFiles, the selected NPC's dialog files, and quest files. Eviction
 * order among the rest is least-recently-written/read first.
 */

import { useProjectStore, PARSED_FILES_CAP } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

const emptyModel = (): SemanticModel => ({
  dialogs: {},
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  items: {},
  npcs: {},
  animations: {},
  hasErrors: false,
  errors: []
});

const modelWithDialog = (dialogName: string, npc: string): SemanticModel => ({
  ...emptyModel(),
  dialogs: { [dialogName]: { name: dialogName, properties: { npc } } as any }
});

describe('parsedFiles cap', () => {
  beforeEach(() => {
    useProjectStore.getState().closeProject();
  });

  const fillPast = (count: number, prefix = '/proj/filler'): string[] => {
    const paths: string[] = [];
    for (let i = 0; i < count; i++) {
      const filePath = `${prefix}${i}.d`;
      paths.push(filePath);
      useProjectStore.getState().updateFileModel(filePath, emptyModel());
    }
    return paths;
  };

  it('never holds more than PARSED_FILES_CAP entries', () => {
    fillPast(PARSED_FILES_CAP + 20);
    expect(useProjectStore.getState().parsedFiles.size).toBe(PARSED_FILES_CAP);
  });

  it('evicts the least-recently-touched unpinned entries first', () => {
    const paths = fillPast(PARSED_FILES_CAP);
    // Re-touch the very first entry, then overflow by one.
    useProjectStore.getState().updateFileModel(paths[0], emptyModel());
    useProjectStore.getState().updateFileModel('/proj/overflow.d', emptyModel());

    const { parsedFiles } = useProjectStore.getState();
    expect(parsedFiles.size).toBe(PARSED_FILES_CAP);
    expect(parsedFiles.has(paths[0])).toBe(true); // recently touched — kept
    expect(parsedFiles.has(paths[1])).toBe(false); // oldest untouched — evicted
    expect(parsedFiles.has('/proj/overflow.d')).toBe(true);
  });

  it('a getSemanticModel cache hit refreshes recency', async () => {
    const paths = fillPast(PARSED_FILES_CAP);

    await useProjectStore.getState().getSemanticModel(paths[0]);
    useProjectStore.getState().updateFileModel('/proj/overflow.d', emptyModel());

    const { parsedFiles } = useProjectStore.getState();
    expect(parsedFiles.has(paths[0])).toBe(true); // read-touched — kept
    expect(parsedFiles.has(paths[1])).toBe(false);
  });

  it('pins merged-model contributors: globals, selected NPC files, quest files', () => {
    const globalFile = '/proj/Story_Globals.d';
    const npcFile = '/proj/DIA_Farim.d';
    const questFile = '/proj/Log_Entries.d';
    const otherNpcFile = '/proj/DIA_Other.d';

    useProjectStore.setState({
      allDialogFiles: [globalFile, npcFile, questFile, otherNpcFile],
      questFiles: [questFile],
      selectedNpc: 'SLD_Farim',
      dialogIndex: new Map([
        ['SLD_Farim', [{ dialogName: 'DIA_Farim_Hallo', npc: 'SLD_Farim', filePath: npcFile }]],
        // The quest file also carries a dialog for an unselected NPC, so only
        // quest pinning (not the global rule) can keep it alive.
        ['Other_NPC', [
          { dialogName: 'DIA_Quest', npc: 'Other_NPC', filePath: questFile },
          { dialogName: 'DIA_Other', npc: 'Other_NPC', filePath: otherNpcFile }
        ]]
      ])
    });

    // Insert the contributors first so they'd be the oldest entries…
    useProjectStore.getState().updateFileModel(globalFile, emptyModel());
    useProjectStore.getState().updateFileModel(npcFile, modelWithDialog('DIA_Farim_Hallo', 'SLD_Farim'));
    useProjectStore.getState().updateFileModel(questFile, modelWithDialog('DIA_Quest', 'Other_NPC'));
    useProjectStore.getState().updateFileModel(otherNpcFile, modelWithDialog('DIA_Other', 'Other_NPC'));
    // …then overflow the cache with unpinned entries.
    fillPast(PARSED_FILES_CAP + 10);

    const { parsedFiles } = useProjectStore.getState();
    expect(parsedFiles.size).toBe(PARSED_FILES_CAP);
    expect(parsedFiles.has(globalFile)).toBe(true);
    expect(parsedFiles.has(npcFile)).toBe(true);
    expect(parsedFiles.has(questFile)).toBe(true);
    // An unselected NPC's dialog file is not a contributor — evicted.
    expect(parsedFiles.has(otherNpcFile)).toBe(false);
  });
});
