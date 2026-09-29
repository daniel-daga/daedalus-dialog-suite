import { describe, it, expect } from '@jest/globals';
import type { ExchangeSite, RoutineSite } from '../src/shared/types';
import {
  npcRoutines, formatMinute, variantSwitches, routineOwner, routinePreview,
} from '../src/renderer/npc/npcRoutines';

const site = (routine: string, startMinute: number, endMinute: number, waypoint: string): RoutineSite =>
  ({ routine, startMinute, endMinute, waypoint, filePath: '/p/Rtn.d', line: 1 });

const sites = [
  site('RTN_START_900', 20 * 60, 8 * 60, 'NW_BIGFARM_HOUSE_ONAR_SLEEP'),
  site('RTN_START_900', 8 * 60, 20 * 60, 'NW_BIGFARM_HOUSE_ONAR'),
  site('RTN_TOT_900', 8 * 60, 8 * 60, 'TOT'),
  site('RTN_START_800', 0, 0, 'NW_LEE'),
];

describe('npcRoutines', () => {
  it('lists the declared routine first, then each state variant, each entry by start time', () => {
    const routines = npcRoutines({
      sites,
      routinesByNpc: { BAU_900_ONAR: 'RTN_START_900' },
      statesByNpc: { BAU_900_ONAR: { id: 900, states: { START: 'RTN_START_900', TOT: 'RTN_TOT_900' } } },
    }, 'BAU_900_Onar');

    expect(routines.map((r) => [r.label, r.routine])).toEqual([
      ['Daily', 'RTN_START_900'],
      ['TOT', 'RTN_TOT_900'],
    ]);
    expect(routines[0].entries.map((e) => e.waypoint)).toEqual(['NW_BIGFARM_HOUSE_ONAR', 'NW_BIGFARM_HOUSE_ONAR_SLEEP']);
  });

  it('is empty for an NPC the index has no routine for', () => {
    expect(npcRoutines({ sites, routinesByNpc: {} }, 'Nobody')).toEqual([]);
  });

  it('keeps a declared routine whose entries the index does not hold, with no entries', () => {
    expect(npcRoutines({ sites: [], routinesByNpc: { A: 'RTN_START_1' } }, 'a'))
      .toEqual([{ label: 'Daily', routine: 'RTN_START_1', entries: [] }]);
  });

  it('formats minutes as the clock the script writes', () => {
    expect(formatMinute(0)).toBe('00:00');
    expect(formatMinute(8 * 60 + 5)).toBe('08:05');
  });
});

describe('variantSwitches', () => {
  // A routine changes with the chapter only because a script switches to a
  // variant (architecture §8, "States are events, not chapters"): the chapter
  // a variant belongs to is read off where it is switched to — a function
  // named for the chapter, or a state named for it — never guessed.
  const exchange = (target: string, state: string, functionName: string): ExchangeSite =>
    ({ target, state, functionName, filePath: '/p/Story.d', line: 7 });

  it('lists the calls that switch this NPC to the state, with the chapter their names carry', () => {
    const switches = variantSwitches([
      exchange('BAU_900_ONAR', 'SHIP', 'B_ENTER_NEWWORLD_KAPITEL_3'),
      exchange('SELF', 'SHIP', 'DIA_ONAR_SHIP_INFO'),
      exchange('BAU_900_ONAR', 'KAPITEL4', 'B_KAPITELWECHSEL'),
      exchange('BAU_901_OTHER', 'SHIP', 'B_ENTER_NEWWORLD_KAPITEL_2'),
    ], 'BAU_900_Onar', 'SHIP');

    expect(switches.map(({ functionName, chapter, maybeOtherNpc }) => ({ functionName, chapter, maybeOtherNpc }))).toEqual([
      { functionName: 'B_ENTER_NEWWORLD_KAPITEL_3', chapter: 3, maybeOtherNpc: false },
      // `self` is whoever the dialog is with; the index cannot say it is this NPC.
      { functionName: 'DIA_ONAR_SHIP_INFO', chapter: null, maybeOtherNpc: true },
    ]);
  });

  it('reads the chapter from a state named for it', () => {
    expect(variantSwitches([exchange('BAU_900_ONAR', 'KAPITEL4', 'B_KAPITELWECHSEL')], 'BAU_900_ONAR', 'Kapitel4')[0].chapter)
      .toBe(4);
  });
});

// The World surface's waypoint panel (npc-editor.md §6, 2026-09-29): a routine
// stop names its routine, the panel needs the NPC who runs it, and a click on
// it draws that routine the way the editor would.
describe('routineOwner', () => {
  const index = {
    sites,
    routinesByNpc: { BAU_900_ONAR: 'RTN_START_900' },
    statesByNpc: { BAU_900_ONAR: { id: 900, states: { START: 'RTN_START_900', TOT: 'RTN_TOT_900' } } },
  };

  it('names the NPC whose daily routine or state variant it is, whatever the casing', () => {
    expect(routineOwner(index, 'Rtn_Start_900')).toBe('BAU_900_ONAR');
    expect(routineOwner(index, 'RTN_TOT_900')).toBe('BAU_900_ONAR');
  });

  it('is null for a routine no NPC runs', () => {
    expect(routineOwner(index, 'RTN_START_800')).toBeNull();
  });
});

describe('routinePreview', () => {
  it('is the routine\'s stops in script order, which is the order the editor colours them in', () => {
    const lines = [
      { ...site('RTN_START_900', 20 * 60, 8 * 60, 'SLEEP'), stateName: 'TA_SLEEP', line: 4 },
      { ...site('RTN_START_900', 8 * 60, 20 * 60, 'WORK'), stateName: 'TA_SMITH', line: 3 },
      site('RTN_START_800', 0, 0, 'NW_LEE'),
    ];
    expect(routinePreview(lines, 'rtn_start_900')).toEqual([
      { state: 'TA_SMITH', startMinute: 8 * 60, endMinute: 20 * 60, waypoint: 'WORK' },
      { state: 'TA_SLEEP', startMinute: 20 * 60, endMinute: 8 * 60, waypoint: 'SLEEP' },
    ]);
  });
});
