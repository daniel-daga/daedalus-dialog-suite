import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { WorldOp } from 'zen-world';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { BASE_PROPS, SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';

/**
 * The scatter brush's shell half (level-editor.md §16.25).
 *
 * The brush is three layers, and this is the one that joins them: `zen-world`'s
 * `strokeCandidates` says where to try knowing nothing of the world, the
 * viewport raycasts each try, and `scatterVobs` turns the survivors into one
 * batch. The first and third have their own unit tests in `zen-world`; what
 * only exists here is the joining — that the palette is the selection, that a
 * candidate with no ground under it is dropped rather than refusing the stroke,
 * and that the whole stroke is one batch and therefore one undo entry.
 *
 * The viewport is stubbed exactly as the editing suite stubs it, and for the
 * same reason: it needs a WebGL context and 31 MB of payloads, none of which is
 * what a stroke's *consequences* are about. The stub fires a stroke on demand
 * and answers the raycasts itself.
 */

/** The radius the viewport is told to draw its ring at — null is a brush that
 *  is off, or on with nothing to paint with. */
let mockScatterRadius: number | null | undefined;
/** The stroke the stub fires: four samples along +X, far enough apart to
 *  survive the decimation `strokeCandidates` does at a quarter of the radius. */
const STROKE: Array<[number, number, number]> = [
  [0, 100, 0], [400, 100, 0], [800, 100, 0], [1200, 100, 0],
];
/** A drag across a hillside rather than a dab: long enough that the attempts
 *  outnumber the cap, which is the only way to reach it. */
const LONG_STROKE: Array<[number, number, number]> = Array.from(
  { length: 40 }, (_, i) => [i * 400, 100, 0] as [number, number, number],
);
/** The viewport's downward raycast, which is how a candidate finds its ground.
 *  A `jest.fn` so each test says what the ray hits. */
const mockRaycastDown = jest.fn() as jest.Mock<
  { point: [number, number, number]; normal: [number, number, number] } | null,
  [[number, number, number]]
>;

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

jest.mock('../src/renderer/components/world/WorldViewport', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    __esModule: true,
    default: ReactActual.forwardRef((props: {
      scatterRadius: number | null;
      onScatterStroke: (samples: Array<[number, number, number]>) => void;
    }, ref: React.Ref<{ raycastDown: typeof mockRaycastDown }>) => {
      mockScatterRadius = props.scatterRadius;
      ReactActual.useImperativeHandle(ref, () => ({
        raycastDown: mockRaycastDown,
        frameVob: jest.fn(),
        framePoint: jest.fn(),
        cameraPosition: jest.fn(),
      }));
      return (
        <div data-testid="world-viewport-stub">
          <button
            type="button"
            data-testid="stub-stroke"
            onClick={() => props.onScatterStroke(STROKE)}
          >
            stroke
          </button>
          <button
            type="button"
            data-testid="stub-long-stroke"
            onClick={() => props.onScatterStroke(LONG_STROKE)}
          >
            long stroke
          </button>
        </div>
      );
    }),
  };
});

const api = makeWorldEditorApi();

/** Flat ground at y=0, facing straight up — what most of these want, since the
 *  posing itself is `scatterVobs`' own test. */
const flatGround = (origin: [number, number, number]) => ({
  point: [origin[0], 0, origin[2]] as [number, number, number],
  normal: [0, 1, 0] as [number, number, number],
});

/** The ops of the one batch a stroke committed. */
function committedBatch(): WorldOp[] {
  expect(api.applyWorldOps).toHaveBeenCalledTimes(1);
  return api.applyWorldOps.mock.calls[0][0] as WorldOp[];
}

async function openWorld(parents?: readonly number[], names?: readonly string[]) {
  const summary = {
    ...SUMMARY,
    vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]], undefined, parents, names),
  };
  api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
  api.openWorld.mockResolvedValueOnce(summary as never);
  api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
  api.getWorldVisuals.mockResolvedValueOnce({
    visuals: [], stats: { vobsPlaced: 0 },
  } as never);
  // Every stroke is a structural batch, so every one of them is followed by the
  // renderer re-reading the index whole — persistent rather than one-shot,
  // since a test may paint twice.
  api.refreshWorldIndex.mockResolvedValue(summary as never);
  api.getWorldVisuals.mockResolvedValue({ visuals: [], stats: { vobsPlaced: 0 } } as never);

  render(<WorldSurface />);
  fireEvent.click(screen.getByTestId('world-open'));
  await screen.findByTestId('stub-stroke');
  return summary;
}

/** Select the palette, then press the brush toggle — the order the tool
 *  requires, since the toggle is disabled without a selection. */
async function armBrush(palette: readonly number[] = [1]) {
  await act(async () => { useWorldStore.getState().selectVobs(palette); });
  fireEvent.click(screen.getByTestId('world-scatter-toggle'));
}

const paint = async () => {
  await act(async () => { fireEvent.click(screen.getByTestId('stub-stroke')); });
};

const paintLong = async () => {
  await act(async () => { fireEvent.click(screen.getByTestId('stub-long-stroke')); });
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getVobProps.mockImplementation(async () => ({ class: 'zCVob', ...BASE_PROPS }));
  mockScatterRadius = undefined;
  mockRaycastDown.mockReset();
  mockRaycastDown.mockImplementation(flatGround);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
});

describe('arming the brush', () => {
  it('is off until the toggle is pressed', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });

    expect(mockScatterRadius).toBeNull();
  });

  it('cannot be armed without a palette to paint with', async () => {
    await openWorld();

    expect(screen.getByTestId('world-scatter-toggle')).toBeDisabled();
  });

  it('hands the viewport a radius once it is on', async () => {
    await openWorld();
    await armBrush();

    expect(mockScatterRadius).toBe(800);
  });

  it('goes inert, without switching off, when the selection is cleared', async () => {
    // A brush with a pressed toggle and nothing to place is not a brush that
    // should silently un-press: the palette comes back the moment something is
    // selected again.
    await openWorld();
    await armBrush();
    await act(async () => { useWorldStore.getState().selectVob(null); });

    expect(mockScatterRadius).toBeNull();
    expect(screen.getByTestId('world-scatter-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the radius and spacing only while it is on', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    expect(screen.queryByTestId('world-scatter-radius')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('world-scatter-toggle'));
    expect(screen.getByTestId('world-scatter-radius')).toBeInTheDocument();
    expect(screen.getByTestId('world-scatter-spacing')).toBeInTheDocument();
  });

  it('takes a new radius through to the viewport', async () => {
    await openWorld();
    await armBrush();

    fireEvent.change(screen.getByTestId('world-scatter-radius').querySelector('input')!, {
      target: { value: '1500' },
    });

    expect(mockScatterRadius).toBe(1500);
  });
});

describe('a stroke', () => {
  it('places copies of the palette, in one batch', async () => {
    await openWorld();
    await armBrush();
    await paint();

    const batch = committedBatch();
    expect(batch.length).toBeGreaterThan(1);
    expect(batch.every((op) => op.op === 'AddVob')).toBe(true);
  });

  it('raycasts down from above each candidate, not from the sample height', async () => {
    // Lifted by the radius, so a candidate that fell uphill of the cursor
    // finds the ground above it rather than the inside of the slope.
    await openWorld();
    await armBrush();
    await paint();

    expect(mockRaycastDown).toHaveBeenCalled();
    for (const [origin] of mockRaycastDown.mock.calls) {
      expect(origin[1]).toBe(100 + 800);
    }
  });

  it('places each copy where its own ray hit', async () => {
    await openWorld();
    await armBrush();
    // A ground that slopes with X, so a copy that ignored its own hit and took
    // the sample's height would stand out.
    mockRaycastDown.mockImplementation((origin) => ({
      point: [origin[0], origin[0] / 10, origin[2]],
      normal: [0, 1, 0],
    }));
    await paint();

    for (const op of committedBatch()) {
      const at = (op as { to: { position: [number, number, number] } }).to.position;
      expect(at[1]).toBeCloseTo(at[0] / 10);
    }
  });

  it('drops a candidate with no ground under it rather than refusing the stroke', async () => {
    await openWorld();
    await armBrush();
    // Every other ray misses — a stroke along a ridge, where half the disc is
    // over the sky.
    let ray = 0;
    mockRaycastDown.mockImplementation((origin) => (
      (ray++ % 2 === 0) ? flatGround(origin) : null
    ));
    await paint();

    const batch = committedBatch();
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.length).toBeLessThan(mockRaycastDown.mock.calls.length);
  });

  it('commits nothing when the whole stroke missed', async () => {
    await openWorld();
    await armBrush();
    mockRaycastDown.mockReturnValue(null);
    await paint();

    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('paints with every member of a multi-VOB palette', async () => {
    // Named apart, because a copy carries neither its original position nor
    // anything else that would tell the two members apart in the batch.
    await openWorld(undefined, ['TREE', 'ROCK']);
    await armBrush([0, 1]);
    await paint();

    const painted = new Set(committedBatch().map(
      (op) => (op as { to: { name?: string } }).to.name,
    ));
    expect(painted).toEqual(new Set(['TREE', 'ROCK']));
  });

  it('prunes a palette holding a VOB and its own parent', async () => {
    // VOB 1 is a child of VOB 0 here. A member carries its own subtree, so
    // painting both would place VOB 1 twice per stamp — once beside itself and
    // once inside its parent's copy.
    await openWorld([-1, 0]);
    await armBrush([0, 1]);
    await paint();

    const batch = committedBatch();
    // Each stamp is the parent plus its child: an even count, and every child
    // add addressed under the add before it.
    const roots = batch.filter((op) => (op as { parentPath: string | null }).parentPath === null);
    expect(roots).toHaveLength(batch.length / 2);
  });

  it('paints nothing when the brush is off', async () => {
    // The viewport is what gates this — it fires no stroke with a null radius —
    // but the shell must not act on one either, since a stroke in flight can
    // outlive the toggle.
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    await paint();

    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('caps the stroke and says so', async () => {
    await openWorld();
    await armBrush();
    // A spacing of nothing over a long stroke: every attempt is accepted, so
    // the cap is the only thing that stops it.
    fireEvent.change(screen.getByTestId('world-scatter-spacing').querySelector('input')!, {
      target: { value: '0' },
    });
    await paintLong();

    expect(committedBatch()).toHaveLength(200);
    expect(screen.getByTestId('world-edit-error')).toHaveTextContent('capped at 200');
  });

  it('says nothing about a cap for a stroke that fits', async () => {
    await openWorld();
    await armBrush();
    await paint();

    expect(screen.queryByTestId('world-edit-error')).not.toBeInTheDocument();
  });

  it('thins the stroke as the spacing grows', async () => {
    await openWorld();
    await armBrush();
    await paint();
    const tight = committedBatch().length;

    jest.clearAllMocks();
    mockRaycastDown.mockImplementation(flatGround);
    fireEvent.change(screen.getByTestId('world-scatter-spacing').querySelector('input')!, {
      target: { value: '900' },
    });
    await paint();

    expect(committedBatch().length).toBeLessThan(tight);
  });
});
