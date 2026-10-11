// GPU ID-picking codec (level-editor.md §3, result 1).
//
// §3 originally offered GPU ID-picking as an *alternative* to a BVH. Measured
// on the real scene it is neither an alternative nor optional: the BVH answers
// the 476k-triangle world mesh in 0.2 ms, while a CPU raycast across the
// instanced VOBs costs 14.2 ms p50 — over the one-frame budget by itself,
// before anything else in the frame. So the props are picked by drawing their
// ids into one pixel and reading it back.
//
// Ids are shifted by one so that a *cleared* pick buffer — black — decodes to
// "nothing", rather than to VOB 0, which is an ordinary VOB like any other.

/** Black means nothing was hit. */
export const NO_PICK = -1;

/** 24 bits across three 8-bit channels, minus the reserved zero. NewWorld has
 *  23,288 VOBs, so the headroom is three orders of magnitude. */
export const PICK_ID_MAX = 0xffffff - 1;

/** An id as an RGB colour in 0..1, for an instanced colour attribute. */
export function encodePickId(id: number): [number, number, number] {
  if (!Number.isInteger(id) || id < 0 || id > PICK_ID_MAX) {
    throw new RangeError(`pick id ${id} is outside 0..${PICK_ID_MAX}`);
  }
  const shifted = id + 1;
  return [
    ((shifted >>> 16) & 0xff) / 255,
    ((shifted >>> 8) & 0xff) / 255,
    (shifted & 0xff) / 255,
  ];
}

/** Three bytes read back from the pick target, as an id — or `NO_PICK`. */
export function decodePickId(r: number, g: number, b: number): number {
  const shifted = (r << 16) | (g << 8) | b;
  return shifted === 0 ? NO_PICK : shifted - 1;
}
