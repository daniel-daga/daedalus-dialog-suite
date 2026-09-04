/**
 * The rotate gizmo's pointer sensitivity (BOARD "Rotating an object is too
 * fast").
 *
 * `TransformControls` turns an object by `20 / <camera distance>` radians per
 * unit of pointer travel across the drag plane, and that constant is a local
 * `const` inside its `pointerMove` — there is no `rotationSpeed` to set, and
 * the `rotationAngle` it computes is defined with `configurable: false`, so it
 * cannot be wrapped on the instance either.
 *
 * What is reachable is the pointer itself: `pointerDown`/`pointerMove` are
 * public, and the angle is linear in the travel since the press. Scaling that
 * travel scales the turn, and it does so *inside* the gizmo — so the ring, the
 * live preview and the committed op all agree, and `__worldViewport.turnGizmo`,
 * which stands in for this maths rather than running it, still means what it
 * says.
 *
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

/** What the base class was handed, so the damping is observed where it lands. */
const mockMoves: Array<unknown> = [];

jest.mock('three/examples/jsm/controls/TransformControls.js', () => ({
  TransformControls: class {
    private mode = 'translate';

    /** Only what the subclass reaches for to chain its plane-handle mirroring
     *  onto the gizmo's layout — that behaviour is covered, against handles
     *  with real geometry, in `gizmoPlaneFacing.test.ts`. */
    private root = { children: [{ isTransformControlsGizmo: true, updateMatrixWorld() {} }] };

    getHelper() { return this.root; }

    getMode() { return this.mode; }

    setMode(mode: string) { this.mode = mode; }

    pointerDown() {}

    pointerMove(pointer: unknown) { mockMoves.push(pointer); }
  },
}));

import {
  DampedTransformControls, dampPointer, ROTATE_DRAG_DAMPING,
} from '../src/renderer/world/DampedTransformControls';

const press = { x: 0.2, y: -0.1, button: 0 } as unknown as PointerEvent;
const moveTo = { x: 0.6, y: 0.3, button: 0 } as unknown as PointerEvent;

/** The subclass' constructor arguments are the base's, and the base above
 *  ignores them. */
const controls = () => new DampedTransformControls(
  undefined as never, undefined as never,
);

describe('dampPointer', () => {
  it('keeps the press point fixed and scales the travel since it', () => {
    expect(dampPointer({ x: 0.2, y: -0.1 }, { x: 0.6, y: 0.3, button: 0 }, 0.25))
      .toEqual({ x: 0.3, y: 0, button: 0 });
  });

  it('is the identity at the press point, whatever the factor', () => {
    expect(dampPointer({ x: 0.2, y: -0.1 }, { x: 0.2, y: -0.1, button: 2 }, 0.25))
      .toEqual({ x: 0.2, y: -0.1, button: 2 });
  });
});

describe('DampedTransformControls', () => {
  beforeEach(() => { mockMoves.length = 0; });

  it('is slower than the gizmo by a quarter while rotating', () => {
    expect(ROTATE_DRAG_DAMPING).toBe(0.25);

    const transform = controls();
    transform.setMode('rotate');
    transform.pointerDown(press);
    transform.pointerMove(moveTo);

    expect(mockMoves).toEqual([{ x: 0.3, y: 0, button: 0 }]);
  });

  it('leaves a translate drag alone — only the turn was too fast', () => {
    const transform = controls();
    transform.setMode('translate');
    transform.pointerDown(press);
    transform.pointerMove(moveTo);

    expect(mockMoves).toEqual([moveTo]);
  });

  it('measures the travel from the press, not from the last move', () => {
    const transform = controls();
    transform.setMode('rotate');
    transform.pointerDown(press);
    transform.pointerMove(moveTo);
    transform.pointerMove({ x: 1, y: -0.1, button: 0 } as unknown as PointerEvent);

    // 0.2 + (1 - 0.2) * 0.25, and not a step measured from `moveTo` — the base
    // recomputes the whole pose from the press on every move, so a damping that
    // accumulated would turn the VOB by a different angle for the same drag
    // depending on how many pointer events the OS delivered.
    expect(mockMoves[1]).toEqual({ x: 0.4, y: -0.1, button: 0 });
  });
});
