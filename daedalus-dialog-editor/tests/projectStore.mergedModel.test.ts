import { act } from '@testing-library/react';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SemanticModel } from '../src/renderer/types/global';

// Helper to create a dummy semantic model
const createModel = (vars: string[]): SemanticModel => ({
  dialogs: {},
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
