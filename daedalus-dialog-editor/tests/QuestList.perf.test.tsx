import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuestList from '../src/renderer/components/QuestList';
import { SemanticModel } from '../src/renderer/types/global';

// Mock useNavigation
jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: jest.fn(),
  }),
}));

const mockSemanticModel: SemanticModel = {
  constants: {
    'TOPIC_Quest1': { name: 'TOPIC_Quest1', value: '"Quest 1"', type: 'string', range: { start: 0, end: 0 } },
    'TOPIC_Quest2': { name: 'TOPIC_Quest2', value: '"Quest 2"', type: 'string', range: { start: 0, end: 0 } },
  },
  functions: {
    'Func1': {
      name: 'Func1',
      actions: [
        { type: 'logEntry', topic: 'TOPIC_Quest1', text: 'Log' } as any
      ],
      range: { start: 0, end: 0 }
    }
  },
  dialogs: {},
  variables: {},
  classes: {},
  instances: {}
};

describe('QuestList', () => {
  it('renders all quests in default view', () => {
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={jest.fn()}
      />
    );

    expect(screen.getByText('Quest 1')).toBeInTheDocument();
    expect(screen.getByText('Quest 2')).toBeInTheDocument();
  });

  it('filters quests when "Used" view is selected', () => {
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={jest.fn()}
      />
    );

    // Initial state: both present
    expect(screen.getByText('Quest 1')).toBeInTheDocument();
    expect(screen.getByText('Quest 2')).toBeInTheDocument();

    // Switch to Used view
    const usedButton = screen.getByText('Used');
    fireEvent.click(usedButton);

    // Quest 1 is used in Func1, Quest 2 is unused
    expect(screen.getByText('Quest 1')).toBeInTheDocument();
    expect(screen.queryByText('Quest 2')).not.toBeInTheDocument();
  });

  it('switches back to All view correctly', () => {
    render(
      <QuestList
        semanticModel={mockSemanticModel}
        selectedQuest={null}
        onSelectQuest={jest.fn()}
      />
    );

    // Switch to Used view
    fireEvent.click(screen.getByText('Used'));
    expect(screen.queryByText('Quest 2')).not.toBeInTheDocument();

    // Switch back to All view
    fireEvent.click(screen.getByText('All'));
    expect(screen.getByText('Quest 2')).toBeInTheDocument();
  });
});
