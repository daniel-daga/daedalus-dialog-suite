import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { ScatterRing } from '../src/renderer/world/ScatterRing';

/**
 * The scatter brush's cursor (level-editor.md §16.25).
 *
 * It is the tool's only feedback — the stroke commits on mouse-up and shows
 * nothing before then — so what it claims about where the brush reaches has to
 * be true. It is draped over the mesh by a raycast per vertex rather than drawn
 * as a flat disc, and these are the three things that costs: the ring has to
 * follow the ground, it has to stay closed where there is no ground, and it has
 * to be lifted off whatever surface it lands on.
 *
 * No WebGL: a `LineLoop`'s vertices are a buffer, and asserting on the buffer is
 * asserting on the thing the GPU would draw.
 */

/** The vertices the ring is currently drawn from, as triples. */
function vertices(ring: ScatterRing): Array<[number, number, number]> {
  const mesh = ring.root.children[0] as THREE.LineLoop;
  const position = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const out: Array<[number, number, number]> = [];
  for (let at = 0; at < position.count; at++) {
    out.push([position.getX(at), position.getY(at), position.getZ(at)]);
  }
  return out;
}

const FLAT = () => ({ y: 0, normal: [0, 1, 0] as [number, number, number] });
const UP: [number, number, number] = [0, 1, 0];

describe('the ring', () => {
  it('is hidden until it is moved somewhere', () => {
    const ring = new ScatterRing();

    expect((ring.root.children[0] as THREE.LineLoop).visible).toBe(false);
    ring.dispose();
  });

  it('lays its vertices on a circle of the brush radius, around the cursor', () => {
    const ring = new ScatterRing();
    ring.moveTo([1000, 0, 2000], UP, 500, FLAT);

    for (const [x, , z] of vertices(ring)) {
      // The ground plane distance, which is what the radius means — the lift is
      // vertical here and does not enter it.
      expect(Math.hypot(x - 1000, z - 2000)).toBeCloseTo(500);
    }
    ring.dispose();
  });

  it('follows the ground rather than lying in one plane', () => {
    // A slope running with X: a flat disc would put every vertex at the
    // cursor's height, which is the defect the drape exists to fix.
    const ring = new ScatterRing();
    ring.moveTo([0, 0, 0], UP, 500, (x) => ({ y: x, normal: UP }));

    const heights = vertices(ring).map(([, y]) => y);
    expect(Math.max(...heights) - Math.min(...heights)).toBeCloseTo(1000);
    ring.dispose();
  });

  it('lifts each vertex off the surface it landed on', () => {
    const ring = new ScatterRing();
    ring.moveTo([0, 0, 0], UP, 500, FLAT);

    // Above the ground the ray reported, or the line z-fights it.
    for (const [, y] of vertices(ring)) expect(y).toBeGreaterThan(0);
    ring.dispose();
  });

  it('lifts along the surface normal, not always straight up', () => {
    // A vertical wall: the lift has to come out along +X, or the line is buried
    // in the face it is drawn on.
    const ring = new ScatterRing();
    const wall = [1, 0, 0] as [number, number, number];
    ring.moveTo([0, 0, 0], UP, 500, () => ({ y: 0, normal: wall }));

    for (const [x, , z] of vertices(ring)) {
      // Each vertex is its circle point plus the lift along +X, so it is off
      // the circle by exactly the lift in that direction.
      expect(Math.hypot(x, z)).not.toBeCloseTo(500);
    }
    ring.dispose();
  });

  it('stays closed where a segment finds no ground', () => {
    // Half the ring over a hole. A broken loop reads as a rendering fault; the
    // honest reading is "the brush reaches here and there is nothing under it".
    const ring = new ScatterRing();
    ring.moveTo([0, 900, 0], UP, 500, (x) => (x > 0 ? FLAT() : null));

    const drawn = vertices(ring);
    expect(drawn).toHaveLength(48);
    expect(drawn.every(([x, y, z]) => Number.isFinite(x) && Number.isFinite(y)
      && Number.isFinite(z))).toBe(true);
    // The missing half falls back to the cursor's own height, not to zero.
    expect(drawn.some(([, y]) => y > 900)).toBe(true);
  });

  it('re-drapes in place on a second move, allocating no new buffer', () => {
    // It runs on a pointermove, so a fresh buffer per frame is the one thing it
    // must not do.
    const ring = new ScatterRing();
    const mesh = ring.root.children[0] as THREE.LineLoop;
    ring.moveTo([0, 0, 0], UP, 500, FLAT);
    const buffer = mesh.geometry.attributes.position;

    ring.moveTo([5000, 0, 5000], UP, 500, FLAT);

    expect(mesh.geometry.attributes.position).toBe(buffer);
    for (const [x, , z] of vertices(ring)) {
      expect(Math.hypot(x - 5000, z - 5000)).toBeCloseTo(500);
    }
    ring.dispose();
  });

  it('hides again when the cursor leaves the mesh', () => {
    const ring = new ScatterRing();
    ring.moveTo([0, 0, 0], UP, 500, FLAT);
    ring.hide();

    expect((ring.root.children[0] as THREE.LineLoop).visible).toBe(false);
    ring.dispose();
  });

  it('never answers a raycast, so it cannot eat the pick that places through it', () => {
    const ring = new ScatterRing();
    const mesh = ring.root.children[0] as THREE.LineLoop;
    const hits: THREE.Intersection[] = [];

    mesh.raycast(new THREE.Raycaster(), hits);

    expect(hits).toEqual([]);
    ring.dispose();
  });
});
