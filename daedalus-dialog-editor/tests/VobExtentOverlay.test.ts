/**
 * The sphere a sound or a light reaches (level-editor.md §16.39, #248).
 *
 * The marker layer (#247) draws where one of these VOBs stands; for this
 * family the reach IS the object, so a radius nobody can see leaves tuning a
 * sound a save-and-play loop. What is checkable without a GPU is where the
 * sphere is put, how big it is, which colour says what it is, and that it
 * never takes part in a pick.
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

    overlay.show([1200, -340, 5600], { radius: 3000, kind: 'sound' });

    expect(overlay.wireframe.visible).toBe(true);
    expect(overlay.wireframe.position.toArray()).toEqual([1200, -340, 5600]);
    // Scaled, not rebuilt: the geometry is a unit sphere.
    expect(overlay.wireframe.scale.toArray()).toEqual([3000, 3000, 3000]);
    overlay.dispose();
  });

  it('colours the sphere by what is reaching, as the marker under it is coloured', () => {
    const overlay = new VobExtentOverlay();
    const material = overlay.wireframe.material as THREE.LineBasicMaterial;

    overlay.show([0, 0, 0], { radius: 100, kind: 'sound' });
    expect(material.color.getHex()).toBe(EXTENT_COLORS.sound);

    overlay.show([0, 0, 0], { radius: 100, kind: 'light' });
    expect(material.color.getHex()).toBe(EXTENT_COLORS.light);
    expect(EXTENT_COLORS.sound).not.toBe(EXTENT_COLORS.light);
    overlay.dispose();
  });

  it('goes away when the selection has no radius to draw', () => {
    const overlay = new VobExtentOverlay();
    overlay.show([0, 0, 0], { radius: 100, kind: 'light' });

    overlay.hide();

    expect(overlay.wireframe.visible).toBe(false);
    overlay.dispose();
  });

  it('is an annotation and never answers a pick', () => {
    // A click has to reach the VOB inside the sphere, not the sphere.
    const overlay = new VobExtentOverlay();
    overlay.show([0, 0, 0], { radius: 5000, kind: 'sound' });
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
