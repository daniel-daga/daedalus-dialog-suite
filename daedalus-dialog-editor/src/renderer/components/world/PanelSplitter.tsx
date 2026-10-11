import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';

/**
 * The drag handle between the World surface's side panels and the viewport
 * (level-editor.md §17) — a 6 px strip, not a docking
 * framework: one splitter, one number, no saved layouts.
 *
 * Reports the panel's **new width**, not a delta — `grow` says which
 * direction of drag widens it, so the surface only ever has to clamp and
 * store what it is given. Drag state is a plain ref rather than
 * `setPointerCapture`/`hasPointerCapture` deciding whether a move counts:
 * those calls are still made, for the real browser's sake (they keep the
 * drag tracking once the pointer leaves the 6 px strip), but jsdom does not
 * implement them and this must not depend on it doing so.
 *
 * The keyboard drives the same two callbacks (§5.4 item 23 of the 2026-09-04
 * review): an arrow key is a move, and the key coming back up is the end of the
 * gesture. Committing on keyup rather than on the keydown that moved it is not
 * only symmetry with the drag — `onResizeEnd` reads the width out of the
 * caller's state, and that state is a render behind until the browser delivers
 * the next event.
 */

/** How far one arrow key moves the boundary, in px. Ten: fine enough to land on
 *  a width, coarse enough that a panel crosses its clamp in a few presses
 *  rather than thirty. */
const KEY_STEP = 10;
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

  // `onPointerDown` writes `document.body.style.userSelect`, and only
  // `endDrag` — bound to this element — clears it. Collapsing the panel or
  // closing the world unmounts the strip mid-drag, so that pointerup never
  // arrives and the *whole app* would stay unselectable for the rest of the
  // session. The unmount is the one path no pointer event can cover.
  useEffect(() => () => { document.body.style.userSelect = ''; }, []);

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

  /** Which way this key moves the boundary, and 0 for a key that is not one of
   *  the two. The arrow that *widens* is the one `grow` names, so on the
   *  right-hand panel the keys mean the opposite of the left-hand one's — which
   *  is "the key pointing away from the viewport widens the panel". */
  const stepFor = (key: string): number => {
    const towards = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
    return towards * (grow === 'right' ? 1 : -1) * KEY_STEP;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = stepFor(event.key);
    if (step === 0) return;
    event.preventDefault();
    onResize(width + step);
  };

  const onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (stepFor(event.key) !== 0) onResizeEnd();
  };

  return (
    <Box
      data-testid={testId}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // The panel boundary itself: the strip replaced the panels' own
      // `borderRight`/`borderLeft`, so without this there is no visible
      // divider between the tree and the viewport until the pointer
      // happens to cross the 6 px.
      sx={{
        width: 6, flexShrink: 0, cursor: 'col-resize', userSelect: 'none',
        borderLeft: 1, borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    />
  );
};

export default PanelSplitter;
