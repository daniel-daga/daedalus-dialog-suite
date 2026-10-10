/**
 * The keyboard-shortcuts sheet (#275) is a hand-written table, and the
 * listeners it describes live in a dozen files. The World surface's idle
 * legend — the table's predecessor — had already drifted when this landed: it
 * never learned Ctrl+D. So the table carries the keystrokes each row stands
 * for, and this suite proves them against the real dispatch in both
 * directions: every World row is still bound, and every chord the World
 * surface claims has a row.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { KEYBOARD_SHORTCUTS, type ShortcutProbe } from '../src/renderer/components/keyboardShortcuts';
import {
  useWorldShortcuts,
  type WorldShortcutsInput,
} from '../src/renderer/components/world/hooks/useWorldShortcuts';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { cameraSlotFor } from '../src/renderer/world/cameraSlots';
import { flyMoveFor } from '../src/renderer/world/flyNav';
import type { WaynetPayload } from '../src/shared/worldTypes';

function probesOf(listener: ShortcutProbe['listener']): KeyboardEventInit[] {
  return KEYBOARD_SHORTCUTS.flatMap((row) =>
    row.probe?.listener === listener ? row.probe.events : []);
}

/** The World surface's dispatch with a world open, a VOB selected and an add
 *  armed — the state in which every one of its branches has something to do. */
function bindWorld() {
  const noop = () => undefined;
  renderHook(() => useWorldShortcuts({
    hasWorld: true,
    hidden: false,
    dialogOpen: false,
    waynet: { names: [] } as unknown as WaynetPayload,
    armed: true,
    gizmoMode: 'translate',
    snapGrid: 0,
    setGizmoMode: noop,
    onCopy: noop,
    onPaste: noop,
    onDuplicate: noop,
    onRestOnGround: noop,
    onIntoGround: noop,
    onRequestDeleteVobs: noop,
    onRequestDeleteWaypoint: noop,
    onDisarm: noop,
    onRequestSave: noop,
    onNudgeBegin: () => true,
    onNudgeBy: noop,
    onNudgeEnd: noop,
    onHistory: noop,
  } as unknown as WorldShortcutsInput));
}

/** Whether the World surface claimed the keystroke — `preventDefault` is the
 *  observable, as in `useWorldShortcuts.test.ts`. */
function claimed(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(event); });
  // Released, so a nudge key held by one probe does not claim the next — a
  // held key keeps its gesture whatever modifier joins it.
  act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: init.key })); });
  return event.defaultPrevented;
}

beforeEach(() => {
  useWorldStore.setState({ selection: [0], selectedWaypoint: null } as never);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('keyboard shortcuts sheet', () => {
  test('every row names its group, its keys and what they do', () => {
    for (const row of KEYBOARD_SHORTCUTS) {
      expect(row.keys).not.toBe('');
      expect(row.action).not.toBe('');
    }
  });

  test.each(probesOf('world'))('the World surface still claims %o', (init) => {
    bindWorld();
    expect(claimed(init)).toBe(true);
  });

  test('every bare-letter, Ctrl+letter and named-key chord the World surface claims has a row', () => {
    bindWorld();
    const listed = probesOf('world');
    const isListed = (init: KeyboardEventInit) => listed.some((probe) =>
      probe.key?.toLowerCase() === init.key?.toLowerCase()
      && !!probe.ctrlKey === !!init.ctrlKey
      && !!probe.shiftKey === !!init.shiftKey);

    const candidates: KeyboardEventInit[] = [];
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      candidates.push({ key: letter }, { key: letter, ctrlKey: true });
    }
    for (const digit of '0123456789') candidates.push({ key: digit });
    for (const key of ['Delete', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']) {
      candidates.push({ key });
    }

    const unlisted = candidates.filter((init) => claimed(init) && !isListed(init));
    expect(unlisted).toEqual([]);
  });

  test.each(probesOf('cameraSlot'))('the camera slots still own %o', (init) => {
    expect(cameraSlotFor({
      code: init.code ?? '',
      ctrlKey: !!init.ctrlKey,
      metaKey: false,
      shiftKey: !!init.shiftKey,
      altKey: false,
    })).not.toBeNull();
  });

  test.each(probesOf('fly'))('the fly still owns %o', (init) => {
    expect(flyMoveFor(init.code ?? '')).not.toBeNull();
  });
});
