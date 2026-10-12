/**
 * `routine-mob-missing`: a routine runs a state that sits down at a mob — a bed,
 * a bench, an anvil — at a waypoint with no such mob anywhere near (#318,
 * npc-editor.md §6 slice 7).
 *
 * **Why a hint and never a warning.** Without its mob the state stands at the
 * waypoint (`ZS_Sit_Bench_Loop` guards `AI_UseMob` with `Wld_IsMobAvailable`),
 * so a miss is cosmetic. And retail does it on purpose: of its 1,537 such
 * entries, 1,451 have the mob within 5 m, but 80 are beyond 20 m — 37 of them
 * parking an NPC at `TOT`, most of the rest dead NPCs posed with a sleep or
 * bench state. A 20 m radius therefore flags no near-miss, and skipping `TOT`
 * removes the largest deliberate group. Maintainer, 2026-10-12: build it as a
 * hint.
 *
 * @jest-environment jsdom
 */

import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import {
  mobSchemeOf,
  routineMobMissingRule,
  type RoutinePlacesView,
} from '../src/renderer/problems/domain/rules/routineMobMissing';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { RoutineSite } from '../src/shared/types';
import type { WaynetPayload, WorldSummary } from '../src/shared/worldTypes';

const site = (stateName: string, waypoint: string, line = 10): RoutineSite => ({
  routine: 'RTN_START_GUNNAR', stateName, startMinute: 22 * 60, endMinute: 8 * 60,
  waypoint, filePath: 'Story/NPC/BAU_902_Gunnar.d', line,
});

const places = (
  waypoints: Record<string, [number, number, number]>,
  mobs: Array<[string, [number, number, number]]>,
): RoutinePlacesView => ({
  waypoints: new Map(Object.entries(waypoints)),
  mobs: mobs.map(([scheme, position]) => ({ scheme, position })),
});

const scan = (routineSites: readonly RoutineSite[], routinePlaces?: RoutinePlacesView) =>
  routineMobMissingRule(buildProjectView({ files: [], knownNpcNames: [], routineSites, routinePlaces }));

describe('routineMobMissingRule', () => {
  const FARM = places(
    { NW_FARM_BED: [0, 0, 0], NW_FARM_FIELD: [5000, 0, 0], TOT: [90000, 0, 0] },
    [['BEDHIGH', [150, 0, 0]], ['BENCH', [5100, 0, 0]]],
  );

  it('says nothing while no world is open', () => {
    // No world is nothing known, never nothing legal.
    expect(scan([site('TA_SLEEP', 'NW_FIELD')], undefined)).toEqual([]);
  });

  it('says nothing when the state has its mob within 20 m', () => {
    expect(scan([site('TA_SLEEP', 'NW_FARM_BED')], FARM)).toEqual([]);
  });

  it('hints at a state whose mob is further than 20 m, naming the state, the mob and the waypoint', () => {
    const problems = scan([site('TA_SLEEP', 'NW_FARM_FIELD', 12)], FARM);
    expect(problems).toEqual([{
      id: 'routine-mob-missing:Story/NPC/BAU_902_Gunnar.d:12',
      rule: 'routine-mob-missing',
      severity: 'hint',
      message: 'TA_SLEEP at "NW_FARM_FIELD" has no BEDHIGH within 20 m in the open world, '
        + 'so the NPC will stand there instead.',
      locus: { kind: 'script', filePath: 'Story/NPC/BAU_902_Gunnar.d', functionName: 'RTN_START_GUNNAR', line: 12 },
    }]);
  });

  it('measures in three dimensions, so a bed on the floor above is not near', () => {
    const upstairs = places({ NW_FARM_BED: [0, 0, 0] }, [['BEDHIGH', [0, 2500, 0]]]);
    expect(scan([site('TA_SLEEP', 'NW_FARM_BED')], upstairs)).toHaveLength(1);
  });

  it('hints when the world has no mob of the scheme at all', () => {
    expect(scan([site('TA_SMITH_ANVIL', 'NW_FARM_BED')], FARM)).toHaveLength(1);
  });

  it('skips TOT, where retail parks NPCs that are out of play', () => {
    expect(scan([site('TA_SLEEP', 'TOT')], FARM)).toEqual([]);
  });

  it('leaves states that use no mob, and waypoints the world lacks, to other rules', () => {
    // A missing waypoint is `waypoint-not-in-world`'s finding, not this one.
    expect(scan([site('TA_STAND_GUARDING', 'NW_FARM_FIELD'), site('TA_SLEEP', 'NW_NOWHERE')], FARM)).toEqual([]);
  });
});

describe('mobSchemeOf', () => {
  it('is the visual name up to the first underscore, the way the engine matches a mob', () => {
    expect(mobSchemeOf('BedHigh_1_OC.asc')).toBe('BEDHIGH');
    expect(mobSchemeOf('BENCH.ASC')).toBe('BENCH');
  });
});

describe('the scan reads the routine places from the open world', () => {
  const waynet = (names: string[], positions: number[]): WaynetPayload => ({
    count: names.length,
    names,
    positions: Float32Array.from(positions).buffer,
    directions: new Float32Array(names.length * 3).buffer,
    waterDepths: new Int32Array(names.length).buffer,
    flags: new Uint32Array(names.length).buffer,
    edgeCount: 0,
    edges: new Uint32Array(0).buffer,
    danglingEdges: 0,
  });

  /** VOBs as `[class, visual, x]`, on one axis. */
  const summaryOf = (vobs: Array<[string, string, number]>): WorldSummary => {
    const classes = [...new Set(vobs.map(([cls]) => cls))];
    const visuals = [...new Set(vobs.map(([, visual]) => visual))];
    return {
      worldPath: 'C:/Gothic/NewWorld.zen',
      bbox: [0, 0, 0, 1, 1, 1],
      vobIndex: {
        count: vobs.length,
        parent: Int32Array.from(vobs.map(() => -1)).buffer,
        childIndex: new Uint32Array(vobs.length).buffer,
        positions: Float32Array.from(vobs.flatMap(([, , x]) => [x, 0, 0])).buffer,
        rotations: new Float32Array(vobs.length * 9).buffer,
        flags: new Uint32Array(vobs.length).buffer,
        classes,
        classIndex: Uint32Array.from(vobs.map(([cls]) => classes.indexOf(cls))).buffer,
        names: [''],
        nameIndex: new Uint32Array(vobs.length).buffer,
        visuals,
        visualIndex: Uint32Array.from(vobs.map(([, visual]) => visuals.indexOf(visual))).buffer,
        visualTypes: [],
        visualTypeIndex: new Uint32Array(vobs.length).buffer,
        decalVobs: new ArrayBuffer(0), decalDimensions: new ArrayBuffer(0), decalAlphaWeights: new ArrayBuffer(0), decalAlphaFuncs: new ArrayBuffer(0),
      },
      stats: { vobCount: vobs.length, materials: 0, worldDrawGroups: 0, worldTriangles: 0 },
      timings: {},
      assetSources: [],
    };
  };

  beforeEach(() => {
    useWorldStore.getState().reset();
    useProjectStore.setState({
      parsedFiles: new Map(),
      npcList: [],
      npcPrototypes: [],
      allDialogFiles: [],
      routineSiteIndex: [site('TA_SLEEP', 'NW_FARM_BED'), site('TA_SIT_BENCH', 'NW_FARM_BED', 11)],
    });
  });

  const hints = () => useProblemsStore.getState().problems.filter((p) => p.rule === 'routine-mob-missing');

  it('finds the bed beside the waypoint and the bench that is not there', () => {
    // A bed 1 m off, and a "bench" that is a plain zCVob — a mob is an
    // oCMob* class, not a visual name.
    useWorldStore.getState().openSucceeded(summaryOf([
      ['oCMobInter', 'BEDHIGH_1_OC.ASC', 100],
      ['zCVob', 'BENCH_1_OC.ASC', 100],
    ]));
    useWorldStore.getState().waynetLoaded(waynet(['NW_FARM_BED'], [0, 0, 0]));
    useProblemsStore.getState().runScan();

    expect(hints().map((p) => p.message)).toEqual([
      'TA_SIT_BENCH at "NW_FARM_BED" has no BENCH within 20 m in the open world, so the NPC will stand there instead.',
    ]);
  });

  it('sees a mob moved in the open world at the next scan', () => {
    useWorldStore.getState().openSucceeded(summaryOf([
      ['oCMobInter', 'BEDHIGH_1_OC.ASC', 100],
      ['oCMobInter', 'BENCH_1_OC.ASC', 100],
    ]));
    useWorldStore.getState().waynetLoaded(waynet(['NW_FARM_BED'], [0, 0, 0]));
    useProblemsStore.getState().runScan();
    expect(hints()).toEqual([]);

    // An edit writes straight into the columns the summary holds.
    new Float32Array(useWorldStore.getState().summary!.vobIndex.positions)[3] = 9000;
    useProblemsStore.getState().runScan();
    expect(hints()).toHaveLength(1);
  });

  it('says nothing when the world closes', () => {
    useWorldStore.getState().openSucceeded(summaryOf([]));
    useWorldStore.getState().waynetLoaded(waynet(['NW_FARM_BED'], [0, 0, 0]));
    useWorldStore.getState().reset();
    useProblemsStore.getState().runScan();
    expect(hints()).toEqual([]);
  });
});
