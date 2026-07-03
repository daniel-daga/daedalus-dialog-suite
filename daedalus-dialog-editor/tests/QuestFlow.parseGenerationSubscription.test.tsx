import React from 'react';
import { act, render, screen } from '@testing-library/react';
import QuestFlow from '../src/renderer/components/QuestFlow';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

// The mocked canvas re-renders whenever QuestFlow re-renders (no memo boundary),
// so counting its render invocations is a proxy for QuestFlow render count.
const canvasRenderSpy = jest.fn();
(globalThis as any).__qfParseGenCanvasRenderSpy = canvasRenderSpy;

jest.mock('../src/renderer/components/QuestEditor/QuestLiteGraphCanvas', () => ({
  __esModule: true,
  default: () => {
    (globalThis as any).__qfParseGenCanvasRenderSpy();
    return <div data-testid="quest-litegraph-canvas" />;
  }
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
    applyQuestModelsWithHistory: jest.fn(),
    applyQuestNodePositionWithHistory: jest.fn(),
    getQuestNodePositions: jest.fn(() => new Map()),
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

const settle = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

describe('QuestFlow parsedFiles subscription (PF3)', () => {
  beforeEach(() => {
    canvasRenderSpy.mockClear();
    // Use the real project store so we exercise the actual subscription.
    useProjectStore.setState({ projectPath: null, parsedFiles: new Map() });
  });

  it('does not re-render when the parsedFiles map identity is replaced with equivalent content', async () => {
    render(
      <QuestFlow
        semanticModel={createModel()}
        questName="TOPIC_TEST"
        writableEnabled
      />
    );

    await screen.findByTestId('quest-litegraph-canvas');
    // Let the debounced graph refresh (150 ms) settle before measuring.
    await settle(220);

    const rendersBefore = canvasRenderSpy.mock.calls.length;

    // Simulate a background-ingestion flush: new Map identity, same (empty) content.
    act(() => {
      useProjectStore.setState({ parsedFiles: new Map() });
    });
    await settle(30);

    expect(canvasRenderSpy.mock.calls.length).toBe(rendersBefore);
  });
});
