
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuestList from '../src/renderer/components/QuestList';
import { SemanticModel } from '../src/renderer/types/global';

// Mock useNavigation
jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: jest.fn(),
  }),
}));

// Mock react-virtualized-auto-sizer
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 500 }),
}));

describe('QuestList', () => {
  it('renders a list of quests', () => {
    const semanticModel = {
      constants: {
        TOPIC_Quest1: { name: 'TOPIC_Quest1', value: '"Quest 1"', type: 'string' },
        TOPIC_Quest2: { name: 'TOPIC_Quest2', value: '"Quest 2"', type: 'string' },
      },
      variables: {},
      functions: {},
      instances: {},
      classes: {},
    } as unknown as SemanticModel;

    render(<QuestList semanticModel={semanticModel} selectedQuest={null} onSelectQuest={jest.fn()} />);

    expect(screen.getByText('Quest 1')).toBeInTheDocument();
    expect(screen.getByText('Quest 2')).toBeInTheDocument();
  });

  it('renders "No quests found" when empty', () => {
      const semanticModel = {
        constants: {},
        variables: {},
        functions: {},
        instances: {},
        classes: {},
      } as unknown as SemanticModel;

      render(<QuestList semanticModel={semanticModel} selectedQuest={null} onSelectQuest={jest.fn()} />);

      expect(screen.getByText('No quests found')).toBeInTheDocument();
    });
});
