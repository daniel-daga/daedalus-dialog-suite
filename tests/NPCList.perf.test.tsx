import React from 'react';
import { render, screen } from '@testing-library/react';
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

// Mock react-virtualized-auto-sizer to provide dimensions in JSDOM
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({ children }: any) => children({ height: 500, width: 250 }),
}));

describe('NPCList Performance', () => {
    const generateNpcs = (count: number) => {
        const npcs = [];
        const npcMap = new Map<string, string[]>();
        for (let i = 0; i < count; i++) {
            const name = `NPC_${i}`;
            npcs.push(name);
            npcMap.set(name, ['Dialog1', 'Dialog2']);
        }
        return { npcs, npcMap };
    };

    test('renders a large list of NPCs efficiently', () => {
        const { npcs, npcMap } = generateNpcs(1000); // 1000 NPCs
        const onSelectNPC = jest.fn();

        const startTime = performance.now();
        render(
            <NPCList
                npcs={npcs}
                npcMap={npcMap}
                selectedNPC={null}
                onSelectNPC={onSelectNPC}
            />
        );
        const endTime = performance.now();

        console.log(`Render time for 1000 NPCs (Virtualised): ${endTime - startTime}ms`);

        // With virtualization (height 500, itemSize 60), we expect about 500/60 = ~8-9 items rendered.
        // React-window usually renders some overscan items.
        // So we expect number of rendered items to be small (e.g. < 20), not 1000.

        const items = screen.getAllByRole('button');
        // console.log(`Rendered items count: ${items.length}`);

        expect(items.length).toBeLessThan(50); // Should be much less than 1000
        expect(items.length).toBeGreaterThan(0); // Should render something
    });
});
