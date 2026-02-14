import React from 'react';
import { render, screen } from '@testing-library/react';
import QuestList from './QuestList';
import { SemanticModel } from '../types/global';
import '@testing-library/jest-dom';

// Mock useNavigation
jest.mock('../hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: jest.fn(),
  }),
}));

// Mock AutoSizer to render with fixed dimensions in test
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 600, width: 400 }),
}));

describe('QuestList Performance', () => {
  const createMockSemanticModel = (numQuests: number): SemanticModel => {
    const constants: any = {};
    for (let i = 0; i < numQuests; i++) {
      constants[`TOPIC_Quest${i}`] = {
        name: `TOPIC_Quest${i}`,
        type: 'string',
        value: `"Quest Description ${i}"`,
      };
    }
    return {
      dialogs: {},
      functions: {},
      constants,
      variables: {},
      instances: {},
      hasErrors: false,
      errors: [],
    };
  };

  test('renders large list of quests using virtualization', () => {
    const numQuests = 1000;
    const semanticModel = createMockSemanticModel(numQuests);

    render(
      <QuestList
        semanticModel={semanticModel}
        selectedQuest={null}
        onSelectQuest={jest.fn()}
      />
    );

    const items = screen.getAllByText(/Quest Description/);
    console.log(`Rendered items count with virtualization: ${items.length}`);

    // With virtualization (height 600 / itemSize 72 ~= 8 items + overscan), we expect far fewer than 1000 items.
    // react-window default overscan is usually small (e.g. 1 or 2 items).
    // So we expect around 10-20 items.

    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(numQuests);
    expect(items.length).toBeLessThan(50); // Safe upper bound for small viewport
  });
});
