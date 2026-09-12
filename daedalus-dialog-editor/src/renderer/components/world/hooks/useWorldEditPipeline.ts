import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import {
  applyWaypointNames,
  applyWaypointPositions,
  invertOp,
  isBarrierOp,
  isStructuralOp,
  renumbersPaths,
  type WorldOp,
} from 'zen-world';
import type { InstancedPayload, WaynetPayload } from '../../../../shared/worldTypes';
import { useWorldStore } from '../../../store/worldStore';

export interface WorldEditPipelineInput {
  /** The payload the waynet overlay is drawing, or null while it has never been
   *  switched on. Patched in place where it can be, re-read where it cannot. */
  waynet: WaynetPayload | null;
  setWaynet: (payload: WaynetPayload) => void;
  setVisuals: (payload: InstancedPayload) => void;
  /**
   * The imperative channel to the viewport and the scene tree — they live
   * outside React's render path and cannot read the index the panels read, so
   * they are handed the ops instead. Owned by the surface because the class-prop
   * re-read effect is declared above this pipeline and keys on it.
   */
  setAppliedOps: (ops: WorldOp[]) => void;
  /** An edit landed, so the bytes on disk are no longer what is on screen. */
  markEdited: () => void;
  /** Drop the class fields, so a refusal can remount them — see
   *  {@link WorldEditPipeline.editRefusals} for the base fields' half of it. */
  forgetClassProps: () => void;
  /** Re-ask the main process how deep its stacks are; it owns them. */
  refreshHistoryDepth: () => void;
  /**
   * Bumped by `openWorldAt`, so a round trip that comes back can tell that the
   * world it addressed is no longer the one on screen. A ref, and the surface's,
   * because the open is declared well above this pipeline.
   */
  openGeneration: MutableRefObject<number>;
}

export interface WorldEditPipeline {
  /**
   * The one way an edit reaches the world.
   *
   * @returns whether the world took the edit — false is a refusal, and the
   *  banner has already been set, or the drop of a commit that arrived while
   *  another was still out, which says nothing at all. A caller that has
   *  something to do *after* a commit needs it: the paste selects what it
   *  pasted, and there is nothing to select when nothing landed.
   */
  commitOps: (ops: WorldOp[]) => Promise<boolean>;
  /** Shared by Ctrl+Z/Y and the World bar's undo/redo buttons. */
  runHistory: (direction: 'undo' | 'redo') => Promise<void>;
  /**
   * How many edits the main process has refused — folded into every editable
   * field key in `WorldPropertyGrid`, so a refusal remounts the fields showing
   * the world's own values (`docs/refactoring-targets.md` §7). Bumped beside the
   * `forgetClassProps` that is the same rule for the class section: a refusal
   * changes nothing in the world, so without this nothing re-keys and an
   * uncontrolled input keeps the number the user typed.
   */
  editRefusals: number;
}

/**
 * The World surface's edit pipeline — the last of the nine concerns
 * `docs/plans/level-editor-review-2026-09-04.md` §4 named, and the one that had
 * to go last because it is where the in-flight guard (§2.7) and the refusal path
 * live, and because every other extracted concern is handed its `commitOps`.
 *
 * Four things in one place, in the order an edit meets them: `commitOps`, which
 * is the only door; the in-flight guard behind it; `applied`, which is the
 * renderer catching up with a world that has already changed; and
 * `putTheViewBack`, for the two cases where it has not.
 *
 * **Undo and redo do not come through `commitOps`.** The op log lives in the
 * main process, so `runHistory` asks it what it undid and applies exactly that,
 * never what this side thinks it sent — which is the whole reason `applied` is a
 * function rather than three lines inside the commit.
 */
export function useWorldEditPipeline({
  waynet, setWaynet, setVisuals, setAppliedOps, markEdited, forgetClassProps,
  refreshHistoryDepth, openGeneration,
}: WorldEditPipelineInput): WorldEditPipeline {
  const [editRefusals, setEditRefusals] = useState(0);

  /**
   * What every applied batch does, whichever way it arrived.
   *
   * A structural op changes how many VOBs there are, and a flat index is a VOB's
   * position in a depth-first traversal — so the columnar projection cannot be
   * patched and is re-read whole. The scene follows by rebuilding from fresh
   * visuals: an instance cannot be appended to an `InstancedMesh` that is
   * already allocated. Both are the cost of a structural edit, and only a
   * structural edit pays them. What the rebuild no longer costs is the two
   * things that made it read as a cold open: the camera stays put, because the
   * pose is restored across a rebuild under an unchanged world key, and the
   * textures are not re-decoded, because the viewport's `TextureCache` outlives
   * the `WorldScene` that used them.
   *
   * **Undo and redo come through here too**, and that is the whole reason this
   * is a function rather than three lines inside `commitOps`. They do not go
   * through it — the op log lives in the main process, so `runHistory` asks it
   * what it undid and applies that — and an undone placement leaves the
   * renderer holding a VOB the world no longer has.
   */
  const applied = useCallback(async (ops: readonly WorldOp[]) => {
    useWorldStore.getState().applyEdit(ops);
    // What the quick test refuses to launch over (§16.29). Undo comes through
    // here too and marks the world edited rather than clean — an undone edit
    // is still a world whose bytes on disk are not what is on screen, and the
    // history's own depth cannot say otherwise: the stack is emptied by a save
    // no more than it is filled by one.
    markEdited();

    // The waynet's half of the projection. The store's `applyEdit` writes the
    // VOB columns and filters these out — a waypoint has no row in them — so
    // this is the only place a committed waypoint move reaches the renderer.
    // The payload is the one the overlay is drawing: its position attribute is
    // a *view* over this buffer, so writing it here is writing what is on
    // screen, and the viewport only has to ask for the upload.
    //
    // Undo and redo come through here as well, which is the whole reason it is
    // in `applied` rather than beside the commit.
    const moves = ops.filter((op) => op.op === 'MoveWaypoint');
    if (moves.length > 0 && waynet !== null) {
      applyWaypointPositions(new Float32Array(waynet.positions), moves);
    }
    // The names are the other half, and they are written differently on
    // purpose. The positions column is a buffer the overlay's attribute is a
    // *view* over, so writing it in place is writing what is on screen; nothing
    // draws a name, and the panel that shows one is React — so this replaces
    // the list rather than mutating it, keeping the same `positions` buffer.
    const renames = ops.filter((op) => op.op === 'RenameWaypoint');
    if (renames.length > 0 && waynet !== null) {
      const names = [...waynet.names];
      applyWaypointNames(names, renames);
      setWaynet({ ...waynet, names });
    }

    // An append is the one waynet op the payload cannot be patched for. The
    // positions column is a typed array the point cloud and the edge lines draw
    // *through* and it cannot grow, and the names list is only half of it — so
    // the payload is re-read whole, which is the waynet's version of what a
    // structural VOB op does to the columnar index. It is cheap for the same
    // reason the overlay is a separate call at all: a waynet is thousands of
    // points, not tens of thousands of VOBs with visuals behind them.
    //
    // Undo comes through here too, and arrives as the same op with its sides
    // swapped — so this covers the removal without knowing it is one.
    // An edge op is re-read the same way and for the same reason: the edge
    // buffer the overlay draws its lines through is a typed array, so it cannot
    // gain or lose a pair in place — and a removal can promote an endpoint to a
    // free point, which is a flags column nothing else would rewrite.
    // A delete is re-read for the same reason and one more of its own: it takes
    // a waypoint out of the *middle*, so the payload cannot shrink in place any
    // more than it can grow, and every index after it names a different
    // waypoint afterwards.
    if (ops.some((op) => op.op === 'AddWaypoint' || op.op === 'SetWaypointEdge'
      || op.op === 'DeleteWaypoint')) {
      // The removing direction takes the tail away, and a gizmo standing on it
      // would be standing on an index the waynet no longer has. Cleared rather
      // than followed, exactly as a renumbering VOB op clears the selection —
      // and a delete renumbers every waypoint after it, so it clears for the
      // stronger version of the same reason.
      if (ops.some((op) => (op.op === 'AddWaypoint' && op.to === null)
        || op.op === 'DeleteWaypoint')) useWorldStore.getState().selectWaypoint(null);
      setWaynet(await window.editorAPI.getWorldWaynet());
    }

    setAppliedOps([...ops]);
    refreshHistoryDepth();
    if (!ops.some(isStructuralOp)) {
      // The one property change the viewport cannot follow by rewriting an
      // instance matrix: a swapped visual is a different mesh, in a different
      // `InstancedMesh` which may not exist yet, so the payload is re-read
      // whole — the same thing a structural op does below, for a reason of its
      // own. Not structural itself: no VOB came or went, nothing renumbered,
      // and the index is left alone.
      //
      // Here rather than beside the commit because undo and redo do not go
      // through the commit: they apply what the main process says it did, and
      // an inverted `SetVobProp` carries `visual` on both sides just as the
      // forward one does — so testing either side answers.
      if (ops.some((op) => op.op === 'SetVobProp' && op.to.visual !== undefined)) {
        setVisuals(await window.editorAPI.getWorldVisuals());
      }
      return;
    }

    // A selection is a list of flat indices, and an op that renumbers leaves
    // every one of them naming a VOB nobody picked — the property grid would
    // describe it and the gizmo would sit on it. Cleared rather than followed:
    // the moved VOB's new index is recoverable from its path, but the *other*
    // VOBs in a multi-select are not, and a selection that silently lost some of
    // its members is worse than one that says it is empty. Not the same
    // condition as structural: an appended root shifts nothing.
    if (ops.some(renumbersPaths)) useWorldStore.getState().selectVob(null);

    useWorldStore.getState().indexRefreshed(await window.editorAPI.refreshWorldIndex());
    setVisuals(await window.editorAPI.getWorldVisuals());
  }, [waynet, setWaynet, setVisuals, setAppliedOps, markEdited, refreshHistoryDepth]);

  /** Shared by Ctrl+Z/Y and the World bar's undo/redo buttons: ask the main
   *  process what it did, and — through the same path a commit takes —
   *  apply exactly that, never what this side thinks it sent. */
  const runHistory = useCallback(async (direction: 'undo' | 'redo') => {
    const generation = openGeneration.current;
    // Every caller is `void runHistory(...)` — a keystroke and a toolbar button
    // — so a rejection here had nowhere to go: no banner, a stale history depth
    // on the buttons, and a view quietly behind the world. `commitOps` wraps
    // its own `applied` for exactly this reason; this path did not.
    try {
      const ops = await (direction === 'undo'
        ? window.editorAPI.undoWorldEdit() : window.editorAPI.redoWorldEdit());
      if (ops === null || ops.length === 0) return;
      // A world opened while this was out: the ops address the world it undid,
      // and this side is showing a different one.
      if (openGeneration.current !== generation) return;
      await applied(ops);
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : String(failure);
      useWorldStore.getState().editFailed(
        `The ${direction} did not go through: ${reason}.`,
      );
      refreshHistoryDepth();
    }
  }, [applied, refreshHistoryDepth, openGeneration]);

  /**
   * Put the screen back where an edit did not happen — shared by the refusal
   * and by the in-flight drop below, which differ only in whether there is a
   * banner to show.
   *
   * **Let go of the class fields here, and not only in the re-read effect.**
   * The grid's inputs are uncontrolled and are put right by *remounting*
   * through a key that carries the value — so an edit that did not land is only
   * undone on screen if the fields unmount, and the value the re-read answers is
   * by definition the value they already had: the key does not change, and
   * nothing but a `null` in between takes the typed number off the screen.
   *
   * That effect sets the `null` too, but a render later and in the same tick as
   * the read that fills it back in — so whether it is ever *committed* depends
   * on whether React happens to flush between the two, which any unrelated
   * pending update in the surface can change (adding a MUI `Select` to the bar
   * above did exactly that). Set here it is committed before the read is even
   * issued, which is what makes the revert a rule rather than a coincidence.
   */
  const putTheViewBack = useCallback((ops: readonly WorldOp[]) => {
    forgetClassProps();
    // And re-key the base fields for the same reason: they read from the
    // columnar index, which an edit that did not land leaves exactly as it was,
    // so no value change remounts them and a typed number would stay on screen.
    setEditRefusals((at) => at + 1);
    // The viewport has already drawn the drag; left alone, the VOB would sit
    // where nothing else in the app agrees it is. Through `invertOp` rather
    // than by swapping `from` and `to` here: a rotation carries a box for each
    // pose, and swapping only the matrix is half an inverse.
    //
    // A barrier op is dropped rather than inverted, and needs no inverse here:
    // what this puts back is the viewport's *optimistic* draw of a gizmo drag,
    // and a delete is never drawn before the main process has taken it.
    setAppliedOps(ops.filter((op) => !isBarrierOp(op)).map(invertOp));
  }, [forgetClassProps, setAppliedOps]);

  /**
   * Whether a batch is out at the main process — the guard that makes a commit
   * one-at-a-time (`docs/plans/level-editor-review-2026-09-04.md` §2.7).
   *
   * Every builder reads `from` out of the columnar projection, and that
   * projection is only written once the round trip is back (`applied`). So two
   * commits overlapping is two ops built from the *same* `from`: a held arrow
   * key moved the VOB one step and recorded N identical undo entries, and the
   * second click of a double-click Duplicate built its `AddVob` against a path
   * the first had already taken, which the main process refused with an
   * internal message.
   *
   * A `ref` rather than state because it is read and written inside one
   * synchronous run of the handler, before React could re-render.
   */
  const commitInFlight = useRef(false);

  /** The commit itself, guarded by `commitOps` below — never called directly.
   *  @returns whether the world took the edit; false is a refusal, and the
   *   banner has already been set. */
  const sendOps = useCallback(async (ops: WorldOp[]): Promise<boolean> => {
    const { editFailed } = useWorldStore.getState();
    const generation = openGeneration.current;
    try {
      await window.editorAPI.applyWorldOps(ops);
    } catch (failure) {
      editFailed(failure instanceof Error ? failure.message : String(failure));
      putTheViewBack(ops);
      return false;
    }

    // **Past the commit point, and in its own try for that reason.** Everything
    // `applied` does is the renderer catching up with a world that has already
    // changed, and four of its steps can fail after the fact — `applyEdit`,
    // `applyWaypointPositions` and three IPC calls of its own. Inside the catch
    // above, any of them was reported as a refusal: the banner said the edit did
    // not happen, the viewport was handed `ops.map(invertOp)` and visibly undid
    // it, and the class fields were re-keyed — while the columns `applyEdit`
    // had already written stayed written and the main process went on holding
    // the op, on the undo stack and written on save. Three layers disagreeing
    // over an edit that did happen.
    //
    // So a failure here says exactly that, and puts nothing back. What is stale
    // is the *view*, and the way out of a stale view is to re-open the world —
    // not to pretend the world does not hold the edit.
    // Unless a world opened while the commit was out, in which case the edit
    // landed in a world this side is no longer showing: `applied` would write
    // its ops into the new world's columns and mark that world edited. The main
    // process drops the batch from the history for the same reason
    // (`WorldService.generation`), so the two stay in step by agreeing to
    // forget it rather than by one of them catching up.
    if (openGeneration.current !== generation) return true;

    try {
      await applied(ops);
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : String(failure);
      editFailed(`The edit was applied, but the view could not be brought up to date: ${reason}. Re-open the world to resync.`);
    }
    // The world holds the edit either way — a stale view is not a refusal, and
    // the message above says so.
    return true;
  }, [applied, putTheViewBack, openGeneration]);

  const commitOps = useCallback(async (ops: WorldOp[]): Promise<boolean> => {
    // Dropped, and silently: this is auto-repeat and double-clicks, so a banner
    // per dropped press would be noise about nothing the user did wrong. The
    // screen is put back for the same reason a refusal puts it back — the
    // viewport may already have drawn the gizmo drag that got here.
    if (commitInFlight.current) {
      putTheViewBack(ops);
      return false;
    }
    commitInFlight.current = true;
    // In a `finally`, and that is the point of the split: `sendOps` has three
    // exits, and one of them forgetting to clear the flag would wedge every
    // edit in the app for the rest of the session.
    try {
      return await sendOps(ops);
    } finally {
      commitInFlight.current = false;
    }
  }, [sendOps, putTheViewBack]);

  return { commitOps, runHistory, editRefusals };
}
