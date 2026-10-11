/**
 * The marker sprites — what the world's point markers draw instead of the bare
 * square `PointsMaterial` gives them by default.
 *
 * A sprite is a picture, and a picture is exactly what a test cannot look at.
 * What it can do is read the texels back, which is enough to catch the three
 * ways this fails silently:
 *
 *   - the mask must be **white where the marker is inked and black where it is
 *     rimmed**. `map` is multiplied into the material colour, so a rim that is
 *     not black takes the marker's colour too and the contrast that makes a dot
 *     readable over bright terrain is gone.
 *   - the corners must be fully transparent. A sprite opaque to its edge is the
 *     square this exists to replace.
 *   - the textures are **shared**, one per shape for the whole app. Every
 *     marker layer disposes its own material; a texture built per layer would
 *     be a GPU upload per placement click.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { markerDotTexture, markerReticleTexture } from '../src/renderer/world/markerSprite';

/** A texel on the +x axis at `radius`, where 1 is the sprite's edge. */
function sample(texture: THREE.DataTexture, radius: number): { value: number; alpha: number } {
  const { width, height, data } = texture.image as { width: number; height: number; data: Uint8Array };
  const half = width / 2;
  const x = Math.min(width - 1, Math.floor(half + radius * half));
  const y = Math.floor(height / 2);
  const at = (y * width + x) * 4;
  return { value: data[at], alpha: data[at + 3] };
}

describe('marker sprites', () => {
  it('inks the dot white and rims it black, on a transparent field', () => {
    const dot = markerDotTexture();

    // The ink: white, so the material colour survives the multiply intact.
    expect(sample(dot, 0)).toEqual({ value: 255, alpha: 255 });
    // The rim: opaque and black, which is the contrast against bright terrain.
    const rim = sample(dot, 0.72);
    expect(rim.alpha).toBe(255);
    expect(rim.value).toBeLessThan(32);
    // The corner of the sprite — a square here is the square being replaced.
    expect(sample(dot, 0.99).alpha).toBe(0);
  });

  it('draws the reticle as a centre dot inside a ring, with a gap between', () => {
    const reticle = markerReticleTexture();

    expect(sample(reticle, 0)).toEqual({ value: 255, alpha: 255 });
    // The gap: the point being marked has to stay visible through its own marker.
    expect(sample(reticle, 0.38).alpha).toBe(0);
    // The ring itself, and its black rim just outside it.
    expect(sample(reticle, 0.69)).toEqual({ value: 255, alpha: 255 });
    const rim = sample(reticle, 0.85);
    expect(rim.alpha).toBe(255);
    expect(rim.value).toBeLessThan(32);
    expect(sample(reticle, 0.99).alpha).toBe(0);
  });

  it('builds each shape once and hands the same texture out again', () => {
    expect(markerDotTexture()).toBe(markerDotTexture());
    expect(markerReticleTexture()).toBe(markerReticleTexture());
    expect(markerDotTexture()).not.toBe(markerReticleTexture());
  });
});
