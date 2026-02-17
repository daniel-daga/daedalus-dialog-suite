import { useEditorStore } from '../src/renderer/store/editorStore';
import type { SemanticModel } from '../src/renderer/types/global';

const createModel = (value: string): SemanticModel => ({
  dialogs: {},
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{
        type: 'SetVariableAction',
        variableName: 'MIS_TEST',
        operator: '=',
        value
      }],
      conditions: [],
      calls: []
    }
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

describe('editorStore quest history', () => {
  const filePath = 'C:/tmp/test.d';

  beforeEach(() => {
    useEditorStore.setState({
      openFiles: new Map([
        [filePath, {
          filePath,
          semanticModel: createModel('LOG_RUNNING'),
          isDirty: false,
          lastSaved: new Date()
        }]
      ]),
      questHistory: new Map(),
      questBatchHistory: { past: [], future: [] },
      questNodePositions: new Map(),
      activeFile: filePath
    });
  });

  it('applies quest model with undo history and supports undo/redo', () => {
    const store = useEditorStore.getState();
    const updatedModel = createModel('LOG_SUCCESS');
    store.applyQuestModelWithHistory(filePath, updatedModel);

    let next = useEditorStore.getState();
    expect(next.getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      type: 'SetVariableAction',
      value: 'LOG_SUCCESS'
    });
    expect(next.canUndoQuestModel(filePath)).toBe(true);
    expect(next.canRedoQuestModel(filePath)).toBe(false);

    next.undoQuestModel(filePath);
    next = useEditorStore.getState();
    expect(next.getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      type: 'SetVariableAction',
      value: 'LOG_RUNNING'
    });
    expect(next.canRedoQuestModel(filePath)).toBe(true);

    next.redoQuestModel(filePath);
    next = useEditorStore.getState();
    expect(next.getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      type: 'SetVariableAction',
      value: 'LOG_SUCCESS'
    });
  });

  it('stores and retrieves quest node position overrides', () => {
    const store = useEditorStore.getState();
    store.setQuestNodePosition(filePath, 'TOPIC_TEST', 'DIA_Test_Info', { x: 10, y: 20 });
    store.setQuestNodePosition(filePath, 'TOPIC_TEST', 'DIA_Test_Other', { x: 30, y: 40 });

    const positions = store.getQuestNodePositions(filePath, 'TOPIC_TEST');
    expect(positions.get('DIA_Test_Info')).toEqual({ x: 10, y: 20 });
    expect(positions.get('DIA_Test_Other')).toEqual({ x: 30, y: 40 });
  });

  it('clears quest node position overrides by quest', () => {
    const store = useEditorStore.getState();
    store.setQuestNodePosition(filePath, 'TOPIC_TEST', 'DIA_Test_Info', { x: 10, y: 20 });
    store.clearQuestNodePositions(filePath, 'TOPIC_TEST');

    const positions = store.getQuestNodePositions(filePath, 'TOPIC_TEST');
    expect(positions.size).toBe(0);
  });

  it('undoes and redoes node position moves through quest history', () => {
    const store = useEditorStore.getState();
    store.applyQuestNodePositionWithHistory(filePath, 'TOPIC_TEST', 'DIA_Test_Info', { x: 50, y: 60 });

    let next = useEditorStore.getState();
    expect(next.getQuestNodePositions(filePath, 'TOPIC_TEST').get('DIA_Test_Info')).toEqual({ x: 50, y: 60 });
    expect(next.canUndoQuestModel(filePath)).toBe(true);
    expect(next.canRedoQuestModel(filePath)).toBe(false);

    next.undoQuestModel(filePath);
    next = useEditorStore.getState();
    expect(next.getQuestNodePositions(filePath, 'TOPIC_TEST').get('DIA_Test_Info')).toBeUndefined();
    expect(next.canRedoQuestModel(filePath)).toBe(true);

    next.redoQuestModel(filePath);
    next = useEditorStore.getState();
    expect(next.getQuestNodePositions(filePath, 'TOPIC_TEST').get('DIA_Test_Info')).toEqual({ x: 50, y: 60 });
  });

  it('applies multiple quest models in a single batch call', () => {
    const secondPath = 'C:/tmp/test2.d';
    useEditorStore.setState((state) => ({
      ...state,
      openFiles: new Map([
        ...state.openFiles,
        [secondPath, {
          filePath: secondPath,
          semanticModel: createModel('LOG_RUNNING'),
          isDirty: false,
          lastSaved: new Date()
        }]
      ]),
      questHistory: new Map([
        ...state.questHistory
      ])
    }));

    const store = useEditorStore.getState();
    store.applyQuestModelsWithHistory([
      { filePath, model: createModel('LOG_SUCCESS') },
      { filePath: secondPath, model: createModel('LOG_FAILED') }
    ]);

    const next = useEditorStore.getState();
    expect(next.getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_SUCCESS'
    });
    expect(next.getFileState(secondPath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_FAILED'
    });
    expect(next.canUndoQuestModel(filePath)).toBe(true);
    expect(next.canUndoQuestModel(secondPath)).toBe(true);
  });

  it('undoes and redoes the last quest batch across multiple files', () => {
    const secondPath = 'C:/tmp/test-batch-2.d';
    useEditorStore.setState((state) => ({
      ...state,
      openFiles: new Map([
        ...state.openFiles,
        [secondPath, {
          filePath: secondPath,
          semanticModel: createModel('LOG_RUNNING'),
          isDirty: false,
          lastSaved: new Date()
        }]
      ]),
      questHistory: new Map([...state.questHistory])
    }));

    const store = useEditorStore.getState();
    store.applyQuestModelsWithHistory([
      { filePath, model: createModel('LOG_SUCCESS') },
      { filePath: secondPath, model: createModel('LOG_FAILED') }
    ]);

    let next = useEditorStore.getState();
    expect(next.canUndoLastQuestBatch()).toBe(true);

    next.undoLastQuestBatch();
    next = useEditorStore.getState();
    expect(next.getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_RUNNING'
    });
    expect(next.getFileState(secondPath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_RUNNING'
    });
    expect(next.canRedoLastQuestBatch()).toBe(true);

    next.redoLastQuestBatch();
    next = useEditorStore.getState();
    expect(next.getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_SUCCESS'
    });
    expect(next.getFileState(secondPath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_FAILED'
    });
  });
});
