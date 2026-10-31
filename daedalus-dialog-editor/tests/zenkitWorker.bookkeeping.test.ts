/**
 * The zenkit worker adapter's bookkeeping that the renderer can see: the open
 * path follows a Save As, and the VOB index a structural edit re-reads is handed
 * to the renderer rather than read a second time by `refreshIndex`.
 *
 * The adapter is otherwise exercised only in a real Electron run against a real
 * world (tests/e2e-electron), which is where a save that lands in the wrong
 * place is most expensive to find.
 *
 * @jest-environment node
 */

jest.mock('zenkit-node', () => ({
  loadWorld: jest.fn(() => ({})),
  vobIndex: jest.fn(() => ({ count: 1 })),
  openVfs: jest.fn(() => ({})),
  closeVfs: jest.fn(),
  saveWorld: jest.fn(),
  deleteVob: jest.fn(),
  extractWorldMesh: jest.fn(),
}));

// The mesh is the one part of an open this test does not care about, and it is
// the expensive one; `bbox` and `stats` are all `open` reads off it.
jest.mock('zen-world', () => ({
  ...jest.requireActual('zen-world'),
  buildWorldMesh: () => ({
    groups: [],
    bbox: [0, 0, 0, 1, 1, 1],
    stats: { materials: 0, drawGroups: 0, triangles: 0 },
  }),
}));

import * as zenkit from 'zenkit-node';
import { run } from '../src/main/workers/zenkit.worker';

const vobIndexCalls = () => (zenkit.vobIndex as unknown as jest.Mock).mock.calls.length;

const open = (worldPath: string) => {
  run({
    id: 'open',
    op: 'open',
    payload: { worldPath, gameVersion: 'g2', assetSources: [] },
  } as never);
};

const summarise = (op: 'refreshIndex') => {
  const answer = run({ id: op, op } as never) as { result: { worldPath: string } };
  return answer.result;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('zenkit worker bookkeeping', () => {
  it('follows the world to the file a Save As wrote, so refreshIndex names it', () => {
    open('C:/Gothic/Data/Worlds/OLDWORLD.ZEN');
    run({ id: 'save', op: 'save', payload: { targetPath: 'C:/Gothic/Data/Worlds/NEWWORLD.ZEN' } } as never);

    // What the renderer copies into `worldStore.summary`, and so keys the VOB
    // folders sidecar and the `STARTUP_` function name off.
    expect(summarise('refreshIndex').worldPath).toBe('C:/Gothic/Data/Worlds/NEWWORLD.ZEN');
  });

  it('reads the VOB index once for a structural edit, and hands that one out', () => {
    open('C:/Gothic/Data/Worlds/NEWWORLD.ZEN');
    const afterOpen = vobIndexCalls();

    // A structural edit changes the enumeration, so the worker re-reads it.
    run({
      id: 'ops',
      op: 'applyOps',
      payload: { ops: [{ op: 'DeleteVob', vob: 0, path: '0' }] },
    } as never);
    expect(vobIndexCalls()).toBe(afterOpen + 1);

    // The renderer always asks for the index next; that is the call that used
    // to read the world a second time.
    summarise('refreshIndex');
    expect(vobIndexCalls()).toBe(afterOpen + 1);

    // Handed out once — a later ask, with no edit in between, reads again.
    summarise('refreshIndex');
    expect(vobIndexCalls()).toBe(afterOpen + 2);
  });
});
