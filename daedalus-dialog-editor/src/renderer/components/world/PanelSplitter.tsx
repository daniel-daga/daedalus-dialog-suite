import React, { useRef } from 'react';
import { Box } from '@mui/material';

/**
 * The drag handle between the World surface's side panels and the viewport
 * (level-editor-ui-improvements.md slice 8) — a 6 px strip, not a docking
 * framework: one splitter, one number, no saved layouts.
 *
 * Reports the panel's **new width**, not a delta — `grow` says which
 * direction of drag widens it, so the surface only ever has to clamp and
 * store what it is given. Drag state is a plain ref rather than
 * `setPointerCapture`/`hasPointerCapture` deciding whether a move counts:
 * those calls are still made, for the real browser's sake (they keep the
 * drag tracking once the pointer leaves the 6 px strip), but jsdom does not
 * implement them and this must not depend on it doing so.
 */
export interface PanelSplitterProps {
  /** The panel's width when the drag begins. */
  width: number;
  /** Which direction of drag widens the panel: 'right' for a splitter on a
   *  left-hand panel's trailing edge, 'left' for one on a right-hand
   *  panel's leading edge. */
  grow: 'left' | 'right';
  onResize: (width: number) => void;
  /** Committed once, when the drag ends — not on every move, which would
   *  write to localStorage on every pixel. */
  onResizeEnd: () => void;
  'data-testid': string;
}

const PanelSplitter: React.FC<PanelSplitterProps> = ({
  width, grow, onResize, onResizeEnd, 'data-testid': testId,
}) => {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    // Imperative, not `sx`: a ref mutation triggers no re-render, and what
    // this prevents is a text selection over the *panels* the drag passes
    // across — not the splitter's own (already unselectable) 6 px strip.
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    const raw = event.clientX - drag.current.startX;
    onResize(drag.current.startWidth + (grow === 'right' ? raw : -raw));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    drag.current = null;
    document.body.style.userSelect = '';
    onResizeEnd();
  };

  return (
    <Box
      data-testid={testId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      sx={{
        width: 6, flexShrink: 0, cursor: 'col-resize', userSelect: 'none',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    />
  );
};

export default PanelSplitter;
