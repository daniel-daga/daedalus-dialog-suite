/**
 * #281: a project opened on a folder below its NPC files lists only the NPCs
 * that have a dialog, and nothing said so. The index now reports what it could
 * not see (`npcCoverage`), and the NPC list says it in one line.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import NpcColumn from '../src/renderer/components/NpcColumn';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useSearchStore } from '../src/renderer/store/searchStore';

const renderColumn = (npcs: string[]) => render(
  <NpcColumn
    isProjectMode
    projectNpcs={npcs}
    dialogIndex={new Map()}
    semanticModelDialogs={{}}
    selectedNPC={null}
    onSelectNPC={jest.fn()}
  />
);

describe('NpcColumn coverage note (#281)', () => {
  beforeEach(() => {
    act(() => { useSearchStore.getState().setNpcFilter(''); });
  });

  it('says so when the folder holds dialogs but no NPC files', () => {
    act(() => { useProjectStore.setState({ npcCoverage: { npcInstancesFound: 0, missingPrototypes: [] } }); });
    renderColumn(['BAU_900_Onar']);
    expect(screen.getByText(/No NPC files under the opened folder/)).toBeInTheDocument();
  });

  it('names a prototype the folder does not declare', () => {
    act(() => { useProjectStore.setState({ npcCoverage: { npcInstancesFound: 3, missingPrototypes: ['Npc_Default'] } }); });
    renderColumn(['BAU_900_Onar']);
    expect(screen.getByText(/Npc_Default is not under the opened folder/)).toBeInTheDocument();
  });

  it('says nothing when the folder covers its NPCs', () => {
    act(() => { useProjectStore.setState({ npcCoverage: { npcInstancesFound: 3, missingPrototypes: [] } }); });
    renderColumn(['BAU_900_Onar']);
    expect(screen.queryByText(/opened folder/)).not.toBeInTheDocument();
  });
});
