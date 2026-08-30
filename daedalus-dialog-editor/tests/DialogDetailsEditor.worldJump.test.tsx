/**
 * NPC/Dialog → World (§16.23 W4's other half). `InsertNpcActionRenderer`
 * already jumps from a script's own spawn-point literal (W4 of §16.8); this is
 * the same jump from the NPC/Dialog view, which never shows a spawn point at
 * all — it resolves the dialog's NPC to the project index's spawn site.
 */

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DialogDetailsEditor from '../src/renderer/components/DialogDetailsEditor';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';

const DIALOG_NAME = 'TestDialog';

const semanticModel = (npc: string | undefined) => ({
  dialogs: {
    [DIALOG_NAME]: {
      properties: { npc, information: 'TestInfo', condition: 'TestCondition' },
    },
  },
  functions: {
    TestInfo: { name: 'TestInfo', returnType: 'VOID', actions: [], conditions: [], calls: [] },
    TestCondition: { name: 'TestCondition', returnType: 'INT', actions: [], conditions: [], calls: [] },
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: [],
});

const setSpawnSites = (sites: Array<{ instance: string; spawnPoint: string }>) => {
  act(() => {
    useProjectStore.setState({
      spawnSiteIndex: sites.map((s) => ({
        ...s,
        filePath: '/test/Startup.d',
        functionName: 'STARTUP_NEWWORLD',
        line: 1,
      })),
    } as any);
  });
};

const openWorldWith = (names: string[]): void => {
  act(() => {
    useWorldStore.setState({
      status: 'ready',
      waynetNames: { pointNameKeys: new Set(names), freePointNames: [] },
    } as any);
  });
};

const jumpButton = (): HTMLButtonElement =>
  screen.getByTestId('npc-world-jump') as HTMLButtonElement;

const hoverReason = async (): Promise<string> => {
  fireEvent.mouseOver(jumpButton().parentElement as HTMLElement);
  return (await screen.findByRole('tooltip')).textContent ?? '';
};

describe('the NPC/Dialog view jumps to the world', () => {
  beforeEach(() => {
    act(() => {
      useWorldStore.getState().reset();
      useUISelectionStore.getState().resetUISelection();
      useUISelectionStore.getState().setActiveView('dialog');
    });
    setSpawnSites([]);
  });

  it('requests the focus and switches to the World view when the NPC has a known spawn point in the open world', () => {
    setSpawnSites([{ instance: 'BAU_900_FARIM', spawnPoint: 'WP_MARKET' }]);
    openWorldWith(['WP_MARKET']);
    render(<DialogDetailsEditor dialogName={DIALOG_NAME} filePath={null} semanticModel={semanticModel('BAU_900_FARIM') as any} />);

    fireEvent.click(jumpButton());

    expect(useWorldStore.getState().focusRequest).toEqual({ kind: 'waypoint', name: 'WP_MARKET' });
    expect(useUISelectionStore.getState().activeView).toBe('world');
  });

  it('is disabled with its reason when the dialog names no NPC', async () => {
    render(<DialogDetailsEditor dialogName={DIALOG_NAME} filePath={null} semanticModel={semanticModel(undefined) as any} />);

    expect(jumpButton()).toBeDisabled();
    expect(await hoverReason()).toBe('This dialog names no NPC');
  });

  it('is disabled with its reason when the project index has never seen the NPC spawned', async () => {
    openWorldWith(['WP_MARKET']);
    render(<DialogDetailsEditor dialogName={DIALOG_NAME} filePath={null} semanticModel={semanticModel('BAU_900_FARIM') as any} />);

    expect(jumpButton()).toBeDisabled();
    expect(await hoverReason()).toBe('No spawn point is known for BAU_900_FARIM');
  });

  it('is disabled with its reason when no world is open', async () => {
    setSpawnSites([{ instance: 'BAU_900_FARIM', spawnPoint: 'WP_MARKET' }]);
    render(<DialogDetailsEditor dialogName={DIALOG_NAME} filePath={null} semanticModel={semanticModel('BAU_900_FARIM') as any} />);

    expect(jumpButton()).toBeDisabled();
    expect(await hoverReason()).toBe('No world is open');
  });

  it('distinguishes "not in this world" from "no world"', async () => {
    setSpawnSites([{ instance: 'BAU_900_FARIM', spawnPoint: 'WP_MARKET' }]);
    openWorldWith(['WP_OTHER']);
    render(<DialogDetailsEditor dialogName={DIALOG_NAME} filePath={null} semanticModel={semanticModel('BAU_900_FARIM') as any} />);

    expect(jumpButton()).toBeDisabled();
    expect(await hoverReason()).toBe('WP_MARKET is not in the open world');
  });

  it('does not request a focus when it is disabled', () => {
    render(<DialogDetailsEditor dialogName={DIALOG_NAME} filePath={null} semanticModel={semanticModel('BAU_900_FARIM') as any} />);

    fireEvent.click(jumpButton());

    expect(useWorldStore.getState().focusRequest).toBeNull();
    expect(useUISelectionStore.getState().activeView).toBe('dialog');
  });
});
