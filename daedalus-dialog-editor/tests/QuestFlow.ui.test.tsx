import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import QuestFlow from '../src/renderer/components/QuestFlow';
import type { SemanticModel } from '../src/renderer/types/global';

jest.mock('reactflow', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => <div data-testid="reactflow">{children}</div>,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    useNodesState: () => [[], jest.fn(), jest.fn()],
    useEdgesState: () => [[], jest.fn(), jest.fn()]
  };
});

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

jest.mock('../src/renderer/store/editorStore', () => {
  const editorStoreState = {
    activeFile: null,
    getFileState: jest.fn(),
    openFile: jest.fn(),
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
    codeSettings: {
      indentChar: '\t',
      includeComments: true,
      sectionHeaders: true,
      uppercaseKeywords: true
    }
  };

  const useEditorStore = Object.assign(
    (selector: (state: typeof editorStoreState) => unknown) => selector(editorStoreState),
    {
      getState: () => editorStoreState
    }
  );

  return { useEditorStore };
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
    expect(screen.getByLabelText('Connect mode')).toBeDisabled();
  });

  it('shows connect type selector when connect mode is enabled', () => {
    render(
      <QuestFlow
        semanticModel={createModel()}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    fireEvent.click(screen.getByLabelText('Connect mode'));
    expect(screen.getAllByText('Connect As').length).toBeGreaterThan(0);
  });
});
