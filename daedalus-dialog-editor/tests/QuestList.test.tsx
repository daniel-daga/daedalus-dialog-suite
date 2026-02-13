import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuestList from '../src/renderer/components/QuestList';
import '@testing-library/jest-dom';

// Mock navigation hook
const mockNavigateToSymbol = jest.fn();
jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: mockNavigateToSymbol,
  }),
}));

// Mock quest analysis
jest.mock('../src/renderer/components/QuestEditor/questAnalysis', () => ({
  analyzeQuest: jest.fn(() => ({
    status: 'wip',
    logicMethod: 'explicit',
    misVariableExists: true,
    misVariableName: 'MIS_MyQuest',
    hasStart: true,
    hasSuccess: false,
    hasFailed: false,
    description: 'My Quest Description',
    filePaths: { topic: null, variable: null }
  })),
  getUsedQuestTopics: jest.fn(() => new Set(['TOPIC_Quest1'])),
}));

// Mock react-virtualized-auto-sizer for future proofing (even though current component doesn't use it yet)
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 300 }),
}));

describe('QuestList', () => {
  const mockSemanticModel: any = {
    constants: {
      'TOPIC_Quest1': { name: 'TOPIC_Quest1', value: '"Quest One"', type: 'const string', filePath: 'test.d' },
      'TOPIC_Quest2': { name: 'TOPIC_Quest2', value: '"Quest Two"', type: 'const string', filePath: 'test.d' },
    },
    variables: {},
    functions: {},
  };

  const mockOnSelectQuest = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders quest list with items', () => {
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={mockOnSelectQuest}
      />
    );

    // Should render the title
    expect(screen.getByText('Quests')).toBeInTheDocument();

    // Should render the quest items (names and descriptions)
    expect(screen.getByText('Quest One')).toBeInTheDocument();
    expect(screen.getByText('TOPIC_Quest1')).toBeInTheDocument();
    expect(screen.getByText('Quest Two')).toBeInTheDocument();
    expect(screen.getByText('TOPIC_Quest2')).toBeInTheDocument();
  });

  it('filters quests by search text', async () => {
    const user = userEvent.setup();
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={mockOnSelectQuest}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search quests...');
    await user.type(searchInput, 'Two');

    // Should show Quest Two but not Quest One
    expect(screen.getByText('Quest Two')).toBeInTheDocument();
    expect(screen.queryByText('Quest One')).not.toBeInTheDocument();
  });

  it('selects a quest on click', async () => {
    const user = userEvent.setup();
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={mockOnSelectQuest}
      />
    );

    const questItem = screen.getByText('Quest One');
    await user.click(questItem);

    expect(mockOnSelectQuest).toHaveBeenCalledWith('TOPIC_Quest1');
  });
});
