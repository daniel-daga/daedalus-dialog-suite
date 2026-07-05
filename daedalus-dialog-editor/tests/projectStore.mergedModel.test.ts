import { useProjectStore } from '../src/renderer/store/projectStore';
import { SemanticModel } from '../src/renderer/types/global';

// Helper to create a dummy semantic model
const createModel = (vars: string[], dialogs: { name: string; npc: string }[] = []): SemanticModel => ({
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

describe('ProjectStore - mergedSemanticModel', () => {
  beforeEach(() => {
    useProjectStore.setState({
      parsedFiles: new Map(),
      dialogIndex: new Map(),
      allDialogFiles: [],
      mergedSemanticModel: {
        dialogs: {}, functions: {}, constants: {}, variables: {}, instances: {}, hasErrors: false, errors: []
      }
    });
  });

  test('loadAndMergeNpcModels includes both NPC files and global files', () => {
    const npcFile = '/path/to/DIA_NPC.d';
    const globalFile = '/path/to/Constants.d';
    const otherNpcFile = '/path/to/DIA_Other.d';

    // Setup Store State
    useProjectStore.setState({
      allDialogFiles: [npcFile, globalFile, otherNpcFile],
      dialogIndex: new Map([
        ['NPC_1', [{ dialogName: 'DIA_Hello', npc: 'NPC_1', filePath: npcFile, startLine: 1, endLine: 10 }]],
        ['NPC_2', [{ dialogName: 'DIA_Other', npc: 'NPC_2', filePath: otherNpcFile, startLine: 1, endLine: 10 }]]
      ]),
      parsedFiles: new Map([
        [npcFile, { filePath: npcFile, semanticModel: createModel(['VAR_NPC']), lastParsed: new Date() }],
        [globalFile, { filePath: globalFile, semanticModel: createModel(['VAR_GLOBAL']), lastParsed: new Date() }],
        [otherNpcFile, { filePath: otherNpcFile, semanticModel: createModel(['VAR_OTHER']), lastParsed: new Date() }]
      ])
    });

    // Action
    const store = useProjectStore.getState();
    store.loadAndMergeNpcModels('NPC_1');

    // Assert
    const merged = useProjectStore.getState().mergedSemanticModel;

    expect(merged.variables).toHaveProperty('VAR_NPC');    // Should have NPC var
    expect(merged.variables).toHaveProperty('VAR_GLOBAL'); // Should have Global var
    expect(merged.variables).not.toHaveProperty('VAR_OTHER'); // Should NOT have other NPC var
  });

  test('addDialogToIndex registers npc and dialog metadata', () => {
    const store = useProjectStore.getState();

    store.addDialogToIndex({
      dialogName: 'DIA_NewNpc_Start',
      npc: 'SLD_99999_NewNpc',
      filePath: '/dialogs/new-npc.d'
    });

    const state = useProjectStore.getState();
    expect(state.npcList).toContain('SLD_99999_NewNpc');
    expect(state.dialogIndex.get('SLD_99999_NewNpc')).toEqual([
      {
        dialogName: 'DIA_NewNpc_Start',
        npc: 'SLD_99999_NewNpc',
        filePath: '/dialogs/new-npc.d'
      }
    ]);
  });

  test('updateFileModel updates dialogIndex when a dialog is renamed', () => {
    const npcFile = '/path/to/DIA_NPC.d';
    const npcName = 'NPC_Hero';

    useProjectStore.setState({
      projectPath: '/project',
      allDialogFiles: [npcFile],
      dialogIndex: new Map([
        [npcName, [{ dialogName: 'DIA_OldName', npc: npcName, filePath: npcFile }]]
      ]),
      parsedFiles: new Map([
        [npcFile, { filePath: npcFile, semanticModel: createModel([], [{ name: 'DIA_OldName', npc: npcName }]), lastParsed: new Date() }]
      ]),
      selectedNpc: null
    });

    // Simulate rename: new model has DIA_NewName, not DIA_OldName
    const newModel = createModel([], [{ name: 'DIA_NewName', npc: npcName }]);
    useProjectStore.getState().updateFileModel(npcFile, newModel);

    const state = useProjectStore.getState();
    const entries = state.dialogIndex.get(npcName) || [];
    expect(entries.map(e => e.dialogName)).not.toContain('DIA_OldName');
    expect(entries.map(e => e.dialogName)).toContain('DIA_NewName');
  });

  test('updateFileModel removes dialogIndex entry when a dialog is deleted', () => {
    const npcFile = '/path/to/DIA_NPC.d';
    const npcName = 'NPC_Hero';

    useProjectStore.setState({
      projectPath: '/project',
      allDialogFiles: [npcFile],
      dialogIndex: new Map([
        [npcName, [{ dialogName: 'DIA_ToDelete', npc: npcName, filePath: npcFile }]]
      ]),
      parsedFiles: new Map([
        [npcFile, { filePath: npcFile, semanticModel: createModel([], [{ name: 'DIA_ToDelete', npc: npcName }]), lastParsed: new Date() }]
      ]),
      selectedNpc: null
    });

    // Simulate delete: new model has no dialogs
    const newModel = createModel([], []);
    useProjectStore.getState().updateFileModel(npcFile, newModel);

    const state = useProjectStore.getState();
    const entries = state.dialogIndex.get(npcName) || [];
    expect(entries.map(e => e.dialogName)).not.toContain('DIA_ToDelete');
  });

  test('updateFileModel re-merges semanticModel when selectedNpc is set', () => {
    const npcFile = '/path/to/DIA_NPC.d';
    const npcName = 'NPC_Hero';

    useProjectStore.setState({
      projectPath: '/project',
      allDialogFiles: [npcFile],
      dialogIndex: new Map([
        [npcName, [{ dialogName: 'DIA_Start', npc: npcName, filePath: npcFile }]]
      ]),
      parsedFiles: new Map([
        [npcFile, { filePath: npcFile, semanticModel: createModel(['VAR_OLD'], [{ name: 'DIA_Start', npc: npcName }]), lastParsed: new Date() }]
      ]),
      selectedNpc: npcName,
      mergedSemanticModel: {
        dialogs: {}, functions: {}, constants: {}, variables: {}, instances: {}, hasErrors: false, errors: []
      }
    });

    const newModel = createModel(['VAR_NEW'], [{ name: 'DIA_Start', npc: npcName }]);
    useProjectStore.getState().updateFileModel(npcFile, newModel);

    const merged = useProjectStore.getState().mergedSemanticModel;
    expect(merged.variables).toHaveProperty('VAR_NEW');
    expect(merged.variables).not.toHaveProperty('VAR_OLD');
  });

  test('deleteVariable removes the deleted symbol from mergedSemanticModel', async () => {
    const questFile = '/path/to/Quests.d';
    const source = 'var int VAR_KEEP;\nvar int VAR_DELETE;\n';

    const withFilePath = (model: SemanticModel): SemanticModel => ({
      ...model,
      variables: Object.fromEntries(
        Object.entries(model.variables || {}).map(([name, v]) => [
          name,
          { ...v, filePath: questFile }
        ])
      )
    });

    useProjectStore.setState({
      allDialogFiles: [questFile],
      questFiles: [questFile],
      parsedFiles: new Map([
        [questFile, { filePath: questFile, semanticModel: withFilePath(createModel(['VAR_KEEP', 'VAR_DELETE'])), lastParsed: new Date() }]
      ]),
      mergedSemanticModel: withFilePath(createModel(['VAR_KEEP', 'VAR_DELETE']))
    });

    const readFileSpy = jest.spyOn(window.editorAPI, 'readFile').mockResolvedValue(source);
    const writeFileSpy = jest.spyOn(window.editorAPI, 'writeFile').mockResolvedValue({ success: true });
    const parseSpy = jest.spyOn(window.editorAPI, 'parseDialogFile')
      .mockResolvedValue(createModel(['VAR_KEEP']));

    try {
      await useProjectStore.getState().deleteVariable(questFile, {
        startIndex: source.indexOf('var int VAR_DELETE'),
        endIndex: source.indexOf('VAR_DELETE;') + 'VAR_DELETE;'.length
      });

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.variables).toHaveProperty('VAR_KEEP');
      expect(merged.variables).not.toHaveProperty('VAR_DELETE');
    } finally {
      readFileSpy.mockRestore();
      writeFileSpy.mockRestore();
      parseSpy.mockRestore();
    }
  });

  test('updateGlobalConstant handles string values containing semicolons', async () => {
    const questFile = '/path/to/Topics.d';
    const source = 'const string TOPIC_Test = "Old; with semicolon";\nvar int MIS_Test;\n';

    useProjectStore.setState({
      mergedSemanticModel: {
        ...createModel([]),
        constants: {
          TOPIC_Test: { name: 'TOPIC_Test', type: 'string', value: 'Old; with semicolon', filePath: questFile }
        }
      }
    });

    const readFileSpy = jest.spyOn(window.editorAPI, 'readFile').mockResolvedValue(source);
    const writeFileSpy = jest.spyOn(window.editorAPI, 'writeFile').mockResolvedValue({ success: true });
    const parseSpy = jest.spyOn(window.editorAPI, 'parseDialogFile').mockResolvedValue(createModel([]));

    try {
      await useProjectStore.getState().updateGlobalConstant('TOPIC_Test', 'New; still one statement', questFile);

      expect(writeFileSpy).toHaveBeenCalledWith(
        questFile,
        'const string TOPIC_Test = "New; still one statement";\nvar int MIS_Test;\n'
      );
    } finally {
      readFileSpy.mockRestore();
      writeFileSpy.mockRestore();
      parseSpy.mockRestore();
    }
  });

  test('addVariable refuses to write a change that would introduce a syntax error', async () => {
    const questFile = '/path/to/Constants.d';
    const existingSource = 'const int MIS_KEEP = 1;\n';

    // Pre-existing merged content that must survive a rejected add.
    useProjectStore.setState({
      allDialogFiles: [questFile],
      questFiles: [questFile],
      parsedFiles: new Map(),
      mergedSemanticModel: createModel([], [{ name: 'DIA_Keep', npc: 'NPC_Keep' }])
    });

    const readFileSpy = jest.spyOn(window.editorAPI, 'readFile').mockResolvedValue(existingSource);
    const writeFileSpy = jest.spyOn(window.editorAPI, 'writeFile').mockResolvedValue({ success: true });
    // Faithful stand-in for the real parser: an empty constant value (`= ;`) is a syntax error.
    const parseSourceSpy = jest.spyOn(window.editorAPI, 'parseSource').mockImplementation(async (code: string) => {
      if (/=\s*;/.test(code)) {
        return { ...createModel([]), hasErrors: true, errors: [{ type: 'syntax_error', message: 'Syntax error' }] };
      }
      return { ...createModel([]), hasErrors: false, errors: [] };
    });

    try {
      // Constant with an empty value → `const int BROKEN = ;`
      await expect(
        useProjectStore.getState().addVariable('BROKEN', 'int', '', questFile, true)
      ).rejects.toThrow();

      // The corrupt content must never reach disk.
      expect(writeFileSpy).not.toHaveBeenCalled();
      // The existing merged model must be intact (not blanked).
      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.dialogs).toHaveProperty('DIA_Keep');
    } finally {
      readFileSpy.mockRestore();
      writeFileSpy.mockRestore();
      parseSourceSpy.mockRestore();
    }
  });

  test('addVariable preserves existing merged content when the merged model already carries aggregate errors', async () => {
    const questFile = '/path/to/Constants.d';
    const existingSource = 'const int MIS_KEEP = 1;\n';

    // A prior parse of an UNRELATED file left the merged model flagged
    // hasErrors, but it still holds valid dialogs/vars that must not be dropped
    // when the user adds a new (valid) variable.
    useProjectStore.setState({
      allDialogFiles: [questFile],
      questFiles: [questFile],
      parsedFiles: new Map(),
      mergedSemanticModel: {
        ...createModel([], [{ name: 'DIA_Keep', npc: 'NPC_Keep' }]),
        hasErrors: true,
        errors: [{ type: 'syntax_error', message: 'an unrelated file is broken' }]
      }
    });

    const readFileSpy = jest.spyOn(window.editorAPI, 'readFile').mockResolvedValue(existingSource);
    const writeFileSpy = jest.spyOn(window.editorAPI, 'writeFile').mockResolvedValue({ success: true });
    const parseSourceSpy = jest.spyOn(window.editorAPI, 'parseSource')
      .mockResolvedValue({ ...createModel([]), hasErrors: false, errors: [] });
    const parseDialogFileSpy = jest.spyOn(window.editorAPI, 'parseDialogFile')
      .mockResolvedValue(createModel(['NEW_VAR']));

    try {
      await useProjectStore.getState().addVariable('NEW_VAR', 'int', undefined, questFile, false);

      const merged = useProjectStore.getState().mergedSemanticModel;
      expect(merged.dialogs).toHaveProperty('DIA_Keep'); // not blanked
      expect(merged.variables).toHaveProperty('NEW_VAR'); // new var merged in
    } finally {
      readFileSpy.mockRestore();
      writeFileSpy.mockRestore();
      parseSourceSpy.mockRestore();
      parseDialogFileSpy.mockRestore();
    }
  });

  test('loadQuestData preserves existing merged content when the merged model carries aggregate errors', async () => {
    const questFile = '/path/to/Quests.d';

    useProjectStore.setState({
      questFiles: [questFile],
      parsedFiles: new Map([
        [questFile, { filePath: questFile, semanticModel: createModel(['VAR_QUEST']), lastParsed: new Date() }]
      ]),
      mergedSemanticModel: {
        ...createModel(['VAR_KEEP'], [{ name: 'DIA_Keep', npc: 'NPC_Keep' }]),
        hasErrors: true,
        errors: [{ type: 'syntax_error', message: 'some other file is broken' }]
      }
    });

    await useProjectStore.getState().loadQuestData();

    const merged = useProjectStore.getState().mergedSemanticModel;
    expect(merged.dialogs).toHaveProperty('DIA_Keep');
    expect(merged.variables).toHaveProperty('VAR_KEEP');
    expect(merged.variables).toHaveProperty('VAR_QUEST');
  });

  test('addDialogToIndex does not duplicate existing dialog metadata', () => {
    const store = useProjectStore.getState();
    const metadata = {
      dialogName: 'DIA_Same',
      npc: 'SLD_99998_DupeNpc',
      filePath: '/dialogs/dupe.d'
    };

    store.addDialogToIndex(metadata);
    store.addDialogToIndex(metadata);

    const entries = useProjectStore.getState().dialogIndex.get('SLD_99998_DupeNpc') || [];
    expect(entries).toHaveLength(1);
  });
});
