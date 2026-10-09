/**
 * The World surface's window-level shortcuts, lifted out of `WorldSurface.tsx`
 * (`docs/plans/level-editor-review-2026-09-04.md` §4 — the keyboard effect is
 * one of the nine concerns).
 *
 * `WorldSurface.shortcuts.test.tsx` drives Delete, Ctrl+Z/Y, Escape and the
 * nudge through a mounted surface, one behaviour at a time, and keeps doing so.
 * What the split makes assertable is the rule all eight chords are built on and
 * that no per-branch test ever states as one thing: **which keystrokes this
 * surface claims, and which it hands back to the browser.** These are window
 * listeners in an app full of text fields, so a chord claimed in the viewport
 * and swallowed in a field is the whole class of bug here — and `preventDefault`
 * is the one observable that says which happened.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import {
  useWorldShortcuts,
  type WorldShortcutsInput,
} from '../src/renderer/components/world/hooks/useWorldShortcuts';
import { useWorldStore } from '../src/renderer/store/worldStore';
import type { WaynetPayload } from '../src/shared/worldTypes';

function waynet(): WaynetPayload {
  return {
    names: ['WP_START', 'WP_GATE'],
    positions: new Float32Array([0, 0, 0, 100, 0, 100]).buffer,
    edges: new Uint32Array([]).buffer,
    freePoints: [],
  } as unknown as WaynetPayload;
}

const verbs = {
  setGizmoMode: jest.fn(),
  onCopy: jest.fn(),
  onPaste: jest.fn(),
  onDuplicate: jest.fn(),
  onRequestDeleteVobs: jest.fn(),
  onRequestDeleteWaypoint: jest.fn(),
  onDisarm: jest.fn(),
  onRequestSave: jest.fn(),
  onRequestSaveAs: jest.fn(),
  onNudgeBegin: jest.fn(() => true),
  onNudgeBy: jest.fn(),
  onNudgeEnd: jest.fn(),
  onHistory: jest.fn(),
};

/** The state a shortcut fires in: a world open, on screen, no dialog up. */
function bound(overrides: Partial<WorldShortcutsInput> = {}) {
  return renderHook(() => useWorldShortcuts({
    hasWorld: true,
    hidden: false,
    dialogOpen: false,
    waynet: waynet(),
    armed: false,
    gizmoMode: 'translate',
    snapGrid: 0,
    ...verbs,
    ...overrides,
  } as WorldShortcutsInput));
}

/** Dispatches a keydown and answers whether this surface claimed it.
 *
 *  `preventDefault` is the observable: a claimed key is one the browser will not
 *  also act on, and a key left alone still scrolls the list under it. */
function press(key: string, init: KeyboardEventInit = {}, target?: Element): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { (target ?? window).dispatchEvent(event); });
  return event.defaultPrevented;
}

/** Dispatches a keyup — what ends a nudge. */
function release(key: string): void {
  act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); });
}

/** A focused text field, which is where every one of these chords stops being
 *  this surface's. */
function field(): HTMLInputElement {
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  return input;
}

/** Every chord the surface claims, with the state that makes it fire and the
 *  verb it is supposed to reach. One row per branch of the dispatch. */
const CHORDS: Array<{
  name: string;
  key: string;
  init?: KeyboardEventInit;
  verb: keyof typeof verbs;
}> = [
  { name: 'W (nudge forward, with a selection)', key: 'w', verb: 'onNudgeBy' },
  { name: 'S (nudge back)', key: 's', verb: 'onNudgeBy' },
  { name: 'E (rotate gizmo)', key: 'e', verb: 'setGizmoMode' },
  { name: 'Ctrl+C', key: 'c', init: { ctrlKey: true }, verb: 'onCopy' },
  { name: 'Ctrl+V', key: 'v', init: { ctrlKey: true }, verb: 'onPaste' },
  { name: 'Ctrl+D', key: 'd', init: { ctrlKey: true }, verb: 'onDuplicate' },
  { name: 'Delete', key: 'Delete', verb: 'onRequestDeleteVobs' },
  { name: 'Escape', key: 'Escape', verb: 'onDisarm' },
  { name: 'ArrowRight', key: 'ArrowRight', verb: 'onNudgeBy' },
  { name: 'Ctrl+S', key: 's', init: { ctrlKey: true }, verb: 'onRequestSave' },
  { name: 'Ctrl+Shift+S', key: 'S', init: { ctrlKey: true, shiftKey: true }, verb: 'onRequestSaveAs' },
  { name: 'Ctrl+Z', key: 'z', init: { ctrlKey: true }, verb: 'onHistory' },
  { name: 'Ctrl+Y', key: 'y', init: { ctrlKey: true }, verb: 'onHistory' },
];

beforeEach(() => {
  jest.clearAllMocks();
  // A VOB selected and an add armed, so every row above has something to act on
  // — Escape reaches `onDisarm` only while something is armed, and Delete and
  // the nudge only while something is selected.
  useWorldStore.setState({ selection: [0], selectedWaypoint: null } as never);
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('useWorldShortcuts — what the surface claims', () => {
  test.each(CHORDS)('$name is claimed and reaches its verb', ({ key, init, verb }) => {
    bound({ armed: true });
    expect(press(key, init)).toBe(true);
    expect(verbs[verb]).toHaveBeenCalled();
  });

  test.each(CHORDS)('$name is left to a focused text field', ({ key, init, verb }) => {
    bound({ armed: true });
    const input = field();
    expect(press(key, init, input)).toBe(false);
    expect(verbs[verb]).not.toHaveBeenCalled();
  });

  test.each(CHORDS)('$name is left alone while one of the surface’s dialogs is open', ({ key, init, verb }) => {
    bound({ armed: true, dialogOpen: true });
    expect(press(key, init)).toBe(false);
    expect(verbs[verb]).not.toHaveBeenCalled();
  });
});

describe('useWorldShortcuts — when nothing is bound at all', () => {
  test.each(CHORDS)('$name does nothing with no world open', ({ key, init, verb }) => {
    bound({ armed: true, hasWorld: false });
    expect(press(key, init)).toBe(false);
    expect(verbs[verb]).not.toHaveBeenCalled();
  });

  test.each(CHORDS)('$name does nothing while the surface is hidden', ({ key, init, verb }) => {
    // The surface stays mounted behind whichever view is on screen, so a bound
    // listener would undo a world edit from the dialog view.
    bound({ armed: true, hidden: true });
    expect(press(key, init)).toBe(false);
    expect(verbs[verb]).not.toHaveBeenCalled();
  });

  test('unmounting takes the listener with it', () => {
    const { unmount } = bound();
    unmount();
    expect(press('Delete')).toBe(false);
    expect(verbs.onRequestDeleteVobs).not.toHaveBeenCalled();
  });
});

describe('useWorldShortcuts — a key nobody here wants stays the browser’s', () => {
  test('a bare letter this surface does not bind', () => {
    bound();
    expect(press('q')).toBe(false);
  });

  test('Alt is nobody’s modifier here', () => {
    bound({ armed: true });
    expect(press('w', { altKey: true })).toBe(false);
    expect(press('c', { ctrlKey: true, altKey: true })).toBe(false);
    expect(verbs.setGizmoMode).not.toHaveBeenCalled();
    expect(verbs.onCopy).not.toHaveBeenCalled();
  });

  test('Ctrl+C with nothing selected leaves the clipboard whatever is on it', () => {
    // The surface shows text a user may well be trying to copy — the install
    // path, a VOB name — so an empty selection is not a swallowed keystroke.
    useWorldStore.setState({ selection: [] } as never);
    bound();
    expect(press('c', { ctrlKey: true })).toBe(false);
    expect(verbs.onCopy).not.toHaveBeenCalled();
  });

  test('Ctrl+V with nothing selected is still a paste — into the roots', () => {
    useWorldStore.setState({ selection: [] } as never);
    bound();
    expect(press('v', { ctrlKey: true })).toBe(true);
    expect(verbs.onPaste).toHaveBeenCalled();
  });

  test('Ctrl+D with nothing selected would be an empty batch, so it is the browser’s', () => {
    useWorldStore.setState({ selection: [] } as never);
    bound();
    expect(press('d', { ctrlKey: true })).toBe(false);
    expect(verbs.onDuplicate).not.toHaveBeenCalled();
  });

  test('Escape with nothing armed and nothing selected is nobody’s', () => {
    useWorldStore.setState({ selection: [], selectedWaypoint: null } as never);
    bound();
    expect(press('Escape')).toBe(false);
    expect(verbs.onDisarm).not.toHaveBeenCalled();
  });

  test('an arrow key with nothing selected still scrolls whatever is under it', () => {
    useWorldStore.setState({ selection: [] } as never);
    bound();
    expect(press('ArrowRight')).toBe(false);
    expect(verbs.onNudgeBy).not.toHaveBeenCalled();
  });

  test('an arrow key inside a tree is the tree’s own navigation', () => {
    bound();
    const tree = document.createElement('div');
    tree.setAttribute('role', 'tree');
    const row = document.createElement('div');
    tree.append(row);
    document.body.append(tree);
    expect(press('ArrowRight', {}, row)).toBe(false);
    expect(verbs.onNudgeBy).not.toHaveBeenCalled();
  });
});

describe('useWorldShortcuts — the chords Shift changes the meaning of', () => {
  test('Ctrl+Shift+Z is a redo, though Shift changes the letter to “Z”', () => {
    // The comparison is lower-cased for exactly this: `key` arrives as 'Z'.
    bound();
    expect(press('Z', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(verbs.onHistory).toHaveBeenCalledWith('redo');
  });

  test('Ctrl+Z alone is an undo', () => {
    bound();
    press('z', { ctrlKey: true });
    expect(verbs.onHistory).toHaveBeenCalledWith('undo');
  });

  test('Ctrl+Shift+C is not a copy — the chord is the browser’s', () => {
    bound();
    expect(press('c', { ctrlKey: true, shiftKey: true })).toBe(false);
    expect(verbs.onCopy).not.toHaveBeenCalled();
  });

  test('Cmd stands in for Ctrl throughout', () => {
    bound();
    press('c', { metaKey: true });
    press('z', { metaKey: true });
    expect(verbs.onCopy).toHaveBeenCalled();
    expect(verbs.onHistory).toHaveBeenCalledWith('undo');
  });
});

describe('useWorldShortcuts — Delete picks one of the two confirms', () => {
  test('a selected waypoint takes precedence, and is named from the waynet', () => {
    useWorldStore.setState({ selection: [], selectedWaypoint: 1 } as never);
    bound();
    press('Delete');
    expect(verbs.onRequestDeleteWaypoint).toHaveBeenCalledWith(1, 'WP_GATE');
    expect(verbs.onRequestDeleteVobs).not.toHaveBeenCalled();
  });

  test('a selected waypoint with no waynet drawn falls through to the VOBs', () => {
    useWorldStore.setState({ selection: [3], selectedWaypoint: 1 } as never);
    bound({ waynet: null });
    press('Delete');
    expect(verbs.onRequestDeleteWaypoint).not.toHaveBeenCalled();
    expect(verbs.onRequestDeleteVobs).toHaveBeenCalledWith([3]);
  });

  test('the whole selection goes to one confirm (#253)', () => {
    useWorldStore.setState({ selection: [1, 2, 5], selectedWaypoint: null } as never);
    bound();
    press('Delete');
    expect(verbs.onRequestDeleteVobs).toHaveBeenCalledWith([1, 2, 5]);
  });
});

describe('useWorldShortcuts — the step a nudge key takes', () => {
  test('the 1 cm default with no snap step set', () => {
    bound({ snapGrid: 0 });
    press('ArrowRight');
    expect(verbs.onNudgeBegin).toHaveBeenCalledWith(0);
    expect(verbs.onNudgeBy).toHaveBeenCalledWith([1, 0, 0]);
  });

  test('the snap step when one is set, which the nudge also snaps to', () => {
    bound({ snapGrid: 50 });
    press('ArrowRight');
    expect(verbs.onNudgeBegin).toHaveBeenCalledWith(50);
    expect(verbs.onNudgeBy).toHaveBeenCalledWith([50, 0, 0]);
  });

  test('×10 while Shift is held', () => {
    bound({ snapGrid: 50 });
    press('ArrowRight', { shiftKey: true });
    expect(verbs.onNudgeBy).toHaveBeenCalledWith([500, 0, 0]);
  });

  test('in rotate mode the translate grid is invisible, so the default stands', () => {
    // That control edits the angle in rotate mode, so a `snapGrid` left over
    // from translate mode would be 45° on screen and 5 m under the arrow.
    bound({ gizmoMode: 'rotate', snapGrid: 500 });
    press('ArrowRight');
    expect(verbs.onNudgeBegin).toHaveBeenCalledWith(0);
    expect(verbs.onNudgeBy).toHaveBeenCalledWith([1, 0, 0]);
  });

  test('W and Up move away from the camera, S and Down towards it', () => {
    bound({ snapGrid: 0 });
    for (const key of ['w', 'ArrowUp', 's', 'ArrowDown']) {
      press(key);
      release(key);
    }
    expect(verbs.onNudgeBy.mock.calls.map(([delta]) => delta)).toEqual([
      [0, 0, 1], [0, 0, 1], [0, 0, -1], [0, 0, -1],
    ]);
  });

  test('A/D and the side arrows move along camera-right, PageUp/Down vertically', () => {
    bound({ snapGrid: 0 });
    for (const key of ['a', 'ArrowLeft', 'd', 'ArrowRight', 'PageUp', 'PageDown']) {
      press(key);
      release(key);
    }
    expect(verbs.onNudgeBy.mock.calls.map(([delta]) => delta)).toEqual([
      [-1, 0, 0], [-1, 0, 0], [1, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0],
    ]);
  });

  test('Ctrl+S is still the save, though S is a nudge key', () => {
    bound();
    expect(press('s', { ctrlKey: true })).toBe(true);
    expect(verbs.onRequestSave).toHaveBeenCalled();
    expect(verbs.onNudgeBy).not.toHaveBeenCalled();
  });

  test('nothing to move under the gizmo leaves the key alone', () => {
    verbs.onNudgeBegin.mockReturnValueOnce(false);
    bound();
    expect(press('ArrowRight')).toBe(false);
    expect(verbs.onNudgeBy).not.toHaveBeenCalled();
  });
});

describe('useWorldShortcuts — holding a nudge key', () => {
  /** A hand-driven frame loop, so a hold can be stepped through in time. */
  let frames: Array<FrameRequestCallback> = [];
  let now = 0;

  beforeEach(() => {
    frames = [];
    now = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Advance the clock to `at` ms and run the frame that was waiting. */
  function frameAt(at: number) {
    now = at;
    const pending = frames;
    frames = [];
    act(() => { for (const callback of pending) callback(at); });
  }

  test('a tap is one step, one gesture and one commit', () => {
    bound();
    press('d');
    frameAt(100);
    release('d');
    expect(verbs.onNudgeBegin).toHaveBeenCalledTimes(1);
    expect(verbs.onNudgeBy.mock.calls).toEqual([[[1, 0, 0]]]);
    expect(verbs.onNudgeEnd).toHaveBeenCalledTimes(1);
  });

  test('held past the delay it moves continuously, and commits once on release', () => {
    bound();
    press('w');
    frameAt(200);   // still inside the hold delay
    frameAt(250);   // the delay ends here: nothing travelled yet
    frameAt(350);   // 0.1 s at 300 cm/s
    frameAt(450);
    expect(verbs.onNudgeEnd).not.toHaveBeenCalled();
    release('w');
    const travelled = verbs.onNudgeBy.mock.calls.map(([delta]) => delta[2]);
    expect(travelled[0]).toBe(1);
    expect(travelled.slice(1)).toEqual([expect.closeTo(30, 6), expect.closeTo(30, 6)]);
    expect(verbs.onNudgeBegin).toHaveBeenCalledTimes(1);
    expect(verbs.onNudgeEnd).toHaveBeenCalledTimes(1);
  });

  test('the OS auto-repeat keydowns are swallowed, not extra steps', () => {
    bound();
    press('d');
    expect(press('d', { repeat: true })).toBe(true);
    expect(press('d', { repeat: true })).toBe(true);
    expect(verbs.onNudgeBy).toHaveBeenCalledTimes(1);
  });

  test('two keys held are one gesture, ended by the last one up', () => {
    bound();
    press('w');
    press('d');
    release('w');
    expect(verbs.onNudgeEnd).not.toHaveBeenCalled();
    release('d');
    expect(verbs.onNudgeBegin).toHaveBeenCalledTimes(1);
    expect(verbs.onNudgeEnd).toHaveBeenCalledTimes(1);
  });

  test('losing window focus mid-hold ends the nudge — that keyup never arrives', () => {
    bound();
    press('w');
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(verbs.onNudgeEnd).toHaveBeenCalledTimes(1);
  });

  test('W keeps nudging while held, even if the selection empties mid-hold', () => {
    bound();
    press('w');
    useWorldStore.setState({ selection: [] } as never);
    press('w', { repeat: true });
    expect(verbs.setGizmoMode).not.toHaveBeenCalled();
  });
});

describe('useWorldShortcuts — the gizmo letters', () => {
  test('W is translate and E is rotate, with nothing selected for W to nudge', () => {
    useWorldStore.setState({ selection: [] } as never);
    bound();
    press('w');
    expect(verbs.setGizmoMode).toHaveBeenCalledWith('translate');
    press('e');
    expect(verbs.setGizmoMode).toHaveBeenCalledWith('rotate');
  });

  test('they need no selection — the mode is the tool, not the edit', () => {
    useWorldStore.setState({ selection: [] } as never);
    bound();
    expect(press('w')).toBe(true);
    expect(verbs.setGizmoMode).toHaveBeenCalledWith('translate');
  });
});

describe('useWorldShortcuts — Escape', () => {
  test('an armed add is the more recent intent, and the selection survives it', () => {
    const selectVob = jest.fn();
    useWorldStore.setState({ selection: [0], selectedWaypoint: null, selectVob } as never);
    bound({ armed: true });
    press('Escape');
    expect(verbs.onDisarm).toHaveBeenCalled();
    expect(selectVob).not.toHaveBeenCalled();
  });

  test('with nothing armed it clears the selection', () => {
    const selectVob = jest.fn();
    useWorldStore.setState({ selection: [0], selectedWaypoint: null, selectVob } as never);
    bound();
    press('Escape');
    expect(selectVob).toHaveBeenCalledWith(null);
  });

  test('a selected waypoint is cleared the same way', () => {
    const selectVob = jest.fn();
    useWorldStore.setState({ selection: [], selectedWaypoint: 1, selectVob } as never);
    bound();
    expect(press('Escape')).toBe(true);
    expect(selectVob).toHaveBeenCalledWith(null);
  });
});
