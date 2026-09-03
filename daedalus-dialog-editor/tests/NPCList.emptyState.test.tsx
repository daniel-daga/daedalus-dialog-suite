/**
 * A zero-NPC project used to render an empty box: the guidance sat behind
 * `npcFilter &&`, so only a filter that matched nothing explained itself
 * (2026-07 review 5.6). An unfiltered empty list now says how NPCs get in —
 * by placing an NPC .d file in the project, which is the only way since the
 * "Add NPC" button went (#141).
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import NPCList from '../src/renderer/components/NPCList';
import { useSearchStore } from '../src/renderer/store/searchStore';

describe('NPCList empty states', () => {
  beforeEach(() => {
    act(() => { useSearchStore.getState().setNpcFilter(''); });
  });

  it('empty project shows the drop guidance', () => {
    render(<NPCList npcs={[]} npcMap={new Map()} selectedNPC={null} onSelectNPC={jest.fn()} />);
    expect(screen.getByText(/\.d file/i)).toBeInTheDocument();
    expect(screen.queryByText(/No NPCs match/)).not.toBeInTheDocument();
  });

  it('a filter that matches nothing still names the filter, not the drop guidance', () => {
    act(() => { useSearchStore.getState().setNpcFilter('zzz'); });
    render(<NPCList npcs={['PC_Hero']} npcMap={new Map()} selectedNPC={null} onSelectNPC={jest.fn()} />);
    expect(screen.getByText('No NPCs match "zzz"')).toBeInTheDocument();
    expect(screen.queryByText(/\.d file/i)).not.toBeInTheDocument();
  });
});
