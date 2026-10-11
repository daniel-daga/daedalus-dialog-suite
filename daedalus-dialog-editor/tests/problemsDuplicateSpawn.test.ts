/**
 * `duplicate-spawn`: the cross-validation §8 calls "duplicate NPC IDs", over
 * slice 1's spawn index (level-editor.md §16.19 slice 2).
 *
 * The rule's one non-obvious choice is measured, not assumed: over retail
 * Gothic II's 3,722 literal `Wld_InsertNpc` sites, 103 instances are spawned at
 * more than one distinct point, and almost all of them are monster templates —
 * `Draconian` at 186 points, `Wolf` at 49 — which is the normal shape, not a
 * finding. Restricted to instances the project index holds a dialog for, the
 * same corpus yields **4** (Cavalorn, Gaan, Martin, Cord), each a story
 * relocation worth seeing. So the rule fires only for NPCs with dialog.
 */

import { duplicateSpawnRule } from '../src/renderer/problems/domain/rules/duplicateSpawn';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SpawnSite } from '../src/shared/types';
import type { Problem } from '../src/renderer/problems/domain/types';

/** The file a script problem names; `undefined` for a world locus. */
const filePathOf = (problem: Problem): string | undefined =>
  (problem.locus.kind === 'script' ? problem.locus.filePath : undefined);


const spawn = (
  instance: string,
  spawnPoint: string,
  filePath = 'Startup.d',
  functionName = 'STARTUP_NEWWORLD',
  line = 1
): SpawnSite => ({ instance, spawnPoint, filePath, functionName, line });

const viewOf = (spawnSites: SpawnSite[], npcsWithDialogs: string[] = []) =>
  buildProjectView({ files: [], knownNpcNames: [], spawnSites, npcsWithDialogs });

describe('duplicateSpawnRule', () => {
  it('flags an NPC with dialog spawned at two different points', () => {
    const view = viewOf(
      [
        spawn('BAU_961_GAAN', 'NW_FARM1_01', 'Startup.d', 'STARTUP_NEWWORLD', 12),
        spawn('BAU_961_GAAN', 'NW_CITY_44', 'DIA_Gaan.d', 'DIA_Gaan_Move_Info', 88)
      ],
      ['BAU_961_GAAN']
    );

    const problems = duplicateSpawnRule(view);
    expect(problems).toHaveLength(2);
    expect(problems.map(filePathOf)).toEqual(['Startup.d', 'DIA_Gaan.d']);
    expect(problems[0]).toMatchObject({
      rule: 'duplicate-spawn',
      severity: 'warning',
      locus: { kind: 'script', filePath: 'Startup.d', functionName: 'STARTUP_NEWWORLD' }
    });
    expect(problems[0].message).toContain('BAU_961_GAAN');
    expect(problems[0].message).toContain('NW_FARM1_01');
    expect(problems[0].message).toContain('NW_CITY_44');
    expect(new Set(problems.map((problem) => problem.id)).size).toBe(2);
  });

  it('is silent for a monster template spawned all over the world', () => {
    // `Wolf` at 49 distinct points is the normal Gothic shape. No dialog names
    // it, so the project does not know it as a character and the rule says
    // nothing about it.
    const view = viewOf(
      [spawn('WOLF', 'OW_PATH_01'), spawn('WOLF', 'OW_PATH_02'), spawn('WOLF', 'OW_PATH_03')],
      ['BAU_961_GAAN']
    );
    expect(duplicateSpawnRule(view)).toEqual([]);
  });

  it('says nothing at all when no dialog NPCs are known', () => {
    // An empty index means nothing is known, never that nothing is legal —
    // the same rule the world input follows (§16.8).
    const view = viewOf([spawn('BAU_961_GAAN', 'A'), spawn('BAU_961_GAAN', 'B')]);
    expect(duplicateSpawnRule(view)).toEqual([]);
  });

  it('does not flag an NPC spawned repeatedly at one point', () => {
    // Same point twice is a different defect (two copies stacked) and 598 of
    // retail's site pairs look like it deliberately; this rule is about an NPC
    // being in two *places*.
    const view = viewOf(
      [
        spawn('BAU_961_GAAN', 'NW_FARM1_01', 'a.d', 'F_A'),
        spawn('BAU_961_GAAN', 'NW_FARM1_01', 'b.d', 'F_B')
      ],
      ['BAU_961_GAAN']
    );
    expect(duplicateSpawnRule(view)).toEqual([]);
  });

  it('emits one problem for a function spawning the same NPC at the same point twice', () => {
    // Two sites, one id — `ProblemsList` keys on the id, as with the waypoint rule.
    const view = viewOf(
      [
        spawn('BAU_961_GAAN', 'NW_FARM1_01', 'a.d', 'F_A', 3),
        spawn('BAU_961_GAAN', 'NW_FARM1_01', 'a.d', 'F_A', 9),
        spawn('BAU_961_GAAN', 'NW_CITY_44', 'a.d', 'F_A', 12)
      ],
      ['BAU_961_GAAN']
    );

    const problems = duplicateSpawnRule(view);
    expect(problems).toHaveLength(2);
    expect(problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('NW_FARM1_01'),
      expect.stringContaining('NW_CITY_44')
    ]);
  });

  it('matches the dialog-NPC names case-insensitively', () => {
    const view = viewOf(
      [spawn('BAU_961_GAAN', 'A'), spawn('BAU_961_GAAN', 'B')],
      ['Bau_961_Gaan']
    );
    expect(duplicateSpawnRule(view)).toHaveLength(2);
  });

  it('is silent on a project with no spawn sites', () => {
    expect(duplicateSpawnRule(viewOf([], ['BAU_961_GAAN']))).toEqual([]);
  });
});

describe('the Problems scan over the spawn index', () => {
  beforeEach(() => {
    useProblemsStore.getState().clear();
    useProjectStore.setState({
      parsedFiles: new Map(),
      npcList: [],
      npcPrototypes: [],
      allDialogFiles: [],
      waypointSiteIndex: {},
      spawnSiteIndex: [],
      dialogIndex: new Map()
    });
  });

  it('reads both inputs off the project index, not off the parsed files', () => {
    // Both indexes ride `buildProjectIndex`'s worker-pool pass and so see every
    // file; `parsedFiles` is capped and depends on what has been opened.
    useProjectStore.setState({
      spawnSiteIndex: [
        spawn('BAU_961_GAAN', 'NW_FARM1_01', 'Startup.d', 'STARTUP_NEWWORLD', 12),
        spawn('BAU_961_GAAN', 'NW_CITY_44', 'DIA_Gaan.d', 'DIA_Gaan_Move', 88),
        spawn('WOLF', 'OW_PATH_01'),
        spawn('WOLF', 'OW_PATH_02')
      ],
      dialogIndex: new Map([
        ['Bau_961_Gaan', [{ name: 'DIA_Gaan_Hi' } as never]],
        // Every C_NPC instance is a key in `dialogsByNpc`, with an empty array
        // when it has no dialog — so key presence is not the discriminator.
        ['Wolf', []]
      ])
    });

    useProblemsStore.getState().runScan();

    const found = useProblemsStore.getState().problems.filter((p) => p.rule === 'duplicate-spawn');
    expect(found).toHaveLength(2);
    expect(found.map(filePathOf).sort()).toEqual(['DIA_Gaan.d', 'Startup.d']);
  });
});
