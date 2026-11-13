/**
 * Incidental models stay bounded without truncating the project's corpus.
 *
 * Indexed project files must remain available to whole-project consumers.
 * Only unindexed entries may be evicted, least-recently-touched first.
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

  it('caps unindexed entries at PARSED_FILES_CAP', () => {
    fillPast(PARSED_FILES_CAP + 20);
    expect(useProjectStore.getState().parsedFiles.size).toBe(PARSED_FILES_CAP);
  });

  it('retains every indexed global file even beyond the cache cap', () => {
    // The MDK shape: every scanned file listed, most with no C_INFO.
    const globals = Array.from(
      { length: PARSED_FILES_CAP + 188 },
      (_, i) => `/proj/DIA_Filler${i}.d`
    );
    useProjectStore.setState({ allDialogFiles: globals, dialogIndex: new Map() });
    for (const filePath of globals) {
      useProjectStore.getState().updateFileModel(filePath, emptyModel());
    }

    expect([...useProjectStore.getState().parsedFiles.keys()]).toEqual(globals);
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

  it('pins all indexed files, including unselected NPCs, plus quest files', () => {
    const globalFile = '/proj/Story_Globals.d';
    const npcFile = '/proj/DIA_Farim.d';
    const questFile = '/proj/Log_Entries.d';
    const otherNpcFile = '/proj/DIA_Other.d';

    useProjectStore.setState({
      allDialogFiles: [globalFile, otherNpcFile],
      questFiles: [questFile],
      selectedNpc: 'SLD_Farim',
      dialogIndex: new Map([
        ['SLD_FARIM', [{ dialogName: 'DIA_Farim_Hallo', npc: 'SLD_Farim', filePath: npcFile }]],
        // This unindexed file belongs to an unselected NPC: only quest pinning
        // can keep it alive.
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
    expect(parsedFiles.has(otherNpcFile)).toBe(true);
  });

  it('retains indexed files parsed on demand beyond the cache cap', async () => {
    const files = Array.from({ length: PARSED_FILES_CAP + 20 }, (_, i) => `/proj/${i}.d`);
    useProjectStore.setState({ allDialogFiles: files });
    const parse = jest.spyOn(window.editorAPI, 'parseDialogFile').mockImplementation(async () => emptyModel());
    try {
      for (const file of files) await useProjectStore.getState().getSemanticModel(file);
      expect(useProjectStore.getState().parsedFiles.size).toBe(files.length);
      await useProjectStore.getState().getSemanticModel(files[0]);
      expect(parse).toHaveBeenCalledTimes(files.length);
    } finally {
      parse.mockRestore();
    }
  });
});
