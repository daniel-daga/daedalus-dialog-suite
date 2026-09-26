import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NpcRoutinesSection } from '../src/renderer/components/NpcEditorDialog';

const entry = (startMinute: number, endMinute: number, waypoint: string) =>
  ({ routine: 'RTN_START_900', startMinute, endMinute, waypoint, filePath: '/p/Rtn.d', line: 3 });

describe('NpcRoutinesSection', () => {
  it('shows each routine with its entries as time windows and waypoints', () => {
    render(<NpcRoutinesSection routines={[
      { label: 'Daily', routine: 'RTN_START_900', entries: [entry(8 * 60, 20 * 60, 'NW_BIGFARM_HOUSE_ONAR')] },
      { label: 'TOT', routine: 'RTN_TOT_900', entries: [] },
    ]} />);

    const daily = screen.getByRole('list', { name: 'Daily: RTN_START_900' });
    expect(within(daily).getByText('08:00–20:00')).toBeInTheDocument();
    expect(within(daily).getByText('NW_BIGFARM_HOUSE_ONAR')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'TOT: RTN_TOT_900' })).toHaveTextContent('No TA entries indexed');
  });

  it('says so when the index has no routine for the NPC', () => {
    render(<NpcRoutinesSection routines={[]} />);
    expect(screen.getByText(/No routine in the project index/)).toBeInTheDocument();
  });

  // #285: an entry's waypoint in the World surface.
  it('jumps to an entry\'s waypoint, and says why not when it cannot', () => {
    const onShowWaypoint = jest.fn();
    render(<NpcRoutinesSection
      routines={[{ label: 'Daily', routine: 'RTN_START_900', entries: [
        entry(8 * 60, 20 * 60, 'NW_BIGFARM_HOUSE_ONAR'), entry(20 * 60, 8 * 60, 'NW_NOWHERE'),
      ] }]}
      onShowWaypoint={onShowWaypoint}
      waypointReason={(wp) => (wp === 'NW_NOWHERE' ? 'NW_NOWHERE is not in the open world' : null)}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Show NW_BIGFARM_HOUSE_ONAR in the world' }));
    expect(onShowWaypoint).toHaveBeenCalledWith('NW_BIGFARM_HOUSE_ONAR');
    expect(screen.getByRole('button', { name: 'Show NW_NOWHERE in the world' })).toBeDisabled();
    expect(screen.getByTitle('NW_NOWHERE is not in the open world')).toBeInTheDocument();
  });

  it('holds every jump while the form has unsaved changes, saying so', () => {
    render(<NpcRoutinesSection
      routines={[{ label: 'Daily', routine: 'RTN_START_900', entries: [entry(8 * 60, 20 * 60, 'NW_BIGFARM_HOUSE_ONAR')] }]}
      onShowWaypoint={jest.fn()}
      waypointReason={() => null}
      blockedReason="Save or cancel your changes first"
    />);
    expect(screen.getByRole('button', { name: 'Show NW_BIGFARM_HOUSE_ONAR in the world' })).toBeDisabled();
    expect(screen.getByTitle('Save or cancel your changes first')).toBeInTheDocument();
  });
});

