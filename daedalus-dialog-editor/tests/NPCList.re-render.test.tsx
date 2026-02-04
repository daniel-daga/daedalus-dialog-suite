import React, { useState, useCallback } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import NPCList from '../src/renderer/components/NPCList';
import '@testing-library/jest-dom';

// Mock useSearchStore
jest.mock('../src/renderer/store/searchStore', () => {
    let filter = '';
    return {
        useSearchStore: jest.fn(() => ({
            npcFilter: filter,
            setNpcFilter: (f: string) => { filter = f; },
            filterNpcs: (npcs: string[]) => npcs.filter(n => n.toLowerCase().includes(filter.toLowerCase())),
        })),
    };
});

// Mock react-virtualized-auto-sizer
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 250 }),
}));

// Spy on FixedSizeList
const fixedSizeListRenderSpy = jest.fn();

jest.mock('react-window', () => ({
  FixedSizeList: (props: any) => {
    fixedSizeListRenderSpy(props);
    return <div data-testid="fixed-size-list">{props.children({ index: 0, style: {}, data: props.itemData })}</div>;
  },
}));

describe('NPCList Re-render', () => {
    beforeEach(() => {
        fixedSizeListRenderSpy.mockClear();
    });

    test('does NOT re-render when parent updates if memoized and props are stable', async () => {
        const Wrapper = () => {
            const [count, setCount] = useState(0);
            const npcs = React.useMemo(() => ['NPC_1', 'NPC_2'], []);
            const npcMap = React.useMemo(() => new Map([['NPC_1', ['Dialog1']]]), []);
            const onSelectNPC = useCallback((npc: string) => {}, []); // Stable reference

            return (
                <div>
                    <button onClick={() => setCount(c => c + 1)}>Increment</button>
                    <NPCList
                        npcs={npcs}
                        npcMap={npcMap}
                        selectedNPC={null}
                        onSelectNPC={onSelectNPC}
                    />
                </div>
            );
        };

        render(<Wrapper />);

        // Initial render
        expect(fixedSizeListRenderSpy).toHaveBeenCalledTimes(1);

        // Trigger update
        const button = screen.getByText('Increment');
        await act(async () => {
            fireEvent.click(button);
        });

        // Should NOT re-render because NPCList is memoized and props are stable
        expect(fixedSizeListRenderSpy).toHaveBeenCalledTimes(1);
    });
});
