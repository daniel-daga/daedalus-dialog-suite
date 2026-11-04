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
  getVobProps: jest.fn(() => ({})),
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
import { vobIndex } from './worldFixtures';

const vobIndexCalls = () => (zenkit.vobIndex as unknown as jest.Mock).mock.calls.length;

/** A world whose VOBs are exactly `classes`, one position each. */
const indexOfClasses = (classes: readonly string[]) => vobIndex(
  classes.map((_, vob) => [vob * 100, 0, 0] as [number, number, number]), classes,
);

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

describe('zenkit worker item instances (#424)', () => {
  const instances = () => (run({ id: 'items', op: 'itemInstances' } as never) as {
    result: unknown;
  }).result;

  it('answers nothing, and reads nothing, for a world with no oCItem', () => {
    // The cost has to be zero on the worlds that have none: no prop read, no
    // allocation — the loop finds no row and the answer is empty.
    (zenkit.vobIndex as unknown as jest.Mock).mockReturnValueOnce(
      indexOfClasses(['zCVob', 'zCVobSound', 'oCMobInter']),
    );
    open('C:/Gothic/Data/Worlds/NEWWORLD.ZEN');

    expect(instances()).toEqual({ vobs: [], instances: [] });
    expect(zenkit.getVobProps).not.toHaveBeenCalled();
  });

  it('reads the instance of every oCItem and of nothing else', () => {
    // An item stores no visual in the file — the engine reads it off the
    // instance — so this read is what the renderer resolves the mesh from.
    (zenkit.vobIndex as unknown as jest.Mock).mockReturnValueOnce(
      indexOfClasses(['oCItem', 'zCVob', 'oCItem']),
    );
    (zenkit.getVobProps as unknown as jest.Mock)
      .mockImplementationOnce(() => ({ instance: 'ITPL_BLUEPLANT' }))
      .mockImplementationOnce(() => ({ instance: 'ITSC_FIREBOLT' }));
    open('C:/Gothic/Data/Worlds/NEWWORLD.ZEN');

    expect(instances()).toEqual({
      vobs: [0, 2],
      instances: ['ITPL_BLUEPLANT', 'ITSC_FIREBOLT'],
    });
    expect(zenkit.getVobProps).toHaveBeenCalledTimes(2);
  });
});
