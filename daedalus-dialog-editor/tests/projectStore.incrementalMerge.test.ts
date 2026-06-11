import { useProjectStore } from '../src/renderer/store/projectStore';
import { SemanticModel } from '../src/renderer/types/global';

const createModel = (
  vars: string[],
  dialogs: { name: string; npc: string }[] = []
): SemanticModel => ({
  dialogs: dialogs.reduce((acc, d) => ({
    ...acc,
    [d.name]: { name: d.name, properties: { npc: d.npc, description: d.name, nr: 0 }, actions: [], conditions: [] }
  }), {}),
  functions: {},
  constants: {},
  variables: vars.reduce((acc, v) => ({ ...acc, [v]: { name: v, type: 'int' } }), {}),
  instances: {},
  hasErrors: false,
  errors: []
});

const NPC_FILE = '/proj/DIA_Npc1.d';
const OTHER_NPC_FILE = '/proj/DIA_Npc2.d';
const GLOBAL_FILE = '/proj/Constants.d';

describe('projectStore.updateFileModel incremental re-merge', () => {
  beforeEach(() => {
    useProjectStore.setState({
      selectedNpc: 'NPC_1',
      allDialogFiles: [NPC_FILE, OTHER_NPC_FILE, GLOBAL_FILE],
      dialogIndex: new Map([
        ['NPC_1', [{ dialogName: 'DIA_1', npc: 'NPC_1', filePath: NPC_FILE, startLine: 1, endLine: 10 }]],
        ['NPC_2', [{ dialogName: 'DIA_2', npc: 'NPC_2', filePath: OTHER_NPC_FILE, startLine: 1, endLine: 10 }]]
      ]),
      parsedFiles: new Map([
        [NPC_FILE, { filePath: NPC_FILE, semanticModel: createModel(['VAR_A'], [{ name: 'DIA_1', npc: 'NPC_1' }]), lastParsed: new Date() }],
        [OTHER_NPC_FILE, { filePath: OTHER_NPC_FILE, semanticModel: createModel(['VAR_B'], [{ name: 'DIA_2', npc: 'NPC_2' }]), lastParsed: new Date() }],
        [GLOBAL_FILE, { filePath: GLOBAL_FILE, semanticModel: createModel(['VAR_GLOBAL']), lastParsed: new Date() }]
      ])
    } as never);

    // Establish the baseline merged model for the selected NPC (NPC_1 + globals).
    useProjectStore.getState().loadAndMergeNpcModels('NPC_1');
  });

  test('skips re-merge when an unrelated NPC file changes (merged model reference is stable)', () => {
    const before = useProjectStore.getState().mergedSemanticModel;

    useProjectStore.getState().updateFileModel(
      OTHER_NPC_FILE,
      createModel(['VAR_B', 'VAR_B_NEW'], [{ name: 'DIA_2', npc: 'NPC_2' }])
    );

    const after = useProjectStore.getState().mergedSemanticModel;
    expect(after).toBe(before);
    expect(after.variables).not.toHaveProperty('VAR_B_NEW');
  });

  test('re-merges when the selected NPC file changes', () => {
    const before = useProjectStore.getState().mergedSemanticModel;

    useProjectStore.getState().updateFileModel(
      NPC_FILE,
      createModel(['VAR_A', 'VAR_A_NEW'], [{ name: 'DIA_1', npc: 'NPC_1' }])
    );

    const after = useProjectStore.getState().mergedSemanticModel;
    expect(after).not.toBe(before);
    expect(after.variables).toHaveProperty('VAR_A_NEW');
  });

  test('re-merges when a global (dialog-less) file changes', () => {
    const before = useProjectStore.getState().mergedSemanticModel;

    useProjectStore.getState().updateFileModel(
      GLOBAL_FILE,
      createModel(['VAR_GLOBAL', 'VAR_GLOBAL_NEW'])
    );

    const after = useProjectStore.getState().mergedSemanticModel;
    expect(after).not.toBe(before);
    expect(after.variables).toHaveProperty('VAR_GLOBAL_NEW');
  });

  test('does not rebuild dialogIndex when only action content changes (no dialog set change)', () => {
    const before = useProjectStore.getState().dialogIndex;

    // Same dialog name + npc, but a different model object (e.g. an edited
    // action body) — the dialog index must not be rebuilt.
    const edited = createModel(['VAR_A'], [{ name: 'DIA_1', npc: 'NPC_1' }]);
    edited.functions = { DIA_1_Info: { name: 'DIA_1_Info', returnType: 'VOID', actions: [{ type: 'DialogLine', text: 'changed', speaker: 'self', id: 'x' }], conditions: [], calls: [] } } as never;

    useProjectStore.getState().updateFileModel(NPC_FILE, edited);

    const after = useProjectStore.getState().dialogIndex;
    expect(after).toBe(before);
  });

  test('rebuilds dialogIndex when a dialog is added to the file', () => {
    const before = useProjectStore.getState().dialogIndex;

    useProjectStore.getState().updateFileModel(
      NPC_FILE,
      createModel(['VAR_A'], [{ name: 'DIA_1', npc: 'NPC_1' }, { name: 'DIA_1b', npc: 'NPC_1' }])
    );

    const after = useProjectStore.getState().dialogIndex;
    expect(after).not.toBe(before);
    expect((after.get('NPC_1') || []).map((d) => d.dialogName)).toEqual(
      expect.arrayContaining(['DIA_1', 'DIA_1b'])
    );
  });
});
