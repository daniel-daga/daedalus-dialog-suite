import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NpcRoutinesSection } from '../src/renderer/components/NpcRoutinesSection';

const entry = (startMinute: number, endMinute: number, waypoint: string, extra: { stateName?: string; line?: number } = {}) =>
  ({ routine: 'RTN_START_900', startMinute, endMinute, waypoint, filePath: '/p/Rtn.d', line: extra.line ?? 3, stateName: extra.stateName });

const daily = (entries = [entry(8 * 60, 20 * 60, 'NW_BIGFARM_HOUSE_ONAR')]) =>
  ({ label: 'Daily', routine: 'RTN_START_900', entries });

describe('NpcRoutinesSection', () => {
  it('shows each routine as a card of activities under named columns', () => {
    render(<NpcRoutinesSection routines={[
      daily([entry(8 * 60, 20 * 60, 'NW_BIGFARM_HOUSE_ONAR', { stateName: 'TA_STAND_ARMSCROSSED' })]),
      { label: 'TOT', routine: 'RTN_TOT_900', entries: [] },
    ]} />);

    const card = screen.getByRole('group', { name: 'Routine RTN_START_900' });
    expect(within(card).getByText('Time')).toBeInTheDocument();
    expect(within(card).getByText('Activity')).toBeInTheDocument();
    expect(within(card).getByText('Waypoint')).toBeInTheDocument();
    const activities = within(card).getByRole('list', { name: 'Activities of RTN_START_900' });
    expect(within(activities).getByText('08:00–20:00')).toBeInTheDocument();
    expect(within(activities).getByText('NW_BIGFARM_HOUSE_ONAR')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Routine RTN_TOT_900' })).toHaveTextContent('No activities indexed');
  });

  // The index holds the TA name uppercased; the wrapper's spelling splits it.
  it('names an activity in words, keeping the TA_ name as its tooltip', () => {
    render(<NpcRoutinesSection
      routines={[daily([entry(8 * 60, 20 * 60, 'NW_X', { stateName: 'TA_STAND_ARMSCROSSED' })])]}
      activityName={(state) => (state === 'TA_STAND_ARMSCROSSED' ? 'TA_Stand_ArmsCrossed' : state)}
    />);
    const activity = screen.getByText('Stand arms crossed');
    expect(activity).toHaveAttribute('title', 'TA_Stand_ArmsCrossed');
  });

  it('draws the day as a bar, with a gap no activity covers in red', () => {
    render(<NpcRoutinesSection routines={[daily([entry(8 * 60, 20 * 60, 'NW_X')])]} />);
    const card = screen.getByRole('group', { name: 'Routine RTN_START_900' });
    expect(within(card).getByTestId('npc-routine-day')).toBeInTheDocument();
    // It wraps midnight, so it is drawn at both ends of the bar.
    expect(within(card).getAllByTitle('Gap 20:00–08:00')).toHaveLength(2);
  });

  it('marks the start routine and offers the others as start', () => {
    const onSetStart = jest.fn();
    render(<NpcRoutinesSection
      routines={[daily(), { label: 'TOT', routine: 'RTN_TOT_900', entries: [] }]}
      startRoutine="Rtn_Start_900"
      onSetStart={onSetStart}
    />);

    const start = screen.getByRole('group', { name: 'Routine RTN_START_900' });
    expect(within(start).getByText('Start routine')).toBeInTheDocument();
    expect(within(start).queryByRole('button', { name: /as start routine/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set RTN_TOT_900 as start routine' }));
    expect(onSetStart).toHaveBeenCalledWith('RTN_TOT_900');
  });

  // The fallback field only where no card can carry the start routine.
  it('shows the start field only when no listed routine is the start routine', () => {
    const field = <input aria-label="Start routine field" />;
    const { rerender } = render(<NpcRoutinesSection routines={[daily()]} startRoutine="RTN_START_900" startField={field} />);
    expect(screen.queryByLabelText('Start routine field')).not.toBeInTheDocument();

    rerender(<NpcRoutinesSection routines={[]} startRoutine="" startField={field} />);
    expect(screen.getByLabelText('Start routine field')).toBeInTheDocument();
  });

  // A new routine is one click from the NPC editor, not behind a routine's Edit.
  it('offers a new routine beside the heading once the NPC has one', () => {
    const onCreateRoutine = jest.fn();
    render(<NpcRoutinesSection routines={[daily()]} onCreateRoutine={onCreateRoutine} />);
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    expect(onCreateRoutine).toHaveBeenCalled();
  });

  it('says where a variant is switched to, and when nothing does', () => {
    render(<NpcRoutinesSection
      routines={[daily(), { label: 'KAPITEL3', routine: 'RTN_KAPITEL3_900', entries: [] }, { label: 'TOT', routine: 'RTN_TOT_900', entries: [] }]}
      switchesOf={(state) => (state === 'KAPITEL3'
        ? [{ functionName: 'B_ENTER_NEWWORLD_KAPITEL_3', chapter: 3, maybeOtherNpc: false } as never]
        : [])}
    />);
    const variant = screen.getByRole('group', { name: 'Routine RTN_KAPITEL3_900' });
    expect(variant).toHaveTextContent('Chapter 3');
    expect(variant).toHaveTextContent('Switched to in B_ENTER_NEWWORLD_KAPITEL_3');
    expect(screen.getByRole('group', { name: 'Routine RTN_TOT_900' })).toHaveTextContent('Nothing in the scripts switches to it by name');
    expect(screen.getByRole('group', { name: 'Routine RTN_START_900' })).not.toHaveTextContent('Switched');
  });

  it('says the NPC will not spawn when it has no routine, and offers to create one', () => {
    const onCreateRoutine = jest.fn();
    render(<NpcRoutinesSection routines={[]} onCreateRoutine={onCreateRoutine} />);
    expect(screen.getByText(/No routine in the project index/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    expect(onCreateRoutine).toHaveBeenCalled();
  });

  // #285: an entry's waypoint in the World surface.
  it('jumps to an entry\'s waypoint, and says why not when it cannot', () => {
    const onShowWaypoint = jest.fn();
    render(<NpcRoutinesSection
      routines={[daily([entry(8 * 60, 20 * 60, 'NW_BIGFARM_HOUSE_ONAR'), entry(20 * 60, 8 * 60, 'NW_NOWHERE')])]}
      onShowWaypoint={onShowWaypoint}
      waypointReason={(wp) => (wp === 'NW_NOWHERE' ? 'NW_NOWHERE is not in the open world' : null)}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Show NW_BIGFARM_HOUSE_ONAR in the world' }));
    expect(onShowWaypoint).toHaveBeenCalledWith('NW_BIGFARM_HOUSE_ONAR');
    expect(screen.getByRole('button', { name: 'Show NW_NOWHERE in the world' })).toBeDisabled();
    expect(screen.getByTitle('NW_NOWHERE is not in the open world')).toBeInTheDocument();
  });

  // A reason every waypoint shares is said once, in words, not only on hover.
  it('says a reason every waypoint jump shares once, above the routines', () => {
    render(<NpcRoutinesSection
      routines={[daily([entry(8 * 60, 20 * 60, 'NW_A'), entry(20 * 60, 8 * 60, 'NW_B')])]}
      onShowWaypoint={jest.fn()}
      waypointReason={() => 'No world is open'}
    />);
    expect(screen.getByRole('note')).toHaveTextContent('Waypoint jumps are unavailable: No world is open');
  });

  it('opens a routine in the routine editor, and on the map', () => {
    const onEditRoutine = jest.fn();
    const onEditRoutineInWorld = jest.fn();
    render(<NpcRoutinesSection routines={[daily()]} onEditRoutine={onEditRoutine} onEditRoutineInWorld={onEditRoutineInWorld} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit routine RTN_START_900' }));
    expect(onEditRoutine).toHaveBeenCalledWith('RTN_START_900');
    // npc-editor.md §6: never off for want of a world — the surface opens one.
    fireEvent.click(screen.getByRole('button', { name: 'Edit routine RTN_START_900 in the world' }));
    expect(onEditRoutineInWorld).toHaveBeenCalledWith('RTN_START_900');
  });

  it('opens the source at an activity\'s TA line', () => {
    const onShowSource = jest.fn();
    render(<NpcRoutinesSection routines={[daily()]} onShowSource={onShowSource} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show source for RTN_START_900 at line 3' }));
    expect(onShowSource).toHaveBeenCalledWith('RTN_START_900', '/p/Rtn.d', 3);
  });

  it('holds every jump while the form has unsaved changes, saying so once', () => {
    render(<NpcRoutinesSection
      routines={[daily()]}
      onShowWaypoint={jest.fn()}
      onEditRoutineInWorld={jest.fn()}
      waypointReason={() => null}
      blockedReason="Save or cancel your changes first"
    />);
    expect(screen.getByRole('button', { name: 'Show NW_BIGFARM_HOUSE_ONAR in the world' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit routine RTN_START_900 in the world' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('Map jumps are paused: Save or cancel your changes first');
  });
});
