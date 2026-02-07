import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuestList from '../src/renderer/components/QuestList';
import '@testing-library/jest-dom';
import { SemanticModel } from '../src/renderer/types/global';

// Mock useNavigation
const mockNavigateToSymbol = jest.fn();
jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: mockNavigateToSymbol,
  }),
}));

// Mock react-virtualized-auto-sizer
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 250 }),
}));

// Mock CreateQuestDialog
jest.mock('../src/renderer/components/CreateQuestDialog', () => {
  return function MockCreateQuestDialog({ open, onClose }: any) {
    if (!open) return null;
    return (
      <div data-testid="create-quest-dialog">
        <button onClick={onClose}>Close</button>
      </div>
    );
  };
});

describe('QuestList', () => {
  const mockOnSelectQuest = jest.fn();

  const mockSemanticModel: SemanticModel = {
    hasErrors: false,
    errors: [],
    constants: {
      'TOPIC_Test1': { name: 'TOPIC_Test1', type: 'string', value: '"Test Quest 1"', filePath: 'file1.d' },
      'TOPIC_Test2': { name: 'TOPIC_Test2', type: 'string', value: '"Test Quest 2"', filePath: 'file1.d' },
      'TOPIC_Unused': { name: 'TOPIC_Unused', type: 'string', value: '"Unused Quest"', filePath: 'file1.d' },
      'OTHER_CONST': { name: 'OTHER_CONST', type: 'int', value: 123, filePath: 'file1.d' },
    },
    functions: {
      'Func_Used_Quest': {
        name: 'Func_Used_Quest',
        returnType: 'VOID',
        actions: [
          {
            topic: 'TOPIC_Test1',
            text: 'Log entry',
            // duck-typed as LogEntryAction
          } as any
        ],
        conditions: [],
        calls: []
      },
      'Func_Used_Quest2': {
        name: 'Func_Used_Quest2',
        returnType: 'VOID',
        actions: [
            // This one is used via CreateTopicAction
          {
            topic: 'TOPIC_Test2',
            topicType: 'LOG_MISSION',
            // duck-typed as CreateTopicAction
          } as any
        ],
        conditions: [],
        calls: []
      }
    },
    dialogs: {},
    variables: {},
    instances: {}
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all quests initially (All view)', () => {
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={mockOnSelectQuest}
      />
    );

    expect(screen.getByText('Test Quest 1')).toBeInTheDocument();
    expect(screen.getByText('Test Quest 2')).toBeInTheDocument();
    expect(screen.getByText('Unused Quest')).toBeInTheDocument();
    expect(screen.queryByText('123')).not.toBeInTheDocument(); // OTHER_CONST should not be shown
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
    await user.type(searchInput, 'Test Quest 1');

    expect(screen.getByText('Test Quest 1')).toBeInTheDocument();
    expect(screen.queryByText('Test Quest 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Unused Quest')).not.toBeInTheDocument();
  });

  it('filters quests by "Used" view mode', async () => {
    const user = userEvent.setup();
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={mockOnSelectQuest}
      />
    );

    // Switch to Used view
    const usedButton = screen.getByRole('button', { name: /^Used$/i });
    await user.click(usedButton);

    expect(screen.getByText('Test Quest 1')).toBeInTheDocument();
    expect(screen.getByText('Test Quest 2')).toBeInTheDocument();
    expect(screen.queryByText('Unused Quest')).not.toBeInTheDocument();
  });

  it('calls onSelectQuest when a quest is clicked', async () => {
    const user = userEvent.setup();
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={mockOnSelectQuest}
      />
    );

    await user.click(screen.getByText('Test Quest 1'));
    expect(mockOnSelectQuest).toHaveBeenCalledWith('TOPIC_Test1');
  });

  it('opens create quest dialog', async () => {
    const user = userEvent.setup();
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={mockOnSelectQuest}
      />
    );

    const addButton = screen.getByRole('button', { name: /Create New Quest/i }); // Assuming tooltip text is accessible or I can find by icon
    // Wait, tooltip adds title attribute, often accessible via aria-label or title.
    // The button has <AddIcon /> inside.
    // The previous code had `Tooltip title="Create New Quest"`.
    // The `IconButton` inside `Tooltip` gets `aria-label` from title if not provided?
    // Let's try `screen.getByRole('button', { name: /Create New Quest/i })` first.
    // If not, I'll inspect.

    await user.click(addButton);
    expect(screen.getByTestId('create-quest-dialog')).toBeInTheDocument();
  });
});
