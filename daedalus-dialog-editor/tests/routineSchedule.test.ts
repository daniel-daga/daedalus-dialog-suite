import type { RoutineSite, SpawnSite } from '../src/shared/types';
import {
  coverageOf,
  placementsAt,
  placementWaypointsAt,
  MINUTES_PER_DAY
} from '../src/renderer/routines/routineSchedule';

// Slice 2 of the Daedalus overlay (level-editor.md §16.19): the schedule the
// time slider reads, over the routine index slice 1 built. Pure — the whole
// point is that the day's arithmetic is testable without a viewport.

const at = (hour: number, minute = 0) => hour * 60 + minute;

const entry = (
  routine: string,
  startMinute: number,
  endMinute: number,
  waypoint: string
): RoutineSite => ({
  routine,
  startMinute,
  endMinute,
  waypoint,
  filePath: `/test/${routine}.d`,
  line: 1
});

describe('routine schedule', () => {
  describe('placementsAt', () => {
    it('puts an NPC on the waypoint whose window holds the minute', () => {
      const index = {
        sites: [
          entry('RTN_START_1', at(8), at(22), 'WP_DAY'),
          entry('RTN_START_1', at(22), at(8), 'WP_BED')
        ],
        routinesByNpc: { BAU_900_FARIM: 'RTN_START_1' }
      };

      expect(placementsAt(index, at(12)).map((p) => p.entries.map((e) => e.waypoint))).toEqual([
        ['WP_DAY']
      ]);
      expect(placementsAt(index, at(23)).map((p) => p.entries.map((e) => e.waypoint))).toEqual([
        ['WP_BED']
      ]);
    });

    // A window whose end is at or before its start runs past midnight; the
    // boundary is half-open, so retail's `(06,00,24,00)` + `(24,00,06,00)`
    // pair partitions the day instead of colliding on minute 0.
    it('reads a window that wraps past midnight, half-open at both ends', () => {
      const night = entry('RTN_NIGHT', at(22), at(6), 'WP_BED');
      const index = { sites: [night], routinesByNpc: { NPC: 'RTN_NIGHT' } };

      const covers = (minute: number) => placementsAt(index, minute)[0].entries.length === 1;

      expect(covers(at(22))).toBe(true); // start is inside
      expect(covers(at(23, 59))).toBe(true);
      expect(covers(0)).toBe(true); // across midnight
      expect(covers(at(5, 59))).toBe(true);
      expect(covers(at(6))).toBe(false); // end is outside
      expect(covers(at(12))).toBe(false);
    });

    // `TA_Stand_WP(00,00,00,00,...)` is retail's idiom for a routine with one
    // entry, and it means all day — not an empty window.
    it('treats a zero-length window as the whole day', () => {
      const index = {
        sites: [entry('RTN_ALWAYS', 0, 0, 'WP_POST')],
        routinesByNpc: { NPC: 'RTN_ALWAYS' }
      };

      for (const minute of [0, at(6), at(12), at(23, 59)]) {
        expect(placementsAt(index, minute)[0].entries.map((e) => e.waypoint)).toEqual(['WP_POST']);
      }
    });

    // A hole in the day is a fact about the routine, not an error to hide: the
    // NPC is somewhere the script does not say, so the overlay draws nothing.
    it('returns no entry for a minute the routine does not cover', () => {
      const index = {
        sites: [entry('RTN_GAP', at(8), at(12), 'WP_MORNING')],
        routinesByNpc: { NPC: 'RTN_GAP' }
      };

      expect(placementsAt(index, at(15))).toEqual([
        { instance: 'NPC', routine: 'RTN_GAP', entries: [] }
      ]);
    });

    // Nothing in the format or the engine says which entry wins an overlap, so
    // the resolver reports both rather than inventing a precedence.
    it('returns every entry covering the minute, not a winner', () => {
      const index = {
        sites: [
          entry('RTN_BOTH', at(8), at(14), 'WP_A'),
          entry('RTN_BOTH', at(12), at(18), 'WP_B')
        ],
        routinesByNpc: { NPC: 'RTN_BOTH' }
      };

      expect(placementsAt(index, at(13))[0].entries.map((e) => e.waypoint)).toEqual([
        'WP_A',
        'WP_B'
      ]);
    });

    // The same empty-index-means-nothing-is-known rule the spawn inputs follow:
    // a routine in no parsed file is not a routine with a hole.
    it('yields no entries for an NPC whose routine the index has not read', () => {
      const index = { sites: [], routinesByNpc: { NPC: 'RTN_UNPARSED' } };

      expect(placementsAt(index, at(12))).toEqual([
        { instance: 'NPC', routine: 'RTN_UNPARSED', entries: [] }
      ]);
    });
  });

  describe('coverageOf', () => {
    // The reference pair, from daedalus-parser's own SLD_99003_Farim.d:
    // `(06,00,24,00)` + `(24,00,06,00)` is exactly one day, once.
    it('finds neither gap nor overlap in a day covered exactly once', () => {
      expect(
        coverageOf(
          [
            entry('RTN_FARIM', at(6), 0, 'WP_SIT'),
            entry('RTN_FARIM', 0, at(6), 'WP_SIT')
          ],
          'RTN_FARIM'
        )
      ).toEqual({ routine: 'RTN_FARIM', gaps: [], overlaps: [] });
    });

    it('reports the window a routine leaves uncovered', () => {
      expect(
        coverageOf(
          [
            entry('RTN_HOLE', 0, at(8), 'WP_BED'),
            entry('RTN_HOLE', at(12), 0, 'WP_WORK')
          ],
          'RTN_HOLE'
        ).gaps
      ).toEqual([{ startMinute: at(8), endMinute: at(12) }]);
    });

    // The day is a circle, so a hole either side of midnight is one hole.
    it('reports a gap running past midnight as one window', () => {
      expect(coverageOf([entry('RTN_DAY', at(8), at(22), 'WP')], 'RTN_DAY').gaps).toEqual([
        { startMinute: at(22), endMinute: at(8) }
      ]);
    });

    it('reports the window two entries both cover', () => {
      expect(
        coverageOf(
          [
            entry('RTN_TWICE', 0, at(14), 'WP_A'),
            entry('RTN_TWICE', at(12), 0, 'WP_B')
          ],
          'RTN_TWICE'
        ).overlaps
      ).toEqual([{ startMinute: at(12), endMinute: at(14) }]);
    });

    it('reads only the entries of the routine it was asked for', () => {
      const sites = [
        entry('RTN_A', 0, 0, 'WP_A'),
        entry('RTN_B', at(8), at(9), 'WP_B')
      ];

      expect(coverageOf(sites, 'RTN_A').gaps).toEqual([]);
      expect(coverageOf(sites, 'RTN_B').gaps).toEqual([
        { startMinute: at(9), endMinute: at(8) }
      ]);
    });
  });

  describe('placementWaypointsAt', () => {
    // What the overlay draws once a time is set (§16.19 slice 5's UI half). It
    // is two lists, not one, because the day splits NPCs three ways and only
    // one of the three is a position the script actually states: an NPC whose
    // routine covers the minute is *known*, and an NPC whose routine has a hole
    // there — or who declares no routine at all — is *unknown* and can only be
    // drawn at the static spawn `Wld_InsertNpc` gave him. Merging the two would
    // assert a position the script does not.

    const spawn = (instance: string, spawnPoint: string): SpawnSite => ({
      instance,
      spawnPoint,
      filePath: `/test/Startup.d`,
      functionName: 'STARTUP_NEWWORLD',
      line: 1
    });

    it('puts an NPC whose routine covers the minute on the routine waypoint', () => {
      const index = {
        sites: [entry('RTN_DAY', at(8), at(22), 'WP_MARKET')],
        routinesByNpc: { BAU_900_FARIM: 'RTN_DAY' }
      };

      const at12 = placementWaypointsAt(index, [spawn('BAU_900_FARIM', 'WP_HOME')], at(12));
      expect(at12.known).toEqual(['WP_MARKET']);
      expect(at12.unknown).toEqual([]);
    });

    it('falls back to the static spawn where the routine has a hole', () => {
      // The routine says nothing about 03:00, so the only position anything
      // states for him is where he was inserted — and that is a different fact
      // from "the script puts him here now", which is why it comes back in the
      // other list.
      const index = {
        sites: [entry('RTN_DAY', at(8), at(22), 'WP_MARKET')],
        routinesByNpc: { BAU_900_FARIM: 'RTN_DAY' }
      };

      const at3 = placementWaypointsAt(index, [spawn('BAU_900_FARIM', 'WP_HOME')], at(3));
      expect(at3.known).toEqual([]);
      expect(at3.unknown).toEqual(['WP_HOME']);
    });

    it('treats an NPC with no declared routine as unknown at every minute', () => {
      const index = { sites: [], routinesByNpc: {} };

      expect(placementWaypointsAt(index, [spawn('GRD_200_XARDAS', 'WP_TOWER')], at(12))).toEqual({
        known: [],
        unknown: ['WP_TOWER']
      });
    });

    it('draws both waypoints of an overlap, because the module picks no winner', () => {
      // `placementsAt` refuses a precedence on purpose — nothing in the format
      // or in ZenKit says which entry the engine takes. An NPC in two places is
      // the honest picture of a routine that says so.
      const index = {
        sites: [
          entry('RTN_DAY', at(8), at(14), 'WP_MARKET'),
          entry('RTN_DAY', at(12), at(18), 'WP_FIELD')
        ],
        routinesByNpc: { BAU_900_FARIM: 'RTN_DAY' }
      };

      expect(placementWaypointsAt(index, [], at(13)).known.sort()).toEqual(['WP_FIELD', 'WP_MARKET']);
    });

    it('names a waypoint once however many NPCs stand on it', () => {
      // One marker per point is the overlay's rule (§16.19 slice 4); who they
      // are is the waypoint panel's answer.
      const index = {
        sites: [entry('RTN_DAY', 0, 0, 'WP_MARKET')],
        routinesByNpc: { BAU_900_FARIM: 'RTN_DAY', BAU_901_HAKON: 'RTN_DAY' }
      };

      expect(placementWaypointsAt(index, [], at(9)).known).toEqual(['WP_MARKET']);
    });

    it('keeps a point out of the unknown list when it is already a known one', () => {
      // Both lists are drawn, so a point in both would get two markers in two
      // colours on one spot and the dimmer one would be pure noise. Known wins:
      // the marker says the script places somebody here at this minute, which
      // is the stronger of the two facts.
      const index = {
        sites: [entry('RTN_DAY', at(8), at(22), 'WP_MARKET')],
        routinesByNpc: { BAU_900_FARIM: 'RTN_DAY' }
      };
      const spawns = [spawn('BAU_900_FARIM', 'WP_HOME'), spawn('GRD_200_XARDAS', 'WP_MARKET')];

      const noon = placementWaypointsAt(index, spawns, at(12));
      expect(noon.known).toEqual(['WP_MARKET']);
      expect(noon.unknown).toEqual([]);
    });

    it('draws a routine placement for an NPC no spawn site names', () => {
      // World scoping is the waynet's job, not this one's: the overlay drops a
      // waypoint the world has not got. An NPC inserted by something the index
      // cannot read still has a routine, and dropping him here would hide it.
      const index = {
        sites: [entry('RTN_DAY', 0, 0, 'WP_MARKET')],
        routinesByNpc: { BAU_900_FARIM: 'RTN_DAY' }
      };

      expect(placementWaypointsAt(index, [], at(12)).known).toEqual(['WP_MARKET']);
    });

    it('reports every spawn as unknown when the index is empty', () => {
      // An empty index means nothing is known, never that nothing is legal —
      // so with no project open every marker is drawn, and drawn as unknown.
      const spawns = [spawn('A', 'WP_ONE'), spawn('B', 'WP_TWO')];

      expect(placementWaypointsAt({ sites: [], routinesByNpc: {} }, spawns, at(12))).toEqual({
        known: [],
        unknown: ['WP_ONE', 'WP_TWO']
      });
    });
  });

  it('exports the day length the callers slice on', () => {
    expect(MINUTES_PER_DAY).toBe(24 * 60);
  });
});
