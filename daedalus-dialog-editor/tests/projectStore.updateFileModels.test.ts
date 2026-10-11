/**
 * P0 perf: a batch of watcher updates must cost one store cascade, not N.
 *
 * updateFileModels(updates) does the parsedFiles clone, the dialogIndex
 * change scan, the parseGeneration bump, and the (conditional) re-merge once
 * for the whole batch. updateFileModel delegates to it with a single entry.
 */

import { useProjectStore } from '../src/renderer/store/projectStore';
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

const modelWithDialog = (dialogName: string, npc: string, extra: Partial<SemanticModel> = {}): SemanticModel => ({
  ...emptyModel(),
  dialogs: { [dialogName]: { name: dialogName, properties: { npc } } as any },
  ...extra
});

describe('projectStore.updateFileModels', () => {
  beforeEach(() => {
    useProjectStore.getState().closeProject();
  });

  it('applies N updates with exactly one parseGeneration bump and one parsedFiles identity change', () => {
    const before = useProjectStore.getState();
    const generationBefore = before.parseGeneration;

    let parsedFilesChanges = 0;
    let lastSeen = before.parsedFiles;
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (state.parsedFiles !== lastSeen) {
        parsedFilesChanges += 1;
        lastSeen = state.parsedFiles;
      }
    });

    useProjectStore.getState().updateFileModels([
      { filePath: '/proj/a.d', model: emptyModel() },
      { filePath: '/proj/b.d', model: emptyModel() },
      { filePath: '/proj/c.d', model: emptyModel() }
    ]);
    unsubscribe();

    const after = useProjectStore.getState();
    expect(after.parseGeneration).toBe(generationBefore + 1);
    expect(parsedFilesChanges).toBe(1);
    expect(after.parsedFiles.size).toBe(3);
    expect(after.parsedFiles.get('/proj/b.d')?.semanticModel).toBeDefined();
  });

  it('re-merges the selected NPC model once per batch, not once per file', () => {
    const npcFileA = '/proj/DIA_Farim_1.d';
    const npcFileB = '/proj/DIA_Farim_2.d';
    useProjectStore.setState({
      selectedNpc: 'SLD_Farim',
      allDialogFiles: [npcFileA, npcFileB],
      dialogIndex: new Map([
        ['SLD_Farim', [
          { dialogName: 'DIA_A', npc: 'SLD_Farim', filePath: npcFileA },
          { dialogName: 'DIA_B', npc: 'SLD_Farim', filePath: npcFileB }
        ]]
      ])
    });

    let mergedChanges = 0;
    let lastMerged = useProjectStore.getState().mergedSemanticModel;
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (state.mergedSemanticModel !== lastMerged) {
        mergedChanges += 1;
        lastMerged = state.mergedSemanticModel;
      }
    });

    useProjectStore.getState().updateFileModels([
      {
        filePath: npcFileA,
        model: modelWithDialog('DIA_A', 'SLD_Farim', { constants: { C_A: { name: 'C_A' } as any } })
      },
      {
        filePath: npcFileB,
        model: modelWithDialog('DIA_B', 'SLD_Farim', { constants: { C_B: { name: 'C_B' } as any } })
      }
    ]);
    unsubscribe();

    expect(mergedChanges).toBe(1);
    const merged = useProjectStore.getState().mergedSemanticModel;
    expect(merged.constants).toHaveProperty('C_A');
    expect(merged.constants).toHaveProperty('C_B');
  });

  it('skips the re-merge when no updated file participates in the selected NPC model', () => {
    const otherFile = '/proj/DIA_Other.d';
    useProjectStore.setState({
      selectedNpc: 'SLD_Farim',
      allDialogFiles: [otherFile],
      dialogIndex: new Map([
        ['Other_NPC', [{ dialogName: 'DIA_Other', npc: 'Other_NPC', filePath: otherFile }]]
      ])
    });

    const mergedBefore = useProjectStore.getState().mergedSemanticModel;
    useProjectStore.getState().updateFileModels([
      { filePath: otherFile, model: modelWithDialog('DIA_Other', 'Other_NPC') }
    ]);

    expect(useProjectStore.getState().mergedSemanticModel).toBe(mergedBefore);
  });

  it('preserves untouched cache entries and dialogIndex identity when dialog sets are unchanged', () => {
    const untouched = '/proj/untouched.d';
    const touched = '/proj/touched.d';
    useProjectStore.getState().updateFileModels([
      { filePath: untouched, model: emptyModel() },
      { filePath: touched, model: emptyModel() }
    ]);

    const before = useProjectStore.getState();
    const untouchedEntry = before.parsedFiles.get(untouched);
    const dialogIndexBefore = before.dialogIndex;

    useProjectStore.getState().updateFileModels([{ filePath: touched, model: emptyModel() }]);

    const after = useProjectStore.getState();
    expect(after.parsedFiles.get(untouched)).toBe(untouchedEntry);
    expect(after.dialogIndex).toBe(dialogIndexBefore);
  });

  it('rebuilds the dialog index once when files change their dialog sets', () => {
    const fileA = '/proj/a.d';
    const fileB = '/proj/b.d';
    useProjectStore.getState().updateFileModels([
      { filePath: fileA, model: modelWithDialog('DIA_A', 'NPC_A') },
      { filePath: fileB, model: modelWithDialog('DIA_B', 'NPC_B') }
    ]);

    let index = useProjectStore.getState().dialogIndex;
    expect(index.get('NPC_A')).toHaveLength(1);
    expect(index.get('NPC_B')).toHaveLength(1);

    // Rename A's dialog and delete B's in one batch.
    useProjectStore.getState().updateFileModels([
      { filePath: fileA, model: modelWithDialog('DIA_A_Renamed', 'NPC_A') },
      { filePath: fileB, model: emptyModel() }
    ]);

    index = useProjectStore.getState().dialogIndex;
    expect(index.get('NPC_A')?.map((d) => d.dialogName)).toEqual(['DIA_A_Renamed']);
    expect(index.has('NPC_B')).toBe(false);
  });
});
