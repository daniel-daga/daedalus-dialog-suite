/**
 * The markers for VOBs that have no visual at all (level-editor.md §16.38, #247).
 *
 * `buildInstancedVisuals` skips a VOB whose visual name is empty, which is
 * 15,749 of the 41,393 retail VOBs — every sound, light, zone, trigger, mover,
 * startpoint and spot. Nothing was drawn where they stand, so nothing could be
 * clicked and no gizmo could be attached. This layer is what draws them, and
 * the four things it has to get right are all checkable without a GPU:
 *
 *   - **which** VOBs it draws. A VOB with a visual is drawn by its instance and
 *     a marker on top of it would be a second thing in the same place; a decal
 *     or a `.PFX` *has* a name that resolves to no geometry, which is a
 *     different cause with a different answer (§16.40) and stays out of here.
 *   - the marker's colour, which is the only thing telling a sound from a
 *     trigger at 10 pixels.
 *   - a position that can be read back and written — the gizmo reads it on the
 *     press and the drag draws its preview through it.
 *   - the pick, in pixels after the projection, and the per-class hide the
 *     pick has to agree with: a class switched off is not drawn and must not be
 *     clickable either.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { vobIndex } from './worldFixtures';
import {
  MARKER_PICK_RADIUS, VobMarkerLayer, markerColorOf,
} from '../src/renderer/world/VobMarkerLayer';
import { NO_PICK } from '../src/renderer/world/pickIds';
import { markerDotTexture } from '../src/renderer/world/markerSprite';

/**
 * A camera looking down -Z at the origin, and the clip matrix the viewport
 * hands the pick. The real caller multiplies the mirrored root in as well —
 * the layer's positions are ZenGin centimetres — and the identity stands in
 * for it here, exactly as `pickWaypoint`'s own spec does.
 */
function clip(): THREE.Matrix4 {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
}

const SIZE = 400;

/** Where a point lands on a `SIZE`-square viewport, in pixels from top-left. */
function screenOf(point: readonly [number, number, number]): [number, number] {
  const v = new THREE.Vector4(point[0], point[1], point[2], 1).applyMatrix4(clip());
  return [((v.x / v.w) + 1) / 2 * SIZE, (1 - (v.y / v.w)) / 2 * SIZE];
}

/** The layer's drawn positions, as the pick and the GPU both read them. */
function drawnPositions(layer: VobMarkerLayer): number[] {
  const attribute = layer.markers.geometry.getAttribute('position');
  return [...(attribute.array as Float32Array).subarray(0, layer.drawn * 3)];
}

function drawnColors(layer: VobMarkerLayer): number[] {
  const attribute = layer.markers.geometry.getAttribute('color');
  return [...(attribute.array as Float32Array).subarray(0, layer.drawn * 3)];
}

/** `THREE.Color`'s channels for a hex colour, at the precision the attribute
 *  keeps them: a `Float32Array` rounds, so the doubles would not compare equal. */
function channels(hex: number): number[] {
  const color = new THREE.Color(hex);
  return [...Float32Array.of(color.r, color.g, color.b)];
}

describe('VobMarkerLayer', () => {
  it('draws one marker per VOB with no visual, and none for a VOB that has one', () => {
    // VOB 1 is a sound and VOB 3 a trigger — no visual name at all. VOB 0 is
    // drawn as an instance, and VOB 2 is a decal: it *has* a name, which
    // resolves to no geometry, and that is §16.40's case rather than this one.
    const layer = new VobMarkerLayer(vobIndex(
      [[0, 0, 0], [-3, 0, 0], [10, 20, 30], [3, 0, 0]],
      ['zCVob', 'zCVobSound', 'zCVob', 'zCTrigger'],
      undefined,
      undefined,
      ['BARREL.3DS', '', 'BLOOD.TGA', ''],
    ));

    expect(layer.drawn).toBe(2);
    expect(layer.markers.geometry.drawRange.count).toBe(2);
    expect(drawnPositions(layer)).toEqual([-3, 0, 0, 3, 0, 0]);
    // And the index positions are what it drew them at, not an origin.
    expect(layer.positionOf(1)).toEqual([-3, 0, 0]);
    expect(layer.positionOf(0)).toBeNull();
    expect(layer.positionOf(2)).toBeNull();
  });

  it('colours a marker by what its class is', () => {
    // A sound, a light and a zone are three different objects with three
    // different jobs, and the marker is the same 10 px dot for all of them —
    // so the colour is the whole of what tells them apart.
    expect(markerColorOf('zCVobSound')).toBe(markerColorOf('zCVobSoundDaytime'));
    expect(markerColorOf('zCVobSound')).not.toBe(markerColorOf('zCVobLight'));
    expect(markerColorOf('zCVobLight')).not.toBe(markerColorOf('zCZoneZFog'));
    expect(markerColorOf('zCTrigger')).toBe(markerColorOf('oCTriggerScript'));
    // A class the table has never heard of is still drawn: the table is a way
    // of reading the world, not a list of what the world may contain.
    expect(markerColorOf('zCSomethingNew')).toBe(markerColorOf('zCVob'));

    const layer = new VobMarkerLayer(vobIndex(
      [[-3, 0, 0], [3, 0, 0]],
      ['zCVobSound', 'zCVobLight'],
      undefined,
      undefined,
      ['', ''],
    ));

    expect(drawnColors(layer)).toEqual([
      ...channels(markerColorOf('zCVobSound')),
      ...channels(markerColorOf('zCVobLight')),
    ]);
  });

  it('moves a marker, and draws it where it was moved to', () => {
    // The gizmo's live preview: the world in the main process still has the VOB
    // where it was, and this is the drag being drawn. Both halves have to
    // follow — what `positionOf` answers on the next press, and the buffer the
    // GPU draws.
    const layer = new VobMarkerLayer(vobIndex(
      [[0, 0, 0], [-3, 0, 0]], 'zCVobSound', undefined, undefined, ['BARREL.3DS', ''],
    ));

    const attribute = layer.markers.geometry.getAttribute('position');
    const uploads = attribute.version;

    expect(layer.setPosition(1, [7, 8, 9])).toBe(true);
    expect(layer.positionOf(1)).toEqual([7, 8, 9]);
    expect(drawnPositions(layer)).toEqual([7, 8, 9]);
    // Flagged for upload, or the GPU keeps drawing what it was first handed.
    // `needsUpdate` is write-only on a `BufferAttribute`; the version it bumps
    // is what can be read back.
    expect(attribute.version).toBeGreaterThan(uploads);

    // A VOB this layer does not draw is refused rather than silently written:
    // the caller reads the answer as "is it drawn at all".
    expect(layer.setPosition(0, [1, 1, 1])).toBe(false);
  });

  it('picks the marker under the pointer and answers the VOB behind it', () => {
    const layer = new VobMarkerLayer(vobIndex(
      [[-3, 0, 0], [0, 0, 0], [3, 0, 0]], 'zCVobSound', undefined, undefined, ['', '', ''],
    ));
    const [x, y] = screenOf([3, 0, 0]);

    expect(layer.pick(clip(), x, y, SIZE, SIZE)).toBe(2);
    // A miss is `NO_PICK`, which is what the click path already reads as
    // "nothing here" — and is not VOB 0, an ordinary VOB like any other.
    expect(layer.pick(clip(), x + 200, y, SIZE, SIZE)).toBe(NO_PICK);
    expect(NO_PICK).not.toBe(0);
    // In pixels, so the radius means the same thing at every distance.
    expect(layer.pick(clip(), x + MARKER_PICK_RADIUS - 1, y, SIZE, SIZE)).toBe(2);
  });

  it('neither draws nor picks a VOB the class filter has switched off', () => {
    // Consequence 4 of §16.38: hiding `zCVobSound` from the view controls used
    // to hide nothing, because nothing was drawn — and the class was offered in
    // the list all the same. The pick has to agree with the picture, the same
    // way the instanced pick pass reads the same hidden flag the draw does.
    const layer = new VobMarkerLayer(vobIndex(
      [[-3, 0, 0], [3, 0, 0]], ['zCVobSound', 'zCVobLight'], undefined, undefined, ['', ''],
    ));
    const [x, y] = screenOf([-3, 0, 0]);

    layer.setHidden(Uint8Array.from([1, 0]));

    expect(layer.drawn).toBe(1);
    expect(drawnPositions(layer)).toEqual([3, 0, 0]);
    expect(layer.pick(clip(), x, y, SIZE, SIZE)).toBe(NO_PICK);
    // Still known, still selectable from the scene tree — hidden is not gone.
    expect(layer.positionOf(0)).toEqual([-3, 0, 0]);

    layer.setHidden(null);
    expect(layer.drawn).toBe(2);
    expect(layer.pick(clip(), x, y, SIZE, SIZE)).toBe(0);
  });

  it('draws at a fixed pixel size, over whatever is in front of it', () => {
    const layer = new VobMarkerLayer(vobIndex([[0, 0, 0]], 'zCVobSound', undefined, undefined, ['']));
    const material = layer.markers.material as THREE.PointsMaterial;

    // Pixels rather than world units: a sound has no size, and a marker that
    // shrank with distance would be invisible from the viewpoint that shows the
    // world — which is also why the pick is done in pixels.
    expect(material.sizeAttenuation).toBe(false);
    // A sound inside a building is exactly the one worth looking at.
    expect(material.depthTest).toBe(false);
    // The layer is never culled, so the loose bounding sphere over the whole
    // attribute is never tested (`SpawnOverlay` says the same).
    expect(layer.markers.frustumCulled).toBe(false);
  });

  it('draws the shared pip, and disposes its own buffers rather than that', () => {
    const layer = new VobMarkerLayer(vobIndex([[0, 0, 0]], 'zCVobSound', undefined, undefined, ['']));
    const material = layer.markers.material as THREE.PointsMaterial;
    const { geometry } = layer.markers;

    // The app's one pip, shared with the spawn markers: built per layer it
    // would be a fresh GPU upload on every scene rebuild — see `markerSprite`.
    expect(material.map).toBe(markerDotTexture());

    const geometryDisposed = jest.spyOn(geometry, 'dispose');
    const materialDisposed = jest.spyOn(material, 'dispose');
    const mapDisposed = jest.spyOn(material.map, 'dispose');

    layer.dispose();

    expect(geometryDisposed).toHaveBeenCalled();
    expect(materialDisposed).toHaveBeenCalled();
    // Disposing it here would blank the spawn markers as well.
    expect(mapDisposed).not.toHaveBeenCalled();
  });
});
