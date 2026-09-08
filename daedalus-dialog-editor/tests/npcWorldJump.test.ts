/**
 * The NPC/Dialog side of the world jump (§16.23 W4's other half).
 * `InsertNpcActionRenderer` already jumps from a script's own spawn-point
 * literal; this resolves an NPC *instance* to that same point through the
 * project index, so the jump also works from a dialog that names no spawn
 * point of its own.
 */

import {
  resolveNpcSpawnPoint,
  resolveNpcSpawnSite,
  expectedWorldNameFor,
  worldToOpenFor,
  npcJumpPlan,
} from '../src/renderer/components/npcWorldJump';
import type { SpawnSite } from '../src/shared/types';
import type { WorldWaynetView } from '../src/renderer/problems/domain/types';

const site = (instance: string, spawnPoint: string): SpawnSite => ({
  instance,
  spawnPoint,
  filePath: '/test/Startup.d',
  functionName: 'STARTUP_NEWWORLD',
  line: 1,
});

const world = (names: string[], freePointNames: string[] = []): WorldWaynetView => ({
  pointNameKeys: new Set(names),
  freePointNames,
});

describe('resolveNpcSpawnPoint', () => {
  it('finds the spawn point the project index knows for the instance', () => {
    const sites = [site('BAU_900_FARIM', 'WP_MARKET')];
    expect(resolveNpcSpawnPoint(sites, 'BAU_900_FARIM')).toBe('WP_MARKET');
  });

  it('matches case-insensitively, both ways', () => {
    const sites = [site('BAU_900_FARIM', 'WP_MARKET')];
    expect(resolveNpcSpawnPoint(sites, 'bau_900_farim')).toBe('WP_MARKET');
  });

  it('returns null for an NPC the index has never seen spawned', () => {
    expect(resolveNpcSpawnPoint([], 'BAU_900_FARIM')).toBeNull();
  });

  it('takes the first site when an NPC is spawned more than once', () => {
    const sites = [site('BAU_900_FARIM', 'WP_ONE'), site('BAU_900_FARIM', 'WP_TWO')];
    expect(resolveNpcSpawnPoint(sites, 'BAU_900_FARIM')).toBe('WP_ONE');
  });
});

describe('npcJumpPlan', () => {
  it('is disabled with its reason when the dialog names no NPC', () => {
    expect(npcJumpPlan(null, null, world([])))
      .toEqual({ kind: 'disabled', reason: 'This dialog names no NPC' });
  });

  it('is disabled with its reason when the index has no spawn point for the NPC', () => {
    expect(npcJumpPlan('BAU_900_FARIM', null, world(['WP_MARKET'])))
      .toEqual({ kind: 'disabled', reason: 'No spawn point is known for BAU_900_FARIM' });
  });

  it('is disabled with its reason when no world is open and none can be named', () => {
    expect(npcJumpPlan('BAU_900_FARIM', 'WP_MARKET', null))
      .toEqual({ kind: 'disabled', reason: 'No world is open' });
  });

  it('distinguishes "not in this world" from "no world"', () => {
    expect(npcJumpPlan('BAU_900_FARIM', 'WP_MARKET', world(['WP_OTHER'])))
      .toEqual({ kind: 'disabled', reason: 'WP_MARKET is not in the open world' });
  });

  it('jumps when the point is in the open world', () => {
    expect(npcJumpPlan('BAU_900_FARIM', 'WP_MARKET', world(['WP_MARKET'])))
      .toEqual({ kind: 'jump' });
  });

  it('jumps for a free point too, same as the action-level jump', () => {
    expect(npcJumpPlan('BAU_900_FARIM', 'FP_ROAM_CITY_01', world([], ['FP_ROAM_CITY_01'])))
      .toEqual({ kind: 'jump' });
  });

  describe('opening the world the NPC lives in (#226)', () => {
    // The engine spawns every NPC from a function named after the world file
    // (environment-hazards.md, "A candidate is only a game under the name
    // NEWWORLD.ZEN"), so a spawn site's own function says which .ZEN to open —
    // and the project's asset sources say where that file is (§16.31). Between
    // them the jump opens the world rather than naming it in a tooltip.

    it('offers the open when no world is open', () => {
      expect(npcJumpPlan('BAU_900_FARIM', 'WP_MARKET', null, 'NEWWORLD'))
        .toEqual({ kind: 'open', world: 'NEWWORLD' });
    });

    it('offers the open when the point is in another world', () => {
      expect(npcJumpPlan('BAU_900_FARIM', 'WP_MARKET', world(['WP_OTHER']), 'NEWWORLD'))
        .toEqual({ kind: 'open', world: 'NEWWORLD' });
    });

    it('stays disabled when no world name could be read off the spawn site', () => {
      expect(npcJumpPlan('BAU_900_FARIM', 'WP_MARKET', null, null))
        .toEqual({ kind: 'disabled', reason: 'No world is open' });
    });

    it('never opens a world when the point is already in the open one', () => {
      // Re-opening the world under the camera would throw away 31 MB of
      // geometry to land where the plain jump lands.
      expect(npcJumpPlan('BAU_900_FARIM', 'WP_MARKET', world(['WP_MARKET']), 'NEWWORLD'))
        .toEqual({ kind: 'jump' });
    });
  });
});

describe('worldToOpenFor', () => {
  it('names the world when none is open', () => {
    expect(worldToOpenFor('NEWWORLD', null)).toBe('NEWWORLD');
  });

  it('names nothing when the world holding the NPC is the open one', () => {
    // The point is missing from a world that *is* NEWWORLD.ZEN — re-opening it
    // would find it missing again, so the reason stands rather than a button.
    expect(worldToOpenFor('NEWWORLD', 'C:/Gothic/_work/Data/Worlds/NewWorld.zen')).toBeNull();
  });

  it('names the world when another one is open', () => {
    expect(worldToOpenFor('NEWWORLD', 'C:/Gothic/_work/Data/Worlds/OldWorld.zen')).toBe('NEWWORLD');
  });

  it('compares the file name on either path separator', () => {
    expect(worldToOpenFor('NEWWORLD', 'C:\\Gothic\\Worlds\\NEWWORLD.ZEN')).toBeNull();
  });

  it('names nothing when the spawn site named no world', () => {
    expect(worldToOpenFor(null, null)).toBeNull();
  });
});

describe('resolveNpcSpawnSite', () => {
  it('carries the site a spawn point alone drops, for naming the world it is in', () => {
    const sites = [site('BAU_900_FARIM', 'WP_MARKET')];
    expect(resolveNpcSpawnSite(sites, 'BAU_900_FARIM')).toEqual(sites[0]);
  });

  it('returns null for an NPC the index has never seen spawned', () => {
    expect(resolveNpcSpawnSite([], 'BAU_900_FARIM')).toBeNull();
  });
});

describe('expectedWorldNameFor', () => {
  it('reads the world file name off a STARTUP_ function', () => {
    expect(expectedWorldNameFor('STARTUP_NEWWORLD')).toBe('NEWWORLD');
  });

  it('reads it off an INIT_ function too — the engine convention names both', () => {
    expect(expectedWorldNameFor('INIT_DRAGONISLAND')).toBe('DRAGONISLAND');
  });

  it('matches case-insensitively, and answers uppercased', () => {
    expect(expectedWorldNameFor('startup_newworld')).toBe('NEWWORLD');
  });

  it('answers null for a function that is not named by the convention', () => {
    // A script may wrap Wld_InsertNpc in a helper of its own; guessing a world
    // name from an arbitrary function would be a claim this index cannot back.
    expect(expectedWorldNameFor('B_InsertFarmerNPCs')).toBeNull();
  });
});
