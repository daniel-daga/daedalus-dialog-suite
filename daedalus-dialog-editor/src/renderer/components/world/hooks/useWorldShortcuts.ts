import { useEffect } from 'react';
import type { WaynetPayload } from '../../../../shared/worldTypes';
import { useWorldStore } from '../../../store/worldStore';
import { isTypingOrInPopover } from '../../../world/keyboardTarget';
import type { GizmoMode } from '../WorldViewport';

/** Camera-relative nudge: `[right, up, forward]`, one unit of step per key.
 *  Keyed by the lower-cased `KeyboardEvent.key`. */
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
  pagedown: [0, -1, 0],
};

/** The nudge a bare key takes when no snap step is set, in cm. */
const NUDGE_FALLBACK_STEP = 1;

/** How long a nudge key is held before it moves continuously, in ms — about
 *  the OS's own auto-repeat delay, so a tap stays one step. */
const NUDGE_HOLD_DELAY = 250;

/** How fast a held nudge key moves, in cm/s before Shift's ×10 — and at
 *  least this many snap steps a second, so a coarse grid does not crawl. */
const NUDGE_HOLD_SPEED = 300;
const NUDGE_HOLD_STEPS_PER_SECOND = 4;

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
  setGizmoMode: (mode: GizmoMode) => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onRestOnGround: () => void;
  onIntoGround: () => void;
  /** Opens the delete confirm for these VOBs — never deletes. */
  onRequestDeleteVobs: (vobs: readonly number[]) => void;
  /** Opens the waypoint delete confirm. */
  onRequestDeleteWaypoint: (waypoint: number, name: string) => void;
  /** Escape on an armed add. */
  onDisarm: () => void;
  /** Ctrl+S — opens the save confirm, never saves. */
  onRequestSave: () => void;
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
  hasWorld, hidden, dialogOpen, waynet, armed, gizmoMode, snapGrid, setGizmoMode,
  onCopy, onPaste, onDuplicate, onRestOnGround, onIntoGround,
  onRequestDeleteVobs, onRequestDeleteWaypoint,
  onDisarm, onRequestSave, onNudgeBegin, onNudgeBy, onNudgeEnd, onHistory,
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
    let frame: number | null = null;
    let lastFrame = 0;

    const tick = (now: number) => {
      const dt = Math.max(0, now - lastFrame) / 1000;
      lastFrame = now;
      for (const [key, { since, speed }] of held) {
        // Counted from the end of the hold delay, not the press, so the first
        // continuous frame does not jump by the delay's worth of travel.
        const moving = Math.min(dt, Math.max(0, (now - since - NUDGE_HOLD_DELAY) / 1000));
        if (moving <= 0) continue;
        const [r, u, f] = NUDGE_DELTAS[key];
        onNudgeBy([r * speed * moving, u * speed * moving, f * speed * moving]);
      }
      frame = requestAnimationFrame(tick);
    };

    const endNudge = () => {
      if (held.size === 0) return;
      held.clear();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      onNudgeEnd();
    };

    const keyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!held.has(key)) return;
      if (held.size > 1) held.delete(key);
      else endNudge();
    };

    const handler = (event: KeyboardEvent) => {
      // Lower-cased because holding Shift changes the letter itself: Ctrl+Shift+Z
      // arrives as `key: 'Z'`, and a comparison against 'z' never fires.
      const key = event.key.toLowerCase();

      // W and E, as every 3D editor binds them. Bare letters, so unlike the
      // undo shortcut they have to keep out of the way of anything that takes
      // typing — the World surface has no text field of its own, but this is a
      // window listener and the app is full of them.
      if (!event.ctrlKey && !event.metaKey && !event.altKey && (key === 'w' || key === 'e')
        && !(key === 'w' && (useWorldStore.getState().selection.length > 0 || held.size > 0))) {
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        event.preventDefault();
        setGizmoMode(key === 'w' ? 'translate' : 'rotate');
        return;
      }

      // Ctrl+C / Ctrl+V, guarded like W and E above and for the same reason:
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
      // PageUp/Down stay on ZenGin's vertical axis. Shift multiplies the step
      // by ten. W is a nudge while a VOB is selected, otherwise it keeps its
      // translate-gizmo shortcut above. With a modifier these are other chords
      // (Ctrl+S, Ctrl+D), so they fall through to those.
      //
      // A press moves one step at once; held past `NUDGE_HOLD_DELAY` it moves
      // continuously until released. The whole gesture is previewed and only
      // committed on the last key up, so a hold is one undo entry like a gizmo
      // drag, and the OS's auto-repeat keydowns are swallowed — the frame loop
      // owns the motion.
      if (NUDGE_DELTAS[key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (held.has(key)) {
          event.preventDefault();
          return;
        }
        if (isTypingOrInPopover(event.target) || dialogOpen) return;
        // Reserves the arrow keys for the scene tree's own navigation.
        const target = event.target as HTMLElement | null;
        if (target instanceof Element && target.closest('[role="tree"]')) return;
        // Read *before* `preventDefault`, as the Escape branch does: with
        // nothing selected this key is nobody's, and swallowing it would
        // stop the asset list scrolling for a nudge that never happens.
        if (held.size === 0 && useWorldStore.getState().selection.length === 0) return;
        // A nudge translates, so it takes the *translate* step — and only
        // while that is the step the Snap control is actually showing. In
        // rotate mode that control edits the angle instead, so a `snapGrid`
        // left over from translate mode would be an invisible value driving
        // a visible key: 45° on screen, 5 m under the arrow.
        const grid = gizmoMode === 'translate' ? snapGrid : 0;
        if (held.size === 0 && !onNudgeBegin(grid)) return;
        event.preventDefault();
        const base = grid > 0 ? grid : NUDGE_FALLBACK_STEP;
        const shift = event.shiftKey ? 10 : 1;
        const speed = Math.max(NUDGE_HOLD_SPEED, base * NUDGE_HOLD_STEPS_PER_SECOND) * shift;
        held.set(key, { since: performance.now(), speed });
        const [r, u, f] = NUDGE_DELTAS[key];
        const step = base * shift;
        onNudgeBy([r * step, u * step, f * step]);
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
    hasWorld, hidden, dialogOpen, waynet, armed, gizmoMode, snapGrid, setGizmoMode,
    onCopy, onPaste, onDuplicate, onRestOnGround, onIntoGround,
    onRequestDeleteVobs, onRequestDeleteWaypoint,
    onDisarm, onRequestSave, onNudgeBegin, onNudgeBy, onNudgeEnd, onHistory,
  ]);
}
