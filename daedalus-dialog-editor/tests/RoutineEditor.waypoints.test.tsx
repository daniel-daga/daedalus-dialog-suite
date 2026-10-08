import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { RoutineEditorPanel } from '../src/renderer/components/RoutineEditor';

/**
 * The routine editor's waypoint fields over a world (#321): they open their
 * list on focus alone, like every other field in the grid, and what opens is
 * a capped page of the waynet rather than all of it. Playwright cannot reach
 * this — the browser harness has no world, so the fields are free text there.
 */

jest.mock('../src/renderer/components/routineSave', () => ({
  loadRoutine: jest.fn(async () => [
    { state: 'TA_Stand_Guarding', startMinute: 8 * 60, endMinute: 20 * 60, waypoint: 'WP_0001', source: { actionIndex: 0 } },
    { state: 'TA_Sleep', startMinute: 20 * 60, endMinute: 8 * 60, waypoint: 'WP_0002', source: { actionIndex: 1 } },
  ]),
  npcIdOf: jest.fn(async () => 900),
  routineFileOf: jest.fn(() => '/p/Rtn.d'),
  routineNameFor: (state: string, id: number) => `Rtn_${state}_${id}`,
  createRoutine: jest.fn(),
  saveRoutine: jest.fn(),
}));

const MANY_WAYPOINTS = Array.from({ length: 3000 }, (_, i) => `WP_${String(i).padStart(4, '0')}`);

afterEach(() => {
  useProjectStore.getState().closeProject();
});

it('an activity row\'s waypoint opens on focus alone, capped', async () => {
  useProjectStore.setState({ routineNpcIndex: { BAU_900_FARIM: 'RTN_START_900' } } as never);
  render(<RoutineEditorPanel npc="BAU_900_FARIM" waypoints={MANY_WAYPOINTS} onDone={() => undefined} />);

  const row = await screen.findByRole('group', { name: 'Activity 1' });
  fireEvent.focus(within(row).getByLabelText('Waypoint'));

  const listbox = await screen.findByRole('listbox');
  expect(within(listbox).getAllByRole('option')).toHaveLength(200);
});

it('the new routine\'s waypoint opens on focus alone, capped', async () => {
  render(<RoutineEditorPanel npc="BAU_900_FARIM" waypoints={MANY_WAYPOINTS} onDone={() => undefined} />);

  const form = await screen.findByRole('group', { name: 'New routine' });
  fireEvent.focus(within(form).getByLabelText('Waypoint'));

  const listbox = await screen.findByRole('listbox');
  expect(within(listbox).getAllByRole('option')).toHaveLength(200);
  fireEvent.change(within(form).getByLabelText('Waypoint'), { target: { value: 'WP_2999' } });
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent))
    .toEqual(['WP_2999']);
});
