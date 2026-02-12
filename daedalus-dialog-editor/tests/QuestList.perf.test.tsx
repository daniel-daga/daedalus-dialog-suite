import React from 'react';
import { render, screen } from '@testing-library/react';
import QuestList from '../src/renderer/components/QuestList';
import '@testing-library/jest-dom';
import { SemanticModel } from '../src/shared/types';

// Mock useNavigation
jest.mock('../src/renderer/hooks/useNavigation', () => ({
  useNavigation: () => ({
    navigateToSymbol: jest.fn(),
  }),
}));

// Mock react-virtualized-auto-sizer to provide dimensions in JSDOM
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 300 }),
}));

describe('QuestList Performance', () => {
    const generateModel = (count: number): SemanticModel => {
        const constants: Record<string, any> = {};
        for (let i = 0; i < count; i++) {
            constants[`TOPIC_Quest_${i}`] = {
                name: `TOPIC_Quest_${i}`,
                value: `"Quest ${i}"`,
                filePath: 'foo.d',
                range: { startLine: i, startColumn: 0, endLine: i, endColumn: 20 },
                parentName: null,
            };
        }
        return {
            constants,
            variables: {},
            functions: {},
            dialogs: {},
            instances: {},
            classes: {},
        } as SemanticModel;
    };

    test('renders a large list of quests efficiently', () => {
        const model = generateModel(1000);
        const onSelectQuest = jest.fn();

        render(
            <QuestList
                semanticModel={model}
                selectedQuest={null}
                onSelectQuest={onSelectQuest}
            />
        );

        // Each row has a ListItemButton (main click) and an IconButton (secondary action)
        // Without virtualization, it renders 1000 rows * 2 buttons = 2000 buttons.
        // With virtualization (height 500, itemSize ~72), we expect roughly 7-10 rows * 2 = 14-20 buttons.

        const items = screen.getAllByRole('button');

        // This check ensures we are not rendering the whole list
        expect(items.length).toBeLessThan(100);
        expect(items.length).toBeGreaterThan(0);
    });
});
