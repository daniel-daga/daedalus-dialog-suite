/**
 * The NPC/Dialog side of the world jump (§16.23 W4's other half).
 * `InsertNpcActionRenderer` already jumps from a script's own spawn-point
 * literal; this resolves an NPC *instance* to that same point through the
 * project index, so the jump also works from a dialog that names no spawn
 * point of its own.
 */

import { resolveNpcSpawnPoint, npcJumpReason } from '../src/renderer/components/npcWorldJump';
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
});
