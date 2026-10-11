/**
 * The World surface's side-panel layout, lifted out of `WorldSurface.tsx`
 * (`docs/plans/level-editor-review-2026-09-04.md` §4 — the panel-width and
 * collapse state is pure view state and was named as the first thing to go).
 *
 * What the hook owes its caller:
 *   - widths restored from localStorage at mount, clamped to each panel's range
 *   - a corrupt, absent or unreadable store falls back to the defaults
 *   - a resize clamps rather than refuses
 *   - the store is written on resize *end*, not on every move
 *   - collapse is session-only and never touches the width it restores to
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import {
  usePanelLayout,
  PANEL_WIDTH_STORAGE_KEY,
  LEFT_PANEL_MIN,
  LEFT_PANEL_MAX,
  LEFT_PANEL_DEFAULT,
  RIGHT_PANEL_MIN,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_DEFAULT,
} from '../src/renderer/components/world/hooks/usePanelLayout';

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('usePanelLayout — restoring', () => {
  test('with nothing stored, both panels open at their defaults', () => {
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current.panelWidths).toEqual({
      left: LEFT_PANEL_DEFAULT,
      right: RIGHT_PANEL_DEFAULT,
    });
  });

  test('a stored pair is restored', () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify({ left: 320, right: 400 }));
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current.panelWidths).toEqual({ left: 320, right: 400 });
  });

  test('a stored pair outside the ranges is clamped into them, per side', () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify({ left: 10_000, right: 1 }));
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current.panelWidths).toEqual({
      left: LEFT_PANEL_MAX,
      right: RIGHT_PANEL_MIN,
    });
  });

  test('malformed JSON falls back to the defaults rather than throwing', () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, '{not json');
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current.panelWidths).toEqual({
      left: LEFT_PANEL_DEFAULT,
      right: RIGHT_PANEL_DEFAULT,
    });
  });

  test('a localStorage that throws on read falls back to the defaults', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current.panelWidths).toEqual({
      left: LEFT_PANEL_DEFAULT,
      right: RIGHT_PANEL_DEFAULT,
    });
  });

  test('the store is read once at mount, not on every render', () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify({ left: 320, right: 400 }));
    const read = jest.spyOn(Storage.prototype, 'getItem');
    const { rerender } = renderHook(() => usePanelLayout());
    rerender();
    rerender();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('usePanelLayout — resizing', () => {
  test('each side clamps at both ends of its own range', () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => { result.current.setLeftPanelWidth(LEFT_PANEL_MAX + 500); });
    expect(result.current.panelWidths.left).toBe(LEFT_PANEL_MAX);
    act(() => { result.current.setLeftPanelWidth(LEFT_PANEL_MIN - 500); });
    expect(result.current.panelWidths.left).toBe(LEFT_PANEL_MIN);

    act(() => { result.current.setRightPanelWidth(RIGHT_PANEL_MIN - 500); });
    expect(result.current.panelWidths.right).toBe(RIGHT_PANEL_MIN);
    act(() => { result.current.setRightPanelWidth(RIGHT_PANEL_MAX + 500); });
    expect(result.current.panelWidths.right).toBe(RIGHT_PANEL_MAX);
  });

  test('resizing one side leaves the other alone', () => {
    const { result } = renderHook(() => usePanelLayout());
    act(() => { result.current.setLeftPanelWidth(400); });
    expect(result.current.panelWidths.right).toBe(RIGHT_PANEL_DEFAULT);
    act(() => { result.current.setRightPanelWidth(480); });
    expect(result.current.panelWidths.left).toBe(400);
  });

  test('a drag writes nothing; the write happens when the drag ends', () => {
    const { result } = renderHook(() => usePanelLayout());
    const write = jest.spyOn(Storage.prototype, 'setItem');

    act(() => { result.current.setLeftPanelWidth(300); });
    act(() => { result.current.setLeftPanelWidth(310); });
    act(() => { result.current.setLeftPanelWidth(320); });
    expect(write).not.toHaveBeenCalled();

    act(() => { result.current.persistPanelWidths(); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) as string))
      .toEqual({ left: 320, right: RIGHT_PANEL_DEFAULT });
  });

  test('persisting writes the widths as they stand when it is called', () => {
    const { result } = renderHook(() => usePanelLayout());
    act(() => { result.current.setLeftPanelWidth(300); });
    act(() => { result.current.persistPanelWidths(); });
    act(() => { result.current.setLeftPanelWidth(460); });
    act(() => { result.current.persistPanelWidths(); });
    expect(JSON.parse(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) as string).left).toBe(460);
  });

  test('a localStorage that throws on write loses the preference, not the resize', () => {
    const { result } = renderHook(() => usePanelLayout());
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    act(() => { result.current.setLeftPanelWidth(300); });
    expect(() => act(() => { result.current.persistPanelWidths(); })).not.toThrow();
    expect(result.current.panelWidths.left).toBe(300);
  });
});

describe('usePanelLayout — collapsing', () => {
  test('both panels start open', () => {
    const { result } = renderHook(() => usePanelLayout());
    expect(result.current.leftPanelCollapsed).toBe(false);
    expect(result.current.rightPanelCollapsed).toBe(false);
  });

  test('collapsing one side leaves the other showing', () => {
    const { result } = renderHook(() => usePanelLayout());
    act(() => { result.current.setLeftPanelCollapsed(true); });
    expect(result.current.leftPanelCollapsed).toBe(true);
    expect(result.current.rightPanelCollapsed).toBe(false);
  });

  test('collapse never touches the width the panel is restored to', () => {
    const { result } = renderHook(() => usePanelLayout());
    act(() => { result.current.setLeftPanelWidth(400); });
    act(() => { result.current.setLeftPanelCollapsed(true); });
    expect(result.current.panelWidths.left).toBe(400);
    act(() => { result.current.setLeftPanelCollapsed(false); });
    expect(result.current.panelWidths.left).toBe(400);
  });

  test('collapse is session-only — it is never written to the store', () => {
    const { result } = renderHook(() => usePanelLayout());
    act(() => { result.current.setLeftPanelCollapsed(true); });
    act(() => { result.current.persistPanelWidths(); });
    expect(JSON.parse(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) as string))
      .toEqual({ left: LEFT_PANEL_DEFAULT, right: RIGHT_PANEL_DEFAULT });
  });

  test('a fresh mount opens with both panels showing, whatever the last session did', () => {
    const first = renderHook(() => usePanelLayout());
    act(() => { first.result.current.setLeftPanelCollapsed(true); });
    act(() => { first.result.current.persistPanelWidths(); });
    first.unmount();

    const second = renderHook(() => usePanelLayout());
    expect(second.result.current.leftPanelCollapsed).toBe(false);
  });
});
