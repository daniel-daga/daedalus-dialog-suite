import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import QuestList from '../src/renderer/components/QuestList';
import { SemanticModel } from '../src/renderer/types/global';

// Mock react-virtualized-auto-sizer
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 600, width: 400 }),
}));

// Mock useNavigation
const mockNavigateToSymbol = jest.fn();
jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: mockNavigateToSymbol,
  }),
}));

describe('QuestList', () => {
  const mockSemanticModel: SemanticModel = {
    constants: {},
    variables: {},
    functions: {},
    classes: {},
    instances: {},
    dialogs: {},
  };

  // Populate with dummy quests
  for (let i = 0; i < 100; i++) {
    mockSemanticModel.constants[`TOPIC_Quest${i}`] = {
        name: `TOPIC_Quest${i}`,
        value: `"Quest ${i}"`,
        filePath: 'test.d',
        range: { startLine: i, startColumn: 0, endLine: i, endColumn: 20 },
        type: 'const string',
        parent: 'string'
    } as any;
  }

  const mockOnSelectQuest = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a list of quests', () => {
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={mockOnSelectQuest}
      />
    );

    // Check if at least some quests are rendered
    // Note: virtual list might not render all 100, but should render the first few
    expect(screen.getByText('Quest 0')).toBeInTheDocument();
    expect(screen.getByText('TOPIC_Quest0')).toBeInTheDocument();
  });

  it('filters quests by search text', () => {
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={mockOnSelectQuest}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search quests...');
    fireEvent.change(searchInput, { target: { value: 'Quest 50' } });

    expect(screen.getByText('Quest 50')).toBeInTheDocument();
    expect(screen.queryByText('Quest 0')).not.toBeInTheDocument();
  });
});
