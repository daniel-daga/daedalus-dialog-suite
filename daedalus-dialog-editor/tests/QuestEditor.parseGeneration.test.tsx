import React from 'react';
import { act, render, screen } from '@testing-library/react';
import QuestEditor from '../src/renderer/components/QuestEditor';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

jest.mock('../src/renderer/components/QuestList', () => ({
  __esModule: true,
  default: () => <div data-testid="quest-list" />
}));

jest.mock('../src/renderer/components/QuestDetails', () => ({
  __esModule: true,
  default: () => <div data-testid="quest-details" />
}));

jest.mock('../src/renderer/store/uiSelectionStore', () => {
  const state = { selectedQuest: 'TOPIC_TEST', setSelectedQuest: jest.fn() };
  const useUISelectionStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state }
  );
  return { useUISelectionStore };
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

const getQuestUsageSpy = jest.fn((_questName: string) => createModel());

describe('QuestEditor activeModel recomputation (PF3)', () => {
  beforeEach(() => {
    getQuestUsageSpy.mockClear();
    useProjectStore.setState({
      projectPath: '/project',
      isIngesting: false,
      parseGeneration: 0,
      parsedFiles: new Map(),
      getQuestUsage: getQuestUsageSpy as unknown as (questName: string) => SemanticModel
    });
  });

  it('recomputes activeModel when parseGeneration bumps while not ingesting', () => {
    render(<QuestEditor semanticModel={createModel()} />);

    expect(getQuestUsageSpy).toHaveBeenCalledTimes(1);

    act(() => {
      useProjectStore.setState({ parseGeneration: 1 });
    });

    expect(getQuestUsageSpy).toHaveBeenCalledTimes(2);
  });

  it('defers activeModel recomputation while ingesting and recomputes once when ingestion ends', () => {
    useProjectStore.setState({ isIngesting: true, parseGeneration: 0, parsedFiles: new Map() });

    render(<QuestEditor semanticModel={createModel()} />);

    // Ignore the initial mount computation; focus on behavior during ingestion.
    getQuestUsageSpy.mockClear();

    // Simulate background-ingestion flushes: parsedFiles identity + generation bump.
    act(() => {
      useProjectStore.setState({ parsedFiles: new Map(), parseGeneration: 1 });
    });
    act(() => {
      useProjectStore.setState({ parsedFiles: new Map(), parseGeneration: 2 });
    });
    act(() => {
      useProjectStore.setState({ parsedFiles: new Map(), parseGeneration: 3 });
    });

    // No recomputation while ingestion is still in flight.
    expect(getQuestUsageSpy).not.toHaveBeenCalled();

    // Ending ingestion triggers exactly one recomputation.
    act(() => {
      useProjectStore.setState({ isIngesting: false });
    });

    expect(getQuestUsageSpy).toHaveBeenCalledTimes(1);
  });
});

describe('QuestEditor surface (Flow view removed)', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projectPath: '/project',
      isIngesting: false,
      parseGeneration: 0,
      parsedFiles: new Map(),
      getQuestUsage: getQuestUsageSpy as unknown as (questName: string) => SemanticModel
    });
  });

  it('renders list and details directly, with no Flow view toggle', () => {
    render(<QuestEditor semanticModel={createModel()} />);

    expect(screen.getByTestId('quest-list')).toBeInTheDocument();
    expect(screen.getByTestId('quest-details')).toBeInTheDocument();
    expect(screen.queryByLabelText('Flow View')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Details View')).not.toBeInTheDocument();
  });
});
