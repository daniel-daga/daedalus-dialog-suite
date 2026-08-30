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
  npcJumpReason,
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

describe('npcJumpReason', () => {
  it('is disabled with its reason when the dialog names no NPC', () => {
    expect(npcJumpReason(null, null, world([]))).toBe('This dialog names no NPC');
  });

  it('is disabled with its reason when the index has no spawn point for the NPC', () => {
    expect(npcJumpReason('BAU_900_FARIM', null, world(['WP_MARKET'])))
      .toBe('No spawn point is known for BAU_900_FARIM');
  });

  it('is disabled with its reason when no world is open', () => {
    expect(npcJumpReason('BAU_900_FARIM', 'WP_MARKET', null)).toBe('No world is open');
  });

  it('distinguishes "not in this world" from "no world"', () => {
    expect(npcJumpReason('BAU_900_FARIM', 'WP_MARKET', world(['WP_OTHER'])))
      .toBe('WP_MARKET is not in the open world');
  });

  it('is enabled when the point is in the open world', () => {
    expect(npcJumpReason('BAU_900_FARIM', 'WP_MARKET', world(['WP_MARKET']))).toBeNull();
  });

  it('is enabled for a free point too, same as the action-level jump', () => {
    expect(npcJumpReason('BAU_900_FARIM', 'FP_ROAM_CITY_01', world([], ['FP_ROAM_CITY_01'])))
      .toBeNull();
  });

  describe('naming the expected world', () => {
    // The engine spawns every NPC from a function named after the world file
    // (environment-hazards.md, "A candidate is only a game under the name
    // NEWWORLD.ZEN"), so a spawn site's own function already says which .ZEN
    // to open — a fact this button can hand the person, even though it cannot
    // act on it without a world-directory setting (§16.19 s14's closing note).

    it('names the world to open when none is', () => {
      expect(npcJumpReason('BAU_900_FARIM', 'WP_MARKET', null, 'NEWWORLD'))
        .toBe('Open NEWWORLD.ZEN to jump here');
    });

    it('names the world to open when the point is in the wrong one', () => {
      expect(npcJumpReason('BAU_900_FARIM', 'WP_MARKET', world(['WP_OTHER']), 'NEWWORLD'))
        .toBe('WP_MARKET is not in the open world — open NEWWORLD.ZEN');
    });

    it('falls back to the plain reason when no world name is known', () => {
      expect(npcJumpReason('BAU_900_FARIM', 'WP_MARKET', null, null)).toBe('No world is open');
    });

    it('never fires when the jump is already enabled', () => {
      expect(npcJumpReason('BAU_900_FARIM', 'WP_MARKET', world(['WP_MARKET']), 'NEWWORLD'))
        .toBeNull();
    });
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
