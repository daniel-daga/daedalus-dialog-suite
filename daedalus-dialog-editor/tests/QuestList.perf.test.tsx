import React from 'react';
import { render, screen } from '@testing-library/react';
import QuestList from '../src/renderer/components/QuestList';
import type { SemanticModel } from '../src/renderer/types/global';

// Mock useNavigation
jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: jest.fn(),
  }),
}));

// Mock react-virtualized-auto-sizer to provide dimensions in JSDOM
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 250 }),
}));

describe('QuestList Performance', () => {
  const generateSemanticModel = (count: number): SemanticModel => {
    const constants: Record<string, any> = {};
    for (let i = 0; i < count; i++) {
      constants[`TOPIC_Quest_${i}`] = {
        name: `TOPIC_Quest_${i}`,
        value: `"Quest Description ${i}"`,
        filePath: 'test.d',
        type: 'const string'
      };
    }
    return {
      constants,
      variables: {},
      functions: {},
      classes: {},
      instances: {},
      dialogs: {}
    } as SemanticModel;
  };

  test('renders a large list of quests efficiently (virtualized)', () => {
    const semanticModel = generateSemanticModel(1000);
    const onSelectQuest = jest.fn();

    render(
      <QuestList
        semanticModel={semanticModel}
        selectedQuest={null}
        onSelectQuest={onSelectQuest}
      />
    );

    // If virtualized (height 500, itemSize ~72), we expect about 7-8 items + overscan.
    // Definitely less than 50.
    // If NOT virtualized, it will be 1000.
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeLessThan(50);
    expect(items.length).toBeGreaterThan(0);
  });
});
