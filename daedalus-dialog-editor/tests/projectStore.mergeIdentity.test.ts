import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

const NPC_FILE = '/proj/DIA_Npc1.d';
const GLOBAL_FILE = '/proj/Constants.d';

/**
 * Build a model whose category objects are the exact references passed in, so a
 * test can mimic an Immer edit (only `functions` gets a new reference; every
 * other category keeps its previous reference).
 */
const modelWith = (parts: Partial<SemanticModel>): SemanticModel => ({
  dialogs: {},
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: [],
  ...parts
});

describe('projectStore category-stable merge identity', () => {
  beforeEach(() => {
    useProjectStore.getState().closeProject();
  });

  test('reuses unchanged category objects and rebuilds only the changed one', () => {
    const globalConstants = { GLOBAL_C: { name: 'GLOBAL_C', type: 'int' } } as never;
    const globalModel = modelWith({ constants: globalConstants });

    const dialogs = { DIA_1: { name: 'DIA_1', properties: { npc: 'NPC_1', description: 'DIA_1', nr: 0 }, actions: [], conditions: [] } } as never;
    const constants = { C_A: { name: 'C_A', type: 'int' } } as never;
    const variables = { V_A: { name: 'V_A', type: 'int' } } as never;
    const instances = { I_A: { name: 'I_A' } } as never;
    const npcV1 = modelWith({
      dialogs,
      functions: { F1: { name: 'F1' } } as never,
      constants,
      variables,
      instances
    });

    useProjectStore.setState({
      selectedNpc: 'NPC_1',
      allDialogFiles: [NPC_FILE, GLOBAL_FILE],
      dialogIndex: new Map([
        ['NPC_1', [{ dialogName: 'DIA_1', npc: 'NPC_1', filePath: NPC_FILE, startLine: 1, endLine: 10 }]]
      ]),
      parsedFiles: new Map([
        [NPC_FILE, { filePath: NPC_FILE, semanticModel: npcV1, lastParsed: new Date() }],
        [GLOBAL_FILE, { filePath: GLOBAL_FILE, semanticModel: globalModel, lastParsed: new Date() }]
      ])
    } as never);

    useProjectStore.getState().loadAndMergeNpcModels('NPC_1');
    const before = useProjectStore.getState().mergedSemanticModel;

    // Mimic an Immer edit: only the functions reference is new; all other
    // categories keep their previous references.
    const npcV2 = { ...npcV1, functions: { F1: { name: 'F1' }, F_NEW: { name: 'F_NEW' } } as never };
    useProjectStore.getState().updateFileModel(NPC_FILE, npcV2);

    const after = useProjectStore.getState().mergedSemanticModel;

    // Top-level identity must change (dialogs/functions consumers must react).
    expect(after).not.toBe(before);

    // Untouched categories keep referential identity.
    expect(after.constants).toBe(before.constants);
    expect(after.variables).toBe(before.variables);
    expect(after.instances).toBe(before.instances);

    // The changed category is rebuilt and reflects the update.
    expect(after.functions).not.toBe(before.functions);
    expect(after.functions).toHaveProperty('F_NEW');
  });

  test('a no-op merge (all category signatures unchanged) preserves the top-level model identity', () => {
    const constants = { C_A: { name: 'C_A', type: 'int' } } as never;
    const functions = { F1: { name: 'F1' } } as never;
    const model = modelWith({ constants, functions });

    useProjectStore.getState().mergeSemanticModels([model]);
    const first = useProjectStore.getState().mergedSemanticModel;

    // Merge identical inputs again → every category signature hits the cache,
    // so the top-level object identity must be preserved (no-op merge).
    useProjectStore.getState().mergeSemanticModels([model]);
    const second = useProjectStore.getState().mergedSemanticModel;
    expect(second).toBe(first);

    // A real category change still yields a fresh top-level reference.
    const changed = { ...model, functions: { F1: { name: 'F1' }, F2: { name: 'F2' } } as never };
    useProjectStore.getState().mergeSemanticModels([changed]);
    const third = useProjectStore.getState().mergedSemanticModel;
    expect(third).not.toBe(second);
    expect(third.functions).toHaveProperty('F2');
  });

  test('closeProject resets the merge cache so a reopen does not reuse stale category objects', () => {
    const sharedConstants = { C_A: { name: 'C_A', type: 'int' } } as never;
    const model = modelWith({ constants: sharedConstants });

    const seed = () => {
      useProjectStore.setState({
        selectedNpc: 'NPC_1',
        allDialogFiles: [NPC_FILE],
        dialogIndex: new Map([
          ['NPC_1', [{ dialogName: 'DIA_1', npc: 'NPC_1', filePath: NPC_FILE, startLine: 1, endLine: 10 }]]
        ]),
        parsedFiles: new Map([
          [NPC_FILE, { filePath: NPC_FILE, semanticModel: model, lastParsed: new Date() }]
        ])
      } as never);
      useProjectStore.getState().loadAndMergeNpcModels('NPC_1');
    };

    seed();
    const preCloseConstants = useProjectStore.getState().mergedSemanticModel.constants;

    useProjectStore.getState().closeProject();

    // Re-seed with the SAME input references. If the merge cache were not reset,
    // the signature would match and the stale merged category object would be
    // reused. A correct reset forces a rebuild → a fresh object.
    seed();
    const reopenedConstants = useProjectStore.getState().mergedSemanticModel.constants;

    expect(reopenedConstants).not.toBe(preCloseConstants);
    expect(reopenedConstants).toHaveProperty('C_A');
  });
});
