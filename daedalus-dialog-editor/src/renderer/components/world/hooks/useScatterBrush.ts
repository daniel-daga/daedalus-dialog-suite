import { useCallback, useState, type RefObject } from 'react';
import {
  scatterVobs,
  strokeCandidates,
  topLevelVobs,
  type ReadProps,
  type ScatterPlacement,
  type VobReader,
  type WorldOp,
  type ZenBounds,
  type ZenPosition,
} from 'zen-world';
import { useWorldStore } from '../../../store/worldStore';
import { vobModelOf } from '../../../world/vobModel';

/**
 * The scatter brush's defaults and its cap, all in ZenGin centimetres
 * (level-editor.md §16.25).
 *
 * 8 m across with 2.5 m between trunks is a copse rather than a hedge, which is
 * the shape the tool was asked for — and both are fields, so the numbers only
 * have to be a sane place to start rather than right.
 *
 * **The cap is not a preference and is deliberately not a field.** A stroke is
 * one batch and therefore one undo entry, and neither §15's undo bar nor the
 * structural re-read (§16.24's two rebuilds per paste is the same machinery)
 * has ever been shown a batch this size, let alone the thousands one drag over
 * a hillside would otherwise produce. Raising it is a measurement somebody has
 * to make, not a number a user should be able to type.
 */
export const SCATTER_DEFAULT_RADIUS = 800;
export const SCATTER_DEFAULT_SPACING = 250;
export const SCATTER_LIMIT = 200;

/**
 * The smallest brush the tool will actually paint with, in cm.
 *
 * An emptied number field reads as `''`, and `Number('')` is 0 — so clearing
 * the box to type a new radius handed the viewport a ring of nothing and the
 * stroke a disc of nothing, which drops every candidate onto one point. Floored
 * here rather than in the field, so a half-typed number is still a number the
 * user can finish typing (§5.4 item 22 of the 2026-09-04 review). Spacing needs
 * no floor: zero spacing means "no minimum distance", which is a real answer.
 */
export const SCATTER_MIN_RADIUS = 1;

/** Just the one query the stroke asks the viewport, so the hook needs neither
 *  `WorldViewport` nor a scene to be tested. */
export interface ScatterRaycaster {
  raycastDown: (origin: ZenPosition) => { point: ZenPosition; normal: ZenPosition } | null;
}

export interface ScatterBrushInput {
  commitOps: (ops: WorldOp[]) => Promise<boolean>;
  /** A VOB's own visual bounds, for standing a copy on the ground it hit. */
  boundsOf: (vob: number) => ZenBounds | null;
  readClassProps: (
    reader: VobReader, vobs: readonly number[],
  ) => Promise<(vob: number) => ReadProps | null>;
  /**
   * The live viewport, as a ref rather than a value: a stroke is delivered from
   * outside React's render path, and the scene it was painted on can be torn
   * down between the mouse-up and this handler.
   */
  viewport: RefObject<ScatterRaycaster | null>;
}

export interface ScatterBrush {
  /** Whether the tool is armed, and the toolbar's toggle. */
  scatterOn: boolean;
  toggleScatter: () => void;
  /** The field values, unfloored — what the toolbar's two number inputs show. */
  scatterRadius: number;
  setScatterRadius: (radius: number) => void;
  scatterSpacing: number;
  setScatterSpacing: (spacing: number) => void;
  /**
   * The radius the viewport draws its ring at, and null for a brush that is not
   * live.
   *
   * The brush paints with the selection, so a pressed toggle over an empty
   * selection is a brush with nothing to place: it stays pressed — clearing a
   * selection mid-session should not silently turn the tool off — and goes
   * inert until something is selected again, which is the state the toolbar's
   * own hint names.
   */
  scatterBrushRadius: number | null;
  /** A finished stroke, as the pointer samples it walked over. */
  handleScatterStroke: (samples: Array<[number, number, number]>) => Promise<void>;
}

/**
 * The scatter brush (level-editor.md §16.25) — off until the toolbar toggle is
 * pressed, and **paints with the selection**: the palette is assembled by
 * selecting a handful of already-placed VOBs rather than from a typed name or a
 * stored blob, so there is nothing to persist and nothing to keep in sync with
 * a world that can be closed under it.
 *
 * Lifted out of `WorldSurface.tsx` — `docs/plans/level-editor-review-2026-09-04.md`
 * §4 names scatter as one of the nine concerns, and it is the narrowest of the
 * five that were left: it reaches the world through `commitOps` and the scene
 * through one downward raycast, and nothing else.
 */
export function useScatterBrush({
  commitOps,
  boundsOf,
  readClassProps,
  viewport,
}: ScatterBrushInput): ScatterBrush {
  const [scatterOn, setScatterOn] = useState(false);
  const [scatterRadius, setScatterRadius] = useState(SCATTER_DEFAULT_RADIUS);
  const [scatterSpacing, setScatterSpacing] = useState(SCATTER_DEFAULT_SPACING);
  /** A count rather than the array: the ring only asks whether the palette is
   *  empty, so subscribing to the selection itself would re-render the surface
   *  for every change of *which* VOBs are in it. */
  const selectionCount = useWorldStore((state) => state.selection.length);

  const brushRadius = Math.max(SCATTER_MIN_RADIUS, scatterRadius || SCATTER_MIN_RADIUS);

  /**
   * A finished brush stroke, committed as **one batch and therefore one undo
   * entry** — which is the whole reason the stroke is capped (§16.25, the
   * density decision): §15's undo bar and the structural re-read have never
   * been shown a batch of thousands, and a stroke over a hillside is one
   * gesture away from that.
   *
   * The three layers meet here. `strokeCandidates` says where to try, knowing
   * nothing of the world; each try is raycast **down from a candidate lifted by
   * the brush radius**, so a candidate that fell uphill of the cursor still
   * finds the ground above it rather than the inside of the slope; and
   * `scatterVobs` turns the survivors into ordinary `AddVob`s.
   *
   * A candidate that hits nothing is dropped, not refused — the brush is a
   * disc and the ground under it is not, so a stroke along a ridge legitimately
   * throws half its tries away. That is the same rule a drop-to-ground follows
   * for a VOB over the sky.
   */
  const handleScatterStroke = useCallback(async (
    samples: Array<[number, number, number]>,
  ) => {
    const { summary: current, selection, editFailed } = useWorldStore.getState();
    const live = viewport.current;
    if (current === null || live === null || selection.length === 0) return;
    // The viewport fires no stroke with a null radius, so this is belt and
    // braces — but a stroke is delivered from outside React's render path and
    // can outlive the toggle that allowed it, and what it would commit is 200
    // VOBs the user did not ask for.
    if (!scatterOn) return;

    const { reader } = vobModelOf(current);
    // Pruned as a duplicate prunes it: a member carries its own subtree, so a
    // parent and its child both selected would paint that child twice.
    const palette = topLevelVobs(reader, selection);
    if (palette.length === 0) return;

    const { candidates, capped } = strokeCandidates(
      samples,
      { radius: brushRadius, spacing: scatterSpacing, limit: SCATTER_LIMIT },
      palette.length,
      // The seed is the stroke's own: two strokes of the same shape should not
      // produce the same forest, and `strokeCandidates` is deterministic in it
      // so a stroke stays reproducible from the one number.
      Date.now() >>> 0,
    );

    const placements: ScatterPlacement[] = [];
    for (const candidate of candidates) {
      const hit = live.raycastDown([
        candidate.at[0], candidate.at[1] + brushRadius, candidate.at[2],
      ]);
      if (hit === null) continue;
      placements.push({
        source: palette[candidate.member],
        position: hit.point,
        normal: hit.normal,
        yaw: candidate.yaw,
      });
    }
    if (placements.length === 0) return;

    const classProps = await readClassProps(reader, palette);
    const committed = await commitOps(scatterVobs(reader, placements, boundsOf, classProps));
    // Said only for a stroke that landed: a refusal already has the banner, and
    // overwriting it with the cap would replace the reason with a footnote.
    if (committed && capped) {
      editFailed(`The stroke was capped at ${SCATTER_LIMIT} VOBs — one stroke is one undo entry. Paint it in several passes for more.`);
    }
  }, [commitOps, boundsOf, readClassProps, viewport, scatterOn, brushRadius, scatterSpacing]);

  const toggleScatter = useCallback(() => setScatterOn((on) => !on), []);

  return {
    scatterOn,
    toggleScatter,
    scatterRadius,
    setScatterRadius,
    scatterSpacing,
    setScatterSpacing,
    scatterBrushRadius: scatterOn && selectionCount > 0 ? brushRadius : null,
    handleScatterStroke,
  };
}
