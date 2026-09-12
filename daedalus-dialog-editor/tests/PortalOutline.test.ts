/**
 * The portal polygon a Problems finding names, drawn (#222).
 *
 * A portal is the one thing the World surface can be asked to look at that it
 * cannot show: an invisible face inside merged draw groups, with no material
 * on screen and no row in the VOB index. So framing it is two halves —
 * flying there and drawing it — and this overlay owns both, answering the
 * caller what to frame off the geometry it has just drawn, so the camera and
 * the outline can never end up on different polygons.
 *
 * What is checkable without a GPU: that the ring it builds is the corners it
 * was given, what it answers for the camera, that a degenerate face draws
 * nothing, and that it takes no part in a pick.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { PortalOutline } from '../src/renderer/world/PortalOutline';

/** A wall quad in the plane x = 10, spanning y and z from 0 to 100. */
const WALL: Array<[number, number, number]> = [
  [10, 0, 0], [10, 100, 0], [10, 100, 100], [10, 0, 100],
];

const positionsOf = (outline: PortalOutline): number[] =>
  Array.from((outline.outline.geometry.getAttribute('position') as THREE.BufferAttribute).array);

describe('PortalOutline', () => {
  it('draws nothing until a finding is framed', () => {
    const outline = new PortalOutline();
    expect(outline.outline.visible).toBe(false);
    outline.dispose();
  });

  it('builds the ring out of the corners it was handed, in order and unconverted', () => {
    const outline = new PortalOutline();

    outline.show(WALL);

    // A LineLoop, so the closing edge is the primitive rather than a repeated
    // first corner — four corners are four vertices.
    expect(outline.outline).toBeInstanceOf(THREE.LineLoop);
    expect(positionsOf(outline)).toEqual([10, 0, 0, 10, 100, 0, 10, 100, 100, 10, 0, 100]);
    expect(outline.outline.visible).toBe(true);
    outline.dispose();
  });

  it('answers the centroid of the corners and the box around them', () => {
    const outline = new PortalOutline();

    expect(outline.show(WALL)).toEqual({
      at: [10, 50, 50],
      bounds: [10, 0, 0, 10, 100, 100],
    });
    outline.dispose();
  });

  it('takes the centroid of the corners, not of the bounding box', () => {
    // An L-shaped face — retail ships 7-gons and 12-gons. The box centre is
    // (50, 50) and sits off the polygon; the corner centroid does not.
    const outline = new PortalOutline();
    const lShape: Array<[number, number, number]> = [
      [0, 0, 0], [100, 0, 0], [100, 20, 0], [20, 20, 0], [20, 100, 0], [0, 100, 0],
    ];

    const framed = outline.show(lShape);

    expect(framed?.at[0]).toBeCloseTo(40);
    expect(framed?.at[1]).toBeCloseTo(40);
    expect(framed?.bounds).toEqual([0, 0, 0, 100, 100, 0]);
    outline.dispose();
  });

  it('draws nothing for a face with too few corners to be a polygon', () => {
    const outline = new PortalOutline();
    outline.show(WALL);

    expect(outline.show([[0, 0, 0], [1, 0, 0]])).toBeNull();

    // And puts away what it was drawing — a stale outline beside a jump that
    // did not happen is the locator lying about where it went.
    expect(outline.outline.visible).toBe(false);
    outline.dispose();
  });

  it('hides on demand, keeping the node reusable', () => {
    const outline = new PortalOutline();
    outline.show(WALL);

    outline.hide();
    expect(outline.outline.visible).toBe(false);

    outline.show(WALL);
    expect(outline.outline.visible).toBe(true);
    outline.dispose();
  });

  it('is an annotation: it is never picked and never occluded', () => {
    const outline = new PortalOutline();
    outline.show(WALL);

    // A raycast that found the outline would select it instead of the VOB
    // behind it, and the id pass the picker reads must not carry it.
    const hits: THREE.Intersection[] = [];
    outline.outline.raycast(new THREE.Raycaster(), hits);
    expect(hits).toEqual([]);

    // A portal sits inside solid geometry; an outline that respects depth is
    // an outline behind a wall, which is the picture the click was meant to fix.
    expect((outline.outline.material as THREE.LineBasicMaterial).depthTest).toBe(false);
    outline.dispose();
  });
});
