import React from 'react';
import { render, screen } from '@testing-library/react';
import QuestList from '../src/renderer/components/QuestList';
import '@testing-library/jest-dom';
import { SemanticModel } from '../src/renderer/types/global';

// Mock useNavigation
jest.mock('../src/renderer/hooks/useNavigation', () => ({
    useNavigation: () => ({
        navigateToSymbol: jest.fn(),
    }),
}));

describe('QuestList Performance', () => {
    const generateSemanticModel = (count: number): SemanticModel => {
        const constants: Record<string, any> = {};
        for (let i = 0; i < count; i++) {
            const name = `TOPIC_Quest${i}`;
            constants[name] = { name, value: `"Quest ${i}"` };
        }
        return {
            constants,
            functions: {},
            dialogs: {},
            globalVariables: {},
            classes: {},
            instances: {},
        } as SemanticModel;
    };

    test('renders a large list of Quests', () => {
        const semanticModel = generateSemanticModel(1000);
        const onSelectQuest = jest.fn();

        const startTime = performance.now();
        render(
            <QuestList
                semanticModel={semanticModel}
                selectedQuest={null}
                onSelectQuest={onSelectQuest}
            />
        );
        const endTime = performance.now();
        console.log(`Render time for 1000 Quests: ${endTime - startTime}ms`);

        // Check for buttons. Note: ListItemButton is a button. SecondaryAction might also contain a button.
        // So we might get 2000 buttons if secondary action is present for all.
        // QuestList renders secondary action for all items.
        const items = screen.getAllByRole('button');
        console.log(`Rendered items count: ${items.length}`);
    });
});
