import React from 'react';
import { render, screen } from '@testing-library/react';
import QuestFlow from '../src/renderer/components/QuestFlow';
import type { SemanticModel } from '../src/renderer/types/global';

jest.mock('reactflow', () => ({
  __esModule: true,
  useNodesState: () => [[], jest.fn(), jest.fn()],
  useEdgesState: () => [[], jest.fn(), jest.fn()]
}));

jest.mock('../src/renderer/components/QuestEditor/QuestLiteGraphCanvas', () => ({
  __esModule: true,
  default: () => <div data-testid="quest-litegraph-canvas" />
}));

jest.mock('../src/renderer/quest/domain/graph', () => ({
  buildQuestGraph: () => ({ nodes: [], edges: [] })
}));

jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToDialog: jest.fn(),
    navigateToSymbol: jest.fn()
  })
}));

const projectStoreState = {
  projectPath: null,
  parsedFiles: new Map()
};

jest.mock('../src/renderer/store/projectStore', () => ({
  useProjectStore: (selector: (state: typeof projectStoreState) => unknown) => selector(projectStoreState)
}));

jest.mock('../src/renderer/store/fileStore', () => {
  const fileStoreState = {
    activeFile: null,
    getFileState: jest.fn(),
    openFile: jest.fn(),
    codeSettings: {
      indentChar: '\t',
      includeComments: true,
      sectionHeaders: true,
      uppercaseKeywords: true
    }
  };

  const useFileStore = Object.assign(
    (selector: (state: typeof fileStoreState) => unknown) => selector(fileStoreState),
    { getState: () => fileStoreState }
  );

  return { useFileStore };
});

jest.mock('../src/renderer/store/historyStore', () => {
  const historyStoreState = {
    applyQuestModelWithHistory: jest.fn(),
    applyQuestModelsWithHistory: jest.fn(),
    applyQuestNodePositionWithHistory: jest.fn(),
    setQuestNodePosition: jest.fn(),
    getQuestNodePositions: jest.fn(() => new Map()),
    undoQuestModel: jest.fn(),
    redoQuestModel: jest.fn(),
    canUndoQuestModel: jest.fn(() => false),
    canRedoQuestModel: jest.fn(() => false),
    undoLastQuestBatch: jest.fn(),
    redoLastQuestBatch: jest.fn(),
    canUndoLastQuestBatch: jest.fn(() => false),
    canRedoLastQuestBatch: jest.fn(() => false),
  };

  const useHistoryStore = Object.assign(
    (selector: (state: typeof historyStoreState) => unknown) => selector(historyStoreState),
    { getState: () => historyStoreState }
  );

  return { useHistoryStore };
});

const createModel = (): SemanticModel => ({
  dialogs: {},
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

describe('QuestFlow UI', () => {
  it('shows read-only fallback messaging when writable is disabled', () => {
    render(
      <QuestFlow
        semanticModel={createModel()}
        questName="TOPIC_TEST"
        writableEnabled={false}
      />
    );

    expect(screen.getByText('Writable quest editor is disabled (read-only fallback).')).toBeInTheDocument();
    expect(screen.getByText('Using ComfyUI-style node editor defaults.')).toBeInTheDocument();
  });

  it('renders only the comfy-style node editor canvas', () => {
    render(
      <QuestFlow
        semanticModel={createModel()}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    expect(screen.getByTestId('quest-litegraph-canvas')).toBeInTheDocument();
    expect(screen.queryByLabelText('Connect mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Connect As')).not.toBeInTheDocument();
  });
});
