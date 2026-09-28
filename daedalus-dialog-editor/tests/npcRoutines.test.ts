import { describe, it, expect } from '@jest/globals';
import type { ExchangeSite, RoutineSite } from '../src/shared/types';
import { npcRoutines, formatMinute, variantSwitches } from '../src/renderer/npc/npcRoutines';

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
