/**
 * The volume a VOB is (level-editor.md §16.39, #248).
 *
 * The marker layer (#247) draws where one of these VOBs stands; for this
 * family the reach IS the object, so a radius nobody can see leaves tuning a
 * sound a save-and-play loop, and a zone is worse — a music zone's marker says
 * nothing at all about where the music starts.
 *
 * Two shapes, and the second half of the split is that a box **carries its own
 * position**: a radius is a length around the VOB, a bounding box is already in
 * world space. What is checkable without a GPU is where each is put, how big it
 * is, which colour says what it is, and that neither takes part in a pick.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { EXTENT_COLORS, VobExtentOverlay } from '../src/renderer/world/VobExtentOverlay';

describe('VobExtentOverlay', () => {
  it('draws nothing until something with a radius is selected', () => {
    const overlay = new VobExtentOverlay();
    expect(overlay.wireframe.visible).toBe(false);
    overlay.dispose();
  });

  it("puts the sphere at the VOB and scales it to the field's own centimetres", () => {
    const overlay = new VobExtentOverlay();

    overlay.show([1200, -340, 5600], { shape: 'sphere', radius: 3000, kind: 'sound' });

    expect(overlay.wireframe.visible).toBe(true);
    expect(overlay.wireframe.position.toArray()).toEqual([1200, -340, 5600]);
    // Scaled, not rebuilt: the geometry is a unit sphere.
    expect(overlay.wireframe.scale.toArray()).toEqual([3000, 3000, 3000]);
    overlay.dispose();
  });

  it("draws a light's sphere in the light's own colour (#248)", () => {
    // The other half of what a light is. Unlike the two extents it is a tint
    // rather than a shape, so it rides the wireframe that is already drawn.
    const overlay = new VobExtentOverlay();
    const material = overlay.wireframe.material as THREE.LineBasicMaterial;

    overlay.show([0, 0, 0], {
      shape: 'sphere', radius: 800, kind: 'light', color: [255, 160, 60],
    });

    // Through sRGB, as every other authored colour in this scene is read.
    expect(material.color.getHex(THREE.SRGBColorSpace)).toBe(0xffa03c);
    expect(material.color.getHex()).not.toBe(EXTENT_COLORS.light);
    overlay.dispose();
  });

  it('falls back to the palette for a light with no usable colour', () => {
    // `vobExtentOf` drops a colour that is missing, malformed or black; what
    // reaches here is an extent with no `color`, and the sphere is then the
    // yellow it was before #248 rather than nothing.
    const overlay = new VobExtentOverlay();
    const material = overlay.wireframe.material as THREE.LineBasicMaterial;

    overlay.show([0, 0, 0], { shape: 'sphere', radius: 800, kind: 'light' });

    expect(material.color.getHex()).toBe(EXTENT_COLORS.light);
    overlay.dispose();
  });

  it('takes the tint off again when the next selection has none', () => {
    // One material is reused across selections, so a colour left behind would
    // paint the next light — or the next sound — in the last one's tint.
    const overlay = new VobExtentOverlay();
    const material = overlay.wireframe.material as THREE.LineBasicMaterial;

    overlay.show([0, 0, 0], { shape: 'sphere', radius: 800, kind: 'light', color: [255, 0, 0] });
    overlay.show([0, 0, 0], { shape: 'sphere', radius: 800, kind: 'light' });

    expect(material.color.getHex()).toBe(EXTENT_COLORS.light);
    overlay.dispose();
  });

  it('colours the sphere by what is reaching, as the marker under it is coloured', () => {
    const overlay = new VobExtentOverlay();
    const material = overlay.wireframe.material as THREE.LineBasicMaterial;

    overlay.show([0, 0, 0], { shape: 'sphere', radius: 100, kind: 'sound' });
    expect(material.color.getHex()).toBe(EXTENT_COLORS.sound);

    overlay.show([0, 0, 0], { shape: 'sphere', radius: 100, kind: 'light' });
    expect(material.color.getHex()).toBe(EXTENT_COLORS.light);
    expect(EXTENT_COLORS.sound).not.toBe(EXTENT_COLORS.light);
    overlay.dispose();
  });

  it('goes away when the selection has no radius to draw', () => {
    const overlay = new VobExtentOverlay();
    overlay.show([0, 0, 0], { shape: 'sphere', radius: 100, kind: 'light' });

    overlay.hide();

    expect(overlay.wireframe.visible).toBe(false);
    overlay.dispose();
  });

  it('is an annotation and never answers a pick', () => {
    // A click has to reach the VOB inside the sphere, not the sphere.
    const overlay = new VobExtentOverlay();
    overlay.show([0, 0, 0], { shape: 'sphere', radius: 5000, kind: 'sound' });
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 20000), new THREE.Vector3(0, 0, -1));
    const hits: THREE.Intersection[] = [];

    overlay.wireframe.raycast(raycaster, hits);

    expect(hits).toEqual([]);
    overlay.dispose();
  });

  // The box half (#248). A zone's or a trigger's volume is its bounding box,
  // which arrives from the per-selection `getVobProps` read rather than from
  // the columnar index — the index has no column for one.
  it('puts a box at the bbox centre and scales it to the half extents', () => {
    const overlay = new VobExtentOverlay();

    // 200 × 400 × 100 about (0, 200, 0).
    overlay.show([9999, 9999, 9999], {
      shape: 'box', kind: 'zone', bbox: [-100, 0, -50, 100, 400, 50],
    });

    expect(overlay.wireframe.visible).toBe(true);
    // The position it was handed is the *VOB's*, and a box does not use it: the
    // six numbers are already world space, so a box drawn at the VOB would sit
    // wherever the VOB's origin happens to be inside its own volume.
    expect(overlay.wireframe.position.toArray()).toEqual([0, 200, 0]);
    expect(overlay.wireframe.scale.toArray()).toEqual([100, 200, 50]);
    overlay.dispose();
  });

  it('draws an ellipsoid with the sphere geometry, inscribed in the same box', () => {
    // `oCZoneMusic.ellipsoid` makes one box mean two shapes, so the difference
    // is the geometry and nothing else — same centre, same half extents.
    const overlay = new VobExtentOverlay();
    const bbox = [-100, 0, -50, 100, 400, 50];

    overlay.show([0, 0, 0], { shape: 'box', kind: 'zone', bbox });
    const boxGeometry = overlay.wireframe.geometry;
    const boxPose = [overlay.wireframe.position.toArray(), overlay.wireframe.scale.toArray()];

    overlay.show([0, 0, 0], { shape: 'ellipsoid', kind: 'zone', bbox });

    expect(overlay.wireframe.geometry).not.toBe(boxGeometry);
    expect([overlay.wireframe.position.toArray(), overlay.wireframe.scale.toArray()])
      .toEqual(boxPose);
    // The sphere's own geometry, scaled unevenly — which is what an ellipsoid is.
    expect(overlay.wireframe.geometry.getAttribute('position').count % 3).toBe(0);
    overlay.dispose();
  });

  it('colours a zone and a trigger apart, and as their markers are coloured', () => {
    const overlay = new VobExtentOverlay();
    const material = overlay.wireframe.material as THREE.LineBasicMaterial;
    const bbox = [0, 0, 0, 10, 10, 10];

    overlay.show([0, 0, 0], { shape: 'box', kind: 'zone', bbox });
    expect(material.color.getHex()).toBe(EXTENT_COLORS.zone);

    overlay.show([0, 0, 0], { shape: 'box', kind: 'trigger', bbox });
    expect(material.color.getHex()).toBe(EXTENT_COLORS.trigger);
    expect(EXTENT_COLORS.zone).not.toBe(EXTENT_COLORS.trigger);
    overlay.dispose();
  });

  it('goes back to the sphere after a box, and both are one node', () => {
    // One `LineSegments` with two geometries rather than two nodes: the scene
    // attaches and detaches exactly one child, and a stale second node left in
    // the graph is the bug that shape avoids.
    const overlay = new VobExtentOverlay();

    overlay.show([0, 0, 0], { shape: 'box', kind: 'trigger', bbox: [0, 0, 0, 10, 10, 10] });
    overlay.show([5, 5, 5], { shape: 'sphere', kind: 'light', radius: 700 });

    expect(overlay.wireframe.position.toArray()).toEqual([5, 5, 5]);
    expect(overlay.wireframe.scale.toArray()).toEqual([700, 700, 700]);
    overlay.dispose();
  });

  it('never answers a pick as a box either', () => {
    const overlay = new VobExtentOverlay();
    overlay.show([0, 0, 0], {
      shape: 'box', kind: 'trigger', bbox: [-5000, -5000, -5000, 5000, 5000, 5000],
    });
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 20000), new THREE.Vector3(0, 0, -1));
    const hits: THREE.Intersection[] = [];

    overlay.wireframe.raycast(raycaster, hits);

    expect(hits).toEqual([]);
    overlay.dispose();
  });

  it('draws three orthogonal circles, so it reads as a sphere from any angle', () => {
    // One circle reads as a disc from the wrong angle. The three are built in
    // order — XY, then XZ, then YZ — so each third is flat in the axis the
    // circle does not spin in, and every vertex is on the unit sphere.
    const overlay = new VobExtentOverlay();
    const position = overlay.wireframe.geometry.getAttribute('position');
    const third = position.count / 3;
    const flatAxis: Array<'x' | 'y' | 'z'> = ['z', 'y', 'x'];
    const at = new THREE.Vector3();

    for (let i = 0; i < position.count; i += 1) {
      at.fromBufferAttribute(position, i);
      expect(at.length()).toBeCloseTo(1);
      expect(at[flatAxis[Math.floor(i / third)]]).toBe(0);
    }
    overlay.dispose();
  });
});
