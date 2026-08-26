/**
 * GPU ID-picking codec (level-editor.md §3, result 1). Measured, a CPU raycast
 * across the instanced VOBs costs 14.2 ms p50 and blows the one-frame pick
 * budget on its own, so the props are picked by rendering their ids to a pixel
 * and reading it back. This file is that pixel's encoding — the half that is
 * pure arithmetic and therefore the half worth testing, because an off-by-one
 * here selects the wrong barrel and nothing anywhere reports a problem.
 *
 * @jest-environment node
 */

import { PICK_ID_MAX, decodePickId, encodePickId, NO_PICK } from '../src/renderer/world/pickIds';

describe('pick ids', () => {
  test('every id in range survives the round trip through 8-bit channels', () => {
    // A float channel that does not land exactly on n/255 comes back as a
    // neighbouring id — the failure mode is "the click selected the next
    // object along", which reads as a UI bug rather than an encoding one.
    for (const id of [1, 2, 3, 254, 255, 256, 257, 65535, 65536, 12463, 23288, PICK_ID_MAX]) {
      const rgb = encodePickId(id);
      expect(decodePickId(Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)))
        .toBe(id);
    }
  });

  test('an exhaustive sweep of the low ids round-trips', () => {
    for (let id = 1; id <= 4096; id++) {
      const rgb = encodePickId(id);
      const bytes = rgb.map((c) => Math.round(c * 255));
      expect(decodePickId(bytes[0], bytes[1], bytes[2])).toBe(id);
    }
  });

  test('black is "nothing was hit", and is not a valid id', () => {
    // The pick buffer is cleared to black, so the background must not decode to
    // a real VOB — VOB index 0 is a perfectly ordinary VOB.
    expect(decodePickId(0, 0, 0)).toBe(NO_PICK);
    expect(encodePickId(0)).not.toEqual([0, 0, 0]);
  });

  test('the id space covers a retail world with room to spare', () => {
    // NewWorld has 23,288 VOBs; 24 bits is 16.7M.
    expect(PICK_ID_MAX).toBeGreaterThan(23288);
  });

  test('an id beyond the encodable range is refused rather than wrapped', () => {
    // Wrapping would silently alias a high VOB onto a low one.
    expect(() => encodePickId(PICK_ID_MAX + 1)).toThrow();
    expect(() => encodePickId(-1)).toThrow();
  });

  test('channels stay inside the 0..1 range a colour attribute allows', () => {
    for (const id of [1, 255, 65535, PICK_ID_MAX]) {
      for (const channel of encodePickId(id)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});
