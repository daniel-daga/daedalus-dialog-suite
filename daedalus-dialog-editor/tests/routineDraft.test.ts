import {
  moveBoundary, removeEntry, setState, setWaypoint, splitEntry,
} from '../src/renderer/routines/routineDraft';
import type { RoutineEntry } from '../src/renderer/routines/routineEntries';

// The edits routine mode makes to a draft (npc-editor.md §6). The day is
// edited as a partition: moving a boundary moves the neighbour's edge with it,
// so no edit opens a gap or an overlap unless the author detaches the edge.

const h = (hour: number, minute = 0) => hour * 60 + minute;
const entry = (state: string, start: number, end: number, waypoint: string, actionIndex?: number): RoutineEntry => ({
  state, startMinute: start, endMinute: end, waypoint,
  ...(actionIndex === undefined ? {} : { source: { actionIndex } }),
});

const onar = () => [
  entry('TA_Sit_Throne', h(7), h(22), 'THRONE', 0),
  entry('TA_Sleep', h(22), h(7), 'BED', 2),
];

const windows = (entries: RoutineEntry[]) => entries.map((e) => [e.startMinute, e.endMinute]);

describe('moveBoundary', () => {
  it('moves the neighbouring edge with it', () => {
    expect(windows(moveBoundary(onar(), 0, 'end', h(21, 30)))).toEqual([[h(7), h(21, 30)], [h(21, 30), h(7)]]);
  });

  it('follows the neighbour across midnight', () => {
    expect(windows(moveBoundary(onar(), 1, 'end', h(6)))).toEqual([[h(6), h(22)], [h(22), h(6)]]);
  });

  it('moves only its own edge when detached, leaving the gap it opens', () => {
    expect(windows(moveBoundary(onar(), 0, 'end', h(21), { detach: true }))).toEqual([[h(7), h(21)], [h(22), h(7)]]);
  });

  it('clamps a minute short of collapsing either window, since an empty window means the whole day', () => {
    const day = () => [
      entry('A', h(8), h(12), 'X', 0),
      entry('B', h(12), h(20), 'Y', 1),
      entry('C', h(20), h(8), 'Z', 2),
    ];
    // Past B's end, nearer it than A's start: B keeps one minute.
    expect(windows(moveBoundary(day(), 0, 'end', h(21)))).toEqual([[h(8), h(19, 59)], [h(19, 59), h(20)], [h(20), h(8)]]);
    // Before A's start, nearer it: A keeps one minute.
    expect(windows(moveBoundary(day(), 0, 'end', h(7)))).toEqual([[h(8), h(8, 1)], [h(8, 1), h(20)], [h(20), h(8)]]);
    expect(windows(moveBoundary(day(), 0, 'end', h(8)))).toEqual([[h(8), h(8, 1)], [h(8, 1), h(20)], [h(20), h(8)]]);
    // A start edge moves its predecessor's end the same way.
    expect(windows(moveBoundary(day(), 1, 'start', h(10)))).toEqual([[h(8), h(10)], [h(10), h(20)], [h(20), h(8)]]);
  });

  it('moves a detached start edge alone, a minute short of its own end at most', () => {
    const day = () => [entry('A', h(8), h(12), 'X', 0), entry('B', h(12), h(20), 'Y', 1)];
    expect(windows(moveBoundary(day(), 1, 'start', h(13), { detach: true }))).toEqual([[h(8), h(12)], [h(13), h(20)]]);
    expect(windows(moveBoundary(day(), 1, 'start', h(20), { detach: true }))).toEqual([[h(8), h(12)], [h(19, 59), h(20)]]);
  });

  it('does not touch an entry that only happens to share the minute elsewhere', () => {
    const entries = [
      entry('A', h(8), h(12), 'X', 0),
      entry('B', h(12), h(20), 'Y', 1),
      entry('C', h(20), h(8), 'Z', 2),
    ];
    expect(windows(moveBoundary(entries, 0, 'end', h(13)))).toEqual([[h(8), h(13)], [h(13), h(20)], [h(20), h(8)]]);
  });
});

describe('splitEntry', () => {
  it('adds a stop at a minute inside the window, the new half a copy with no source', () => {
    const split = splitEntry(onar(), 0, h(13, 30));

    expect(windows(split)).toEqual([[h(7), h(13, 30)], [h(13, 30), h(22)], [h(22), h(7)]]);
    expect(split[1]).toEqual({ state: 'TA_Sit_Throne', startMinute: h(13, 30), endMinute: h(22), waypoint: 'THRONE' });
    expect(split[0].source).toEqual({ actionIndex: 0 });
  });

  it('splits across midnight', () => {
    expect(windows(splitEntry(onar(), 1, h(2)))).toEqual([[h(7), h(22)], [h(22), h(2)], [h(2), h(7)]]);
  });

  it('splits a whole-day entry', () => {
    expect(windows(splitEntry([entry('A', 0, 0, 'X', 0)], 0, h(8)))).toEqual([[0, h(8)], [h(8), 0]]);
  });

  it('refuses a minute on or outside the window', () => {
    expect(splitEntry(onar(), 0, h(7))).toEqual(onar());
    expect(splitEntry(onar(), 0, h(23))).toEqual(onar());
  });
});

describe('removeEntry', () => {
  it('gives the removed window to the entry before it', () => {
    const entries = splitEntry(onar(), 0, h(13, 30));
    expect(windows(removeEntry(entries, 1))).toEqual([[h(7), h(22)], [h(22), h(7)]]);
  });

  it('gives it to the entry after it when nothing ends where it starts', () => {
    const entries = [entry('A', h(8), h(12), 'X', 0), entry('B', h(12), h(20), 'Y', 1)];
    expect(windows(removeEntry(entries, 0))).toEqual([[h(8), h(20)]]);
  });

  it('leaves the last entry holding the whole day', () => {
    expect(windows(removeEntry(onar(), 1))).toEqual([[h(7), h(7)]]);
  });
});

describe('setState / setWaypoint', () => {
  it('changes one entry and nothing else', () => {
    const changed = setWaypoint(setState(onar(), 1, 'TA_Stand_Guarding'), 1, 'GATE');
    expect(changed[1]).toEqual(entry('TA_Stand_Guarding', h(22), h(7), 'GATE', 2));
    expect(changed[0]).toEqual(onar()[0]);
  });
});
