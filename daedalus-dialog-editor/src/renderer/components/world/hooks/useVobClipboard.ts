import { useCallback, useRef, type MutableRefObject } from 'react';
import {
  duplicateVobSubtree,
  pasteVobs,
  topLevelVobs,
  vobAtIndexPath,
  vobIndexPath,
  type AddVob,
  type ReadProps,
  type VobReader,
  type VobSubtree,
  type WorldOp,
  type ZenBounds,
} from 'zen-world';
import { primaryVob, useWorldStore } from '../../../store/worldStore';
import { vobModelOf } from '../../../world/vobModel';

export interface VobClipboardInput {
  commitOps: (ops: WorldOp[]) => Promise<boolean>;
  /** A VOB's own visual bounds, for the offset a paste lands at. */
  boundsOf: (vob: number) => ZenBounds | null;
  readClassProps: (
    reader: VobReader, vobs: readonly number[],
  ) => Promise<(vob: number) => ReadProps | null>;
}

export interface VobClipboard {
  copySelection: () => Promise<void>;
  pasteClipboard: () => Promise<void>;
  /** Whether there is anything to paste. A function rather than state, because
   *  filling the clipboard changes nothing on screen and must not render: the
   *  menu reads it when it draws, which is the only moment it matters. */
  hasClipboard: () => boolean;
  /** The clipboard holds positions in the world it was copied from — pasting
   *  them into another world puts VOBs at coordinates nobody chose. A
   *  cross-world clipboard is not a feature anybody asked for. */
  clearClipboard: () => void;
}

/**
 * The clipboard copy and paste share (level-editor.md §16.14, D3).
 *
 * **The inputs arrive through a ref, not the call.** `WorldSurface` clears the
 * clipboard when a world opens, and `openWorldAt` is declared well above
 * `commitOps`, the bounds and the class-prop read — so passing those at the
 * call site would put the hook below the one place that needs `clearClipboard`.
 * Reading them at call time instead is the same late-binding `useStableHandlers`
 * does, and it makes every function here identity-stable besides.
 *
 * **In-process, and a `ref` rather than state**: nothing on screen changes
 * when it is filled, so a render would be for nothing, and it is deliberately
 * not the OS clipboard — a VOB subtree has no serialization anybody else reads,
 * and giving it one is the cross-world clipboard nobody has asked for.
 */
export function useVobClipboard(
  input: MutableRefObject<VobClipboardInput | null>,
): VobClipboard {
  const clipboard = useRef<VobSubtree[]>([]);

  /**
   * Copy the selection — the same subtrees a duplicate commits, read at the
   * copy and held as values.
   *
   * That is the whole difference between the two verbs. `duplicateVobs` reads a
   * VOB and appends it in one step, so it can only ever put a copy back beside
   * its original; here the reading happens now and the placing happens at the
   * paste, so the clipboard outlives the selection, and outlives the VOBs it
   * was read from being deleted. It loses exactly what a duplicate loses —
   * `physicsEnabled`, the class properties, and the class of an `oCItem` or of
   * anything `insertVob` cannot construct.
   */
  const copySelection = useCallback(async () => {
    const bound = input.current;
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (bound === null || current === null || selected.length === 0) return;
    const { boundsOf, readClassProps } = bound;

    const { reader } = vobModelOf(current);
    // Awaited before the clipboard is filled, so a copy is the fields the VOBs
    // had when Ctrl+C was pressed — the same instant the rest of the subtree is
    // read at, and the whole point of the clipboard being values.
    const classProps = await readClassProps(reader, selected);
    // Pruned as a duplicate's selection is, and for the same reason: a child
    // whose parent is also copied is already inside its parent's subtree.
    clipboard.current = topLevelVobs(reader, selected)
      .map((vob) => duplicateVobSubtree(reader, vob, boundsOf, classProps));
  }, [input]);

  /**
   * Paste the clipboard into the selection's own list — beside it, not inside
   * it — and into the roots when nothing is selected.
   *
   * The *root* of each copied subtree, that is: its descendants go under it,
   * wherever it landed.
   *
   * A sibling rather than a child because that is what makes a paste undo a
   * copy's place: the copy lands where the thing it was copied from lives. A
   * paste *into* the selected VOB is the other reading, and it is the one that
   * cannot be taken back by selecting something else — every VOB is somewhere's
   * child, so there would be no way to ask for a root.
   *
   * The clipboard is not consumed: pasting twice is two copies, as everywhere
   * else. And it is one batch of pure adds, so it is one undo entry — the same
   * relaxation `duplicateVobs` needed, for the same reason.
   */
  const pasteClipboard = useCallback(async () => {
    const bound = input.current;
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (bound === null || current === null || clipboard.current.length === 0) return;

    const { reader } = vobModelOf(current);
    const into = primaryVob(selected);
    const parent = into === null ? -1 : reader.columns.parent[into];
    const parentPath = parent < 0 ? null : vobIndexPath(reader, parent);
    const ops = pasteVobs(reader, clipboard.current, parent < 0 ? null : parent);

    if (!await bound.commitOps(ops)) return;

    // The copies, selected (§16.24 4) — a paste used to leave the *source*
    // selected, so the thing that had just landed could only be reached by
    // hunting for it in the scene tree.
    //
    // By path, and only after the re-read: the flat index an `AddVob` carries
    // is the enumeration as it was, and appending changes every index after the
    // insertion point. The roots of the paste are the ops whose parent is the
    // list the paste chose; a descendant's parent is its own root's new path.
    const { summary: after } = useWorldStore.getState();
    if (after === null) return;

    const refreshed = vobModelOf(after).reader;
    const pasted = ops
      .filter((op): op is AddVob => op.op === 'AddVob' && op.parentPath === parentPath)
      .map((op) => vobAtIndexPath(refreshed, op.path))
      .filter((vob): vob is number => vob !== null);

    if (pasted.length > 0) useWorldStore.getState().selectVobs(pasted);
  }, [input]);

  const hasClipboard = useCallback(() => clipboard.current.length > 0, []);
  const clearClipboard = useCallback(() => { clipboard.current = []; }, []);

  return { copySelection, pasteClipboard, hasClipboard, clearClipboard };
}
