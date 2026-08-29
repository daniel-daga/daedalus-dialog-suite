/**
 * W4: a script's spawn point goes to the world (level-editor.md §16.23).
 *
 * `Wld_InsertNpc` is the corpus's largest cluster of literal waypoint names
 * (§16.8 W5: 3,722 sites), and its renderer is the one place the editor already
 * shows a script-side waypoint name. The control is a jump, not a Monaco
 * feature: it leaves a `WorldFocus` in `worldStore` the way the Problems panel
 * does (§16.20 slice 2) and switches to the World view.
 *
 * The three-answer problem §16.8 named is why the disabled reasons are
 * asserted: "found here" and "not in *this* world" are different answers, and
 * "nowhere at all" stays reserved — the editor holds one world.
 */

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import InsertNpcActionRenderer from '../src/renderer/components/actionRenderers/InsertNpcActionRenderer';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';

const baseProps = {
  path: [0],
  index: 0,
  totalActions: 1,
  npcName: 'TestNPC',
  handleUpdate: jest.fn(),
  handleDelete: jest.fn(),
  flushUpdate: jest.fn(),
  handleKeyDown: jest.fn(),
  mainFieldRef: { current: null }
};

const action = (spawnPoint: string) => ({
  type: 'InsertNpcAction' as const,
  npcInstance: 'PC_Thief',
  spawnPoint
});

/** A world open with the names below in its waynet. */
const openWorldWith = (names: string[]): void => {
  act(() => {
    useWorldStore.setState({
      status: 'ready',
      waynetNames: { pointNameKeys: new Set(names), freePointNames: [] }
    });
  });
};

const jumpButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /show spawn point in world/i }) as HTMLButtonElement;

/** The reason a disabled button gives: its tooltip hangs off the span MUI wraps it in. */
const hoverReason = async (): Promise<string> => {
  fireEvent.mouseOver(jumpButton().parentElement as HTMLElement);
  return (await screen.findByRole('tooltip')).textContent ?? '';
};

describe('the spawn point jumps to the world', () => {
  beforeEach(() => {
    act(() => {
      useWorldStore.getState().reset();
      useUISelectionStore.getState().resetUISelection();
      useUISelectionStore.getState().setActiveView('dialog');
    });
  });

  it('requests the focus and switches to the World view when the point is in the open world', () => {
    openWorldWith(['NW_CITY_ENTRANCE_01']);
    render(<InsertNpcActionRenderer {...baseProps} action={action('nw_city_entrance_01')} />);

    fireEvent.click(jumpButton());

    // The world's own spelling is not the script's — Daedalus is case
    // insensitive, and the surface uppercases both halves of its lookup.
    expect(useWorldStore.getState().focusRequest)
      .toEqual({ kind: 'waypoint', name: 'nw_city_entrance_01' });
    expect(useUISelectionStore.getState().activeView).toBe('world');
  });

  it('is disabled with its reason when no world is open', async () => {
    render(<InsertNpcActionRenderer {...baseProps} action={action('NW_CITY_ENTRANCE_01')} />);

    expect(jumpButton()).toBeDisabled();
    expect(await hoverReason()).toBe('No world is open');
  });

  it('distinguishes "not in this world" from "no world", and does not claim the point is missing', async () => {
    openWorldWith(['OW_PATH_01']);
    render(<InsertNpcActionRenderer {...baseProps} action={action('NW_CITY_ENTRANCE_01')} />);

    expect(jumpButton()).toBeDisabled();
    expect(await hoverReason()).toBe('NW_CITY_ENTRANCE_01 is not in the open world');
  });

  it('is disabled when the action names no spawn point at all', () => {
    openWorldWith(['NW_CITY_ENTRANCE_01']);
    render(<InsertNpcActionRenderer {...baseProps} action={action('')} />);

    expect(jumpButton()).toBeDisabled();
  });

  it('does not request a focus when it is disabled', () => {
    render(<InsertNpcActionRenderer {...baseProps} action={action('NW_CITY_ENTRANCE_01')} />);

    fireEvent.click(jumpButton());

    expect(useWorldStore.getState().focusRequest).toBeNull();
    expect(useUISelectionStore.getState().activeView).toBe('dialog');
  });
});
