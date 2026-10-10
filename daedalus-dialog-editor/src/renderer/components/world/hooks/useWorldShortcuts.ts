import { useEffect } from 'react';
import type { WaynetPayload } from '../../../../shared/worldTypes';
import { useWorldStore } from '../../../store/worldStore';
import { isTypingOrInPopover } from '../../../world/keyboardTarget';
import type { GizmoMode } from '../WorldViewport';

/** Camera-relative nudge: `[right, up, forward]`, one unit of step per key.
 *  Keyed by the lower-cased `KeyboardEvent.key`. In rotate mode the same keys
 *  turn instead, and the triple is read as degrees — see `onTurnBy`. */
const NUDGE_DELTAS: Record<string, [number, number, number]> = {
  arrowleft: [-1, 0, 0],
  a: [-1, 0, 0],
  arrowright: [1, 0, 0],
  d: [1, 0, 0],
  arrowup: [0, 0, 1],
  w: [0, 0, 1],
  arrowdown: [0, 0, -1],
  s: [0, 0, -1],
  pageup: [0, 1, 0],
  ' ': [0, 1, 0],
  pagedown: [0, -1, 0],
  x: [0, -1, 0],
};

/** The nudge a bare key takes when no snap step is set, in cm — 10, so that
 *  Ctrl's ×0.1 is still a whole centimetre (#386). */
const NUDGE_FALLBACK_STEP = 10;

/** How long a nudge key is held before it moves continuously, in ms — about
 *  the OS's own auto-repeat delay, so a tap stays one step. */
const NUDGE_HOLD_DELAY = 250;

/** How fast a held nudge key moves, in cm/s before Shift's ×10 or Ctrl's
 *  ×0.1 — and at least this many snap steps a second, so a coarse grid does
 *  not crawl. */
const NUDGE_HOLD_SPEED = 500;
const NUDGE_HOLD_STEPS_PER_SECOND = 4;

/** The keyboard turn's counterparts, in degrees and °/s (#387). */
const TURN_FALLBACK_STEP = 1;
const TURN_HOLD_SPEED = 45;

/** Shift hurries and Ctrl slows, as they do the fly (#386). */
const FAST = 10;
const SLOW = 0.1;

/** The nudge keys Ctrl may start a gesture on: those whose Ctrl chord is
 *  nobody else's. Ctrl+S, Ctrl+D, Ctrl+A, Ctrl+W, Ctrl+X are left alone; Ctrl
 *  still slows any of them when pressed mid-hold. */
const CTRL_NUDGE_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'pageup', 'pagedown']);

/** 1 and 2 switch the gizmo, as the Spacer binds them (#387). By `code` as
 *  well as `key`, so a layout whose digit row is shifted (AZERTY) still has
 *  them; Ctrl+digit is a camera slot, not this. */
const GIZMO_MODE_KEYS: Record<string, GizmoMode> = {
  1: 'translate', Digit1: 'translate', 2: 'rotate', Digit2: 'rotate',
};

export interface WorldShortcutsInput {
  /** No world, nothing to act on — nothing is bound at all. */
  hasWorld: boolean;
  /** The surface stays mounted behind whichever view is on screen
   *  (`docs/refactoring-targets.md` §8), so this is what keeps a window
   *  listener from firing on a view that has never heard of a gizmo. */
  hidden: boolean;
  /**
   * Any of the surface's own modal surfaces is up, so these window-level
   * shortcuts are not the keystroke's owner — the dialog or menu is.
   *
   * Checked in addition to `isTypingOrInPopover`, which only sees where focus
   * *is*: a shortcut fired with focus still on `window` (nothing in the dialog
   * focused yet) would pass that test and fail this one.
   */
  dialogOpen: boolean;
  /** The drawn waynet, so Delete on a selected waypoint can name it. */
  waynet: WaynetPayload | null;
  /** Whether an add is armed against the next terrain click. */
  armed: boolean;
  /** Which step the Snap control is showing, and the step itself. */
  gizmoMode: GizmoMode;
  snapGrid: number;
  snapAngleDegrees: number;
  setGizmoMode: (mode: GizmoMode) => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onRestOnGround: () => void;
  onIntoGround: () => void;
  /** Asks to delete these VOBs — the surface decides whether that needs its
   *  confirm (#374). */
  onRequestDeleteVobs: (vobs: readonly number[]) => void;
  /** Opens the waypoint delete confirm. */
  onRequestDeleteWaypoint: (waypoint: number, name: string) => void;
  /** Escape on an armed add. */
  onDisarm: () => void;
  /** Ctrl+S — opens the save confirm, never saves. */
  onRequestSave: () => void;
  /** Ctrl+Shift+S — Save As: the native dialog is the confirmation (#367). */
  onRequestSaveAs: () => void;
  /**
   * A nudge is one gesture, like a gizmo drag: begun on the first key down,
   * fed camera-relative `[right, up, forward]` increments in cm for as long as
   * any nudge key is held, and committed once on the last key up — one undo
   * entry. `onNudgeBegin` answers whether there is anything to move; `grid` is
   * the step the preview and the commit snap to, 0 for free-form.
   */
  onNudgeBegin: (grid: number) => boolean;
  onNudgeBy: (direction: [number, number, number]) => void;
  onNudgeEnd: () => void;
  /**
   * The nudge keys in rotate mode: the same one-gesture shape, fed
   * `[right, up, forward]` in degrees — A/D yaw about the vertical, W/S pitch
   * about camera-right, Space/X roll about camera-forward. `step` is the
   * angle step the turn snaps to, 0 for free-form.
   */
  onTurnBegin: (step: number) => boolean;
  onTurnBy: (turn: [number, number, number]) => void;
  onTurnEnd: () => void;
  onHistory: (direction: 'undo' | 'redo') => void;
}

/**
 * Every window-level shortcut the World surface owns, lifted out of
 * `WorldSurface.tsx` (`docs/plans/level-editor-review-2026-09-04.md` §4 names
 * the keyboard effect as one of the nine concerns).
 *
 * What is here is only the dispatch — which keystroke is this surface's, and
 * when it is not. The verbs are all handed in, and the two destructive ones are
 * deliberately *requests*: Delete and Ctrl+S open the confirms that already gate
 * them (§15) rather than committing anything, so the dialogs stay the only place
 * either is actually sent.
 *
 * Every branch takes the same pair of guards, and that repetition is the point:
 * these are **window** listeners in an app full of text fields, so a chord this
 * surface claims in the viewport belongs to the browser in a field. The guards
 * are per-branch rather than hoisted because two branches want a third test of
 * their own — the nudge reserves the arrow keys for the scene tree, and Escape
 * and the nudge both read the selection *before* calling `preventDefault`, so a
 * key nobody here wants is left for whatever would otherwise scroll.
 */
export function useWorldShortcuts({
  hasWorld, hidden, dialogOpen, waynet, armed, gizmoMode, snapGrid, snapAngleDegrees, setGizmoMode,
  onCopy, onPaste, onDuplicate, onRestOnGround, onIntoGround,
  onRequestDeleteVobs, onRequestDeleteWaypoint,
  onDisarm, onRequestSave, onRequestSaveAs, onNudgeBegin, onNudgeBy, onNudgeEnd,
  onTurnBegin, onTurnBy, onTurnEnd, onHistory,
}: WorldShortcutsInput): void {
  useEffect(() => {
    if (!hasWorld) return undefined;
    // Bound while hidden, Ctrl+Z in the dialog view would undo a world edit as
    // well as the dialog edit `MainLayout` performs, and W would swallow a
    // keystroke on a view that has never heard of a gizmo.
    if (hidden) return undefined;

    /** The nudge keys held down, each with when it went down and how fast it
     *  moves once held. Empty is no nudge in progress. */
    const held = new Map<string, { since: number; speed: number }>();
    /** Shift and Ctrl as the last key event saw them — read every frame, so
     *  pressing either mid-hold changes the speed from then on. */
    let factor = 1;
    const readModifiers = (event: KeyboardEvent) => {
      factor = (event.shiftKey ? FAST : 1) * (event.ctrlKey || event.metaKey ? SLOW : 1);
    };
    /** Whether the gesture in progress turns — fixed at its first key, so it
     *  ends through the verb it began with. A mode switch re-binds this
     *  effect, which ends the gesture first. */
    const turning = gizmoMode === 'rotate';
    const by = turning ? onTurnBy : onNudgeBy;
    let frame: number | null = null;
    let lastFrame = 0;

    const tick = (now: number) => {
      const dt = Math.max(0, now - lastFrame) / 1000;
      lastFrame = now;
      for (const [key, { since, speed }] of held) {
        // Counted from the end of the hold delay, not the press, so the first
        // continuous frame does not jump by the delay's worth of travel.
        const moving = factor * Math.min(dt, Math.max(0, (now - since - NUDGE_HOLD_DELAY) / 1000));
        if (moving <= 0) continue;
        const [r, u, f] = NUDGE_DELTAS[key];
        by([r * speed * moving, u * speed * moving, f * speed * moving]);
      }
      frame = requestAnimationFrame(tick);
    };

    const endNudge = () => {
      if (held.size === 0) return;
      held.clear();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (turning) onTurnEnd(); else onNudgeEnd();
    };

    const keyUp = (event: KeyboardEvent) => {
      readModifiers(event);
      const key = event.key.toLowerCase();
      if (!held.has(key)) return;
      if (held.size > 1) held.delete(key);
      else endNudge();
    };

    const handler = (event: KeyboardEvent) => {
      // Lower-cased because holding Shift changes the letter itself: Ctrl+Shift+Z
      // arrives as `key: 'Z'`, and a comparison against 'z' never fires.
      const key = event.key.toLowerCase();
      readModifiers(event);

      // A key already held is the gesture's, whatever modifier has joined it
      // since: Ctrl pressed mid-hold on S slows the nudge, it is not a save.
      if (held.has(key)) {
        event.preventDefault();
        return;
      }

      // 1 and 2, the Spacer's keys (#387) — W and E were, until W became a
      // nudge and only switched with nothing selected. Bare keys, so unlike
      // the undo shortcut they have to keep out of the way of anything that
      // takes typing — the World surface has no text field of its own, but
      // this is a window listener and the app is full of them.
      const mode = GIZMO_MODE_KEYS[event.key] ?? GIZMO_MODE_KEYS[event.code];
      if (mode !== undefined && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        event.preventDefault();
        setGizmoMode(mode);
        return;
      }

      // Ctrl+C / Ctrl+V, guarded like 1 and 2 above and for the same reason:
      // this is a window listener, and in a text field a copy belongs to the
      // browser.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
        && (key === 'c' || key === 'v')) {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        // And with nothing selected a copy is the browser's too, rather than a
        // swallowed keystroke: the surface shows text — the install path, a VOB
        // name — that a user may well be trying to copy. It leaves whatever is
        // already on the clipboard standing.
        if (key === 'c' && useWorldStore.getState().selection.length === 0) return;
        event.preventDefault();
        if (key === 'c') onCopy(); else onPaste();
        return;
      }

      // Ctrl+D — what Blender, Unity and Unreal duplicate with, and the key
      // Duplicate had none of until #253, which is why the context menu showed
      // it the one blank shortcut slot. Guarded like Ctrl+C above: this is a
      // window listener, and in a text field the browser owns the chord.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 'd') {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        // Nothing selected is not this surface's keystroke: a duplicate of
        // nothing would be an empty batch that is still an undo entry, and the
        // chord is the browser's bookmark otherwise.
        if (useWorldStore.getState().selection.length === 0) return;
        event.preventDefault();
        onDuplicate();
        return;
      }

      // G puts the model's base on the surface; Shift+G retains the original
      // pivot drop for foliage. Both act on the current selection as one edit.
      if (key === 'g' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        if (useWorldStore.getState().selection.length === 0) return;
        event.preventDefault();
        if (event.shiftKey) onIntoGround(); else onRestOnGround();
        return;
      }

      // Delete — opens the confirm dialog that already gates a destructive
      // edit (§15) rather than committing anything itself; the two dialogs
      // stay the only place either delete is actually sent. Waypoint checked
      // first: VOB and waypoint selection are mutually exclusive in the
      // store, so only one of the two branches below can ever apply.
      if (key === 'delete') {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        const { selection: currentSelection, selectedWaypoint: currentWaypoint } = useWorldStore.getState();
        if (currentWaypoint !== null && waynet !== null) {
          event.preventDefault();
          onRequestDeleteWaypoint(currentWaypoint, waynet.names[currentWaypoint]);
        } else if (currentSelection.length > 0) {
          event.preventDefault();
          onRequestDeleteVobs(currentSelection);
        }
        return;
      }

      // Escape — clears the selection, but not while a surface dialog is
      // showing: every one of them already closes on Escape (MUI's own
      // Modal), and this is a second, independent listener on the same
      // keydown — without the guard it would also discard the selection the
      // open dialog is about, out from under the dialog that is closing.
      if (key === 'escape') {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        // An armed add is the more recent intent, and the one Escape is
        // most likely aimed at; the selection survives it.
        if (armed) {
          event.preventDefault();
          onDisarm();
          return;
        }
        const { selection: currentSelection, selectedWaypoint: currentWaypoint } = useWorldStore.getState();
        if (currentSelection.length === 0 && currentWaypoint === null) return;
        event.preventDefault();
        useWorldStore.getState().selectVob(null);
        return;
      }

      // Camera-relative nudge — WASD and the arrows move in the view plane;
      // PageUp/Down, and Space/X as the fly binds them, stay on ZenGin's
      // vertical axis. Shift multiplies the step by ten and Ctrl by a tenth
      // (#386). In rotate mode the same keys turn the selection instead
      // (#387). Ctrl starts a gesture only on keys whose Ctrl chord is
      // nobody's (`CTRL_NUDGE_KEYS`); Ctrl+S, Ctrl+D fall through to those.
      //
      // A press moves one step at once; held past `NUDGE_HOLD_DELAY` it moves
      // continuously until released. The whole gesture is previewed and only
      // committed on the last key up, so a hold is one undo entry like a gizmo
      // drag, and the OS's auto-repeat keydowns are swallowed — the frame loop
      // owns the motion.
      if (NUDGE_DELTAS[key] && !event.altKey
        && (!(event.ctrlKey || event.metaKey) || CTRL_NUDGE_KEYS.has(key))) {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        // Reserves the arrow keys for the scene tree's own navigation.
        const target = event.target as HTMLElement | null;
        if (target instanceof Element && target.closest('[role="tree"]')) return;
        // Space is a focused control's own click, and the Assets panel's
        // place — which claims it on the row before it bubbles here.
        if (key === ' ' && (event.defaultPrevented
          || (target instanceof Element && target.closest('button, a[href], [role="button"], [role="checkbox"], [role="switch"], [role="tab"]')))) return;
        // Read *before* `preventDefault`, as the Escape branch does: with
        // nothing selected this key is nobody's, and swallowing it would
        // stop the asset list scrolling for a nudge that never happens.
        if (held.size === 0 && useWorldStore.getState().selection.length === 0) return;
        // The step is the one the Snap control is showing: the grid in
        // translate mode, the angle in rotate mode — never the other mode's,
        // which would be an invisible value driving a visible key.
        const grid = turning ? snapAngleDegrees : snapGrid;
        if (held.size === 0 && !(turning ? onTurnBegin(grid) : onNudgeBegin(grid))) return;
        event.preventDefault();
        const base = grid > 0 ? grid : (turning ? TURN_FALLBACK_STEP : NUDGE_FALLBACK_STEP);
        const speed = Math.max(turning ? TURN_HOLD_SPEED : NUDGE_HOLD_SPEED,
          base * NUDGE_HOLD_STEPS_PER_SECOND);
        held.set(key, { since: performance.now(), speed });
        const [r, u, f] = NUDGE_DELTAS[key];
        const step = base * factor;
        by([r * step, u * step, f * step]);
        if (frame === null) {
          lastFrame = performance.now();
          frame = requestAnimationFrame(tick);
        }
        return;
      }

      // Ctrl+S, the shortcut every editor has and this one did not. It opens
      // the confirm rather than saving: the warnings there are about whether to
      // save at all, and a keystroke is not a reason to skip them.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 's') {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        event.preventDefault();
        onRequestSave();
        return;
      }

      // Ctrl+Shift+S. No warning dialog first: the native save dialog is the
      // confirmation, and it asks before it replaces a file (#367).
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.shiftKey && key === 's') {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        event.preventDefault();
        onRequestSaveAs();
        return;
      }

      const undo = (event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey;
      const redo = (event.ctrlKey || event.metaKey)
        && (key === 'y' || (key === 'z' && event.shiftKey));
      if (!undo && !redo) return;
      // The same pair of guards every branch above takes, and this one wants
      // them most: in a text field Ctrl+Z is the field's own undo, and with a
      // confirm open the dialog owns the keystroke — the delete confirm names a
      // VOB by flat index, and an undo that renumbers would leave it pointing at
      // whatever moved into that index.
      if (isTypingOrInPopover(event.target) || dialogOpen) return;

      event.preventDefault();
      onHistory(undo ? 'undo' : 'redo');
    };

    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', keyUp);
    // A key released while the window is unfocused never reports its keyup.
    window.addEventListener('blur', endNudge);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', endNudge);
      // A re-bind mid-hold (a dialog opening, the step changing) commits what
      // was moved so far rather than leaving the preview stranded.
      endNudge();
    };
  }, [
    hasWorld, hidden, dialogOpen, waynet, armed, gizmoMode, snapGrid, snapAngleDegrees, setGizmoMode,
    onCopy, onPaste, onDuplicate, onRestOnGround, onIntoGround,
    onRequestDeleteVobs, onRequestDeleteWaypoint,
    onDisarm, onRequestSave, onRequestSaveAs, onNudgeBegin, onNudgeBy, onNudgeEnd,
    onTurnBegin, onTurnBy, onTurnEnd, onHistory,
  ]);
}
