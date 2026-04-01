import { useFileStore } from '../src/renderer/store/fileStore';
import { useHistoryStore } from '../src/renderer/store/historyStore';
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

describe('historyStore quest history', () => {
  const filePath = 'C:/tmp/test.d';

  beforeEach(() => {
    useFileStore.setState({
      openFiles: new Map([
        [filePath, {
          filePath,
          semanticModel: createModel('LOG_RUNNING'),
          isDirty: false,
          lastSaved: new Date()
        }]
      ]),
      activeFile: filePath
    });
    useHistoryStore.setState({
      questHistory: new Map(),
      questBatchHistory: { past: [], future: [] },
      questNodePositions: new Map(),
    });
  });

  it('applies quest model with undo history and supports undo/redo', () => {
    const updatedModel = createModel('LOG_SUCCESS');
    useHistoryStore.getState().applyQuestModelWithHistory(filePath, updatedModel);

    expect(useFileStore.getState().getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      type: 'SetVariableAction',
      value: 'LOG_SUCCESS'
    });
    expect(useHistoryStore.getState().canUndoQuestModel(filePath)).toBe(true);
    expect(useHistoryStore.getState().canRedoQuestModel(filePath)).toBe(false);

    useHistoryStore.getState().undoQuestModel(filePath);
    expect(useFileStore.getState().getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      type: 'SetVariableAction',
      value: 'LOG_RUNNING'
    });
    expect(useHistoryStore.getState().canRedoQuestModel(filePath)).toBe(true);

    useHistoryStore.getState().redoQuestModel(filePath);
    expect(useFileStore.getState().getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      type: 'SetVariableAction',
      value: 'LOG_SUCCESS'
    });
  });

  it('stores and retrieves quest node position overrides', () => {
    useHistoryStore.getState().setQuestNodePosition(filePath, 'TOPIC_TEST', 'DIA_Test_Info', { x: 10, y: 20 });
    useHistoryStore.getState().setQuestNodePosition(filePath, 'TOPIC_TEST', 'DIA_Test_Other', { x: 30, y: 40 });

    const positions = useHistoryStore.getState().getQuestNodePositions(filePath, 'TOPIC_TEST');
    expect(positions.get('DIA_Test_Info')).toEqual({ x: 10, y: 20 });
    expect(positions.get('DIA_Test_Other')).toEqual({ x: 30, y: 40 });
  });

  it('clears quest node position overrides by quest', () => {
    useHistoryStore.getState().setQuestNodePosition(filePath, 'TOPIC_TEST', 'DIA_Test_Info', { x: 10, y: 20 });
    useHistoryStore.getState().clearQuestNodePositions(filePath, 'TOPIC_TEST');

    const positions = useHistoryStore.getState().getQuestNodePositions(filePath, 'TOPIC_TEST');
    expect(positions.size).toBe(0);
  });

  it('undoes and redoes node position moves through quest history', () => {
    useHistoryStore.getState().applyQuestNodePositionWithHistory(filePath, 'TOPIC_TEST', 'DIA_Test_Info', { x: 50, y: 60 });

    expect(useHistoryStore.getState().getQuestNodePositions(filePath, 'TOPIC_TEST').get('DIA_Test_Info')).toEqual({ x: 50, y: 60 });
    expect(useHistoryStore.getState().canUndoQuestModel(filePath)).toBe(true);
    expect(useHistoryStore.getState().canRedoQuestModel(filePath)).toBe(false);

    useHistoryStore.getState().undoQuestModel(filePath);
    expect(useHistoryStore.getState().getQuestNodePositions(filePath, 'TOPIC_TEST').get('DIA_Test_Info')).toBeUndefined();
    expect(useHistoryStore.getState().canRedoQuestModel(filePath)).toBe(true);

    useHistoryStore.getState().redoQuestModel(filePath);
    expect(useHistoryStore.getState().getQuestNodePositions(filePath, 'TOPIC_TEST').get('DIA_Test_Info')).toEqual({ x: 50, y: 60 });
  });

  it('applies multiple quest models in a single batch call', () => {
    const secondPath = 'C:/tmp/test2.d';
    useFileStore.setState((state) => ({
      openFiles: new Map([
        ...state.openFiles,
        [secondPath, {
          filePath: secondPath,
          semanticModel: createModel('LOG_RUNNING'),
          isDirty: false,
          lastSaved: new Date()
        }]
      ]),
    }));

    useHistoryStore.getState().applyQuestModelsWithHistory([
      { filePath, model: createModel('LOG_SUCCESS') },
      { filePath: secondPath, model: createModel('LOG_FAILED') }
    ]);

    expect(useFileStore.getState().getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_SUCCESS'
    });
    expect(useFileStore.getState().getFileState(secondPath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_FAILED'
    });
    expect(useHistoryStore.getState().canUndoQuestModel(filePath)).toBe(true);
    expect(useHistoryStore.getState().canUndoQuestModel(secondPath)).toBe(true);
  });

  it('undoes and redoes the last quest batch across multiple files', () => {
    const secondPath = 'C:/tmp/test-batch-2.d';
    useFileStore.setState((state) => ({
      openFiles: new Map([
        ...state.openFiles,
        [secondPath, {
          filePath: secondPath,
          semanticModel: createModel('LOG_RUNNING'),
          isDirty: false,
          lastSaved: new Date()
        }]
      ]),
    }));

    useHistoryStore.getState().applyQuestModelsWithHistory([
      { filePath, model: createModel('LOG_SUCCESS') },
      { filePath: secondPath, model: createModel('LOG_FAILED') }
    ]);

    expect(useHistoryStore.getState().canUndoLastQuestBatch()).toBe(true);

    useHistoryStore.getState().undoLastQuestBatch();
    expect(useFileStore.getState().getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_RUNNING'
    });
    expect(useFileStore.getState().getFileState(secondPath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_RUNNING'
    });
    expect(useHistoryStore.getState().canRedoLastQuestBatch()).toBe(true);

    useHistoryStore.getState().redoLastQuestBatch();
    expect(useFileStore.getState().getFileState(filePath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_SUCCESS'
    });
    expect(useFileStore.getState().getFileState(secondPath)?.semanticModel.functions.DIA_Test_Info.actions[0]).toMatchObject({
      value: 'LOG_FAILED'
    });
  });
});
