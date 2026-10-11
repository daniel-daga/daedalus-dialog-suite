import { useCallback, useState } from 'react';

/** The side panels' widths (level-editor.md §17) —
 *  view state like the theme, so it persists the same way (`main.tsx`'s
 *  `THEME_STORAGE_KEY` pattern), not through `SettingsService`, which is
 *  for main-process/security-adjacent config. */
export const PANEL_WIDTH_STORAGE_KEY = 'dandelion-world-panel-widths';
export const LEFT_PANEL_MIN = 200;
export const LEFT_PANEL_MAX = 480;
export const LEFT_PANEL_DEFAULT = 280;
export const RIGHT_PANEL_MIN = 220;
export const RIGHT_PANEL_MAX = 520;
export const RIGHT_PANEL_DEFAULT = 300;
/** Wide enough for the one button a collapsed panel still shows. */
export const COLLAPSED_PANEL_WIDTH = 28;

const clampPanelWidth = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, value))
);

/** Read once, at mount — a later change from another window does not need
 *  to be watched, and reading through `useState`'s lazy initializer means
 *  it runs exactly once regardless of how often the surface re-renders. */
function loadPanelWidths(): { left: number; right: number } {
  try {
    const raw = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (raw === null) return { left: LEFT_PANEL_DEFAULT, right: RIGHT_PANEL_DEFAULT };
    const parsed = JSON.parse(raw) as { left?: unknown; right?: unknown };
    return {
      left: clampPanelWidth(Number(parsed.left) || LEFT_PANEL_DEFAULT, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
      right: clampPanelWidth(Number(parsed.right) || RIGHT_PANEL_DEFAULT, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX),
    };
  } catch {
    return { left: LEFT_PANEL_DEFAULT, right: RIGHT_PANEL_DEFAULT };
  }
}

export interface PanelLayout {
  panelWidths: { left: number; right: number };
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  persistPanelWidths: () => void;
}

/**
 * The World surface's two side panels: how wide each is, whether each is
 * collapsed, and the one place the widths are written back.
 *
 * Collapse is deliberately not part of what persists — session-only, so every
 * launch opens with both panels showing, and collapsing one never has to touch
 * the width it will be restored to.
 */
export function usePanelLayout(): PanelLayout {
  const [panelWidths, setPanelWidths] = useState(loadPanelWidths);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  const setLeftPanelWidth = useCallback((width: number) => {
    setPanelWidths((current) => (
      { ...current, left: clampPanelWidth(width, LEFT_PANEL_MIN, LEFT_PANEL_MAX) }
    ));
  }, []);
  const setRightPanelWidth = useCallback((width: number) => {
    setPanelWidths((current) => (
      { ...current, right: clampPanelWidth(width, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX) }
    ));
  }, []);

  /** Written once the drag ends, not on every move — a live drag is dozens
   *  of resizes and localStorage is not where they belong. */
  const persistPanelWidths = useCallback(() => {
    try {
      localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(panelWidths));
    } catch {
      // A full or disabled localStorage loses the preference, not the
      // resize that is already on screen.
    }
  }, [panelWidths]);

  return {
    panelWidths,
    leftPanelCollapsed,
    rightPanelCollapsed,
    setLeftPanelWidth,
    setRightPanelWidth,
    setLeftPanelCollapsed,
    setRightPanelCollapsed,
    persistPanelWidths,
  };
}
