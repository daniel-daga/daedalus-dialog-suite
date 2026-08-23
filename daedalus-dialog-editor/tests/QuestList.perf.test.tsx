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

// Wrap the analysis entry points so we can observe when QuestList re-runs them.
// Behavior is unchanged (the wrappers delegate to the real implementations).
jest.mock('../src/renderer/quest/domain', () => {
  const actual = jest.requireActual('../src/renderer/quest/domain');
  return {
    ...actual,
    analyzeQuests: jest.fn((...args: any[]) => actual.analyzeQuests(...args)),
    getUsedQuestTopics: jest.fn((...args: any[]) => actual.getUsedQuestTopics(...args)),
  };
});

import { analyzeQuests, getUsedQuestTopics } from '../src/renderer/quest/domain';

const analyzeQuestsMock = analyzeQuests as unknown as jest.Mock;
const getUsedQuestTopicsMock = getUsedQuestTopics as unknown as jest.Mock;

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

  describe('analysis memoization', () => {
    beforeEach(() => {
      analyzeQuestsMock.mockClear();
      getUsedQuestTopicsMock.mockClear();
    });

    const renderList = (model: SemanticModel) => {
      const onSelectQuest = jest.fn();
      return render(
        <QuestList semanticModel={model} selectedQuest={null} onSelectQuest={onSelectQuest} />
      );
    };

    test('analyzes all quests in a single batch call on mount', () => {
      const model = generateSemanticModel(25);
      renderList(model);

      expect(analyzeQuestsMock).toHaveBeenCalledTimes(1);
      expect(analyzeQuestsMock.mock.calls[0][1]).toHaveLength(25);
      expect(getUsedQuestTopicsMock).toHaveBeenCalledTimes(1);
    });

    test('does not re-run analysis when only unrelated model categories change identity', () => {
      const model = generateSemanticModel(25);
      const { rerender } = renderList(model);
      analyzeQuestsMock.mockClear();
      getUsedQuestTopicsMock.mockClear();

      // New top-level identity + new dialogs identity, but constants/functions/
      // variables keep their references — the expensive analysis must not re-run.
      const unrelatedChange: SemanticModel = { ...model, dialogs: {} } as SemanticModel;
      rerender(
        <QuestList semanticModel={unrelatedChange} selectedQuest={null} onSelectQuest={jest.fn()} />
      );

      expect(analyzeQuestsMock).not.toHaveBeenCalled();
      expect(getUsedQuestTopicsMock).not.toHaveBeenCalled();
    });

    test('re-runs analysis when functions identity changes', () => {
      const model = generateSemanticModel(25);
      const { rerender } = renderList(model);
      analyzeQuestsMock.mockClear();
      getUsedQuestTopicsMock.mockClear();

      const functionsChanged: SemanticModel = {
        ...model,
        functions: { ...model.functions },
      } as SemanticModel;
      rerender(
        <QuestList semanticModel={functionsChanged} selectedQuest={null} onSelectQuest={jest.fn()} />
      );

      expect(analyzeQuestsMock).toHaveBeenCalledTimes(1);
      expect(getUsedQuestTopicsMock).toHaveBeenCalledTimes(1);
    });
  });
});
