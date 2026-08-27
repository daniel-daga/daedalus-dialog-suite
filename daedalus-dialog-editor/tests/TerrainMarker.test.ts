/**
 * The terrain marker — the dot the placement bar's coordinates name.
 *
 * Scene-graph assertions, like `WaynetOverlay.test.ts`: the marker builds its
 * Three.js objects without a WebGLRenderer, so what would otherwise only be
 * visible in a picture is checkable here.
 *
 * The things that fail silently:
 *
 *   - the position must stay in ZenGin space. The marker hangs under the same
 *     mirrored root the world does (§7), so converting here puts the dot a
 *     hundred metres from the click — and on the wrong side of the world, since
 *     the root mirrors X.
 *   - it draws with `depthTest: false`, like the waynet, so it must not be
 *     pickable: a dot plainly on top that answers a click would steal every
 *     placement click from the terrain underneath it.
 *   - what it allocates must be released. The scene is rebuilt on every
 *     structural op, and a marker leaked per rebuild is a leak per placement.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { ROOT_MATRIX, zenToThree } from 'zen-world';
import { TerrainMarker } from '../src/renderer/world/TerrainMarker';

/** A click on the ground, ZenGin centimetres, deliberately not round. */
const POINT: [number, number, number] = [1500.5, -220, 3300.25];

/** The mirrored root the viewport hangs the marker under. */
function mirroredRoot(): THREE.Object3D {
  const root = new THREE.Object3D();
  root.matrixAutoUpdate = false;
  root.matrix.fromArray([...ROOT_MATRIX]);
  root.matrixWorldNeedsUpdate = true;
  return root;
}

describe('TerrainMarker', () => {
  it('draws at the picked point, converted by the scene root and nothing else', () => {
    const marker = new TerrainMarker(POINT);
    const root = mirroredRoot();
    root.add(marker.root);
    root.updateMatrixWorld(true);

    // Unconverted in its own space...
    const position = marker.point.geometry.getAttribute('position');
    expect([position.getX(0), position.getY(0), position.getZ(0)])
      .toEqual([POINT[0], POINT[1], POINT[2]]);

    // ...and exactly where `zenToThree` says once the root has had it. Metres,
    // and X flipped: a marker that skipped either is off by a factor of 100 or
    // is on the wrong side of the island.
    const drawn = new THREE.Vector3(POINT[0], POINT[1], POINT[2])
      .applyMatrix4(marker.point.matrixWorld);
    const expected = zenToThree(POINT);
    expect(drawn.x).toBeCloseTo(expected[0], 6);
    expect(drawn.y).toBeCloseTo(expected[1], 6);
    expect(drawn.z).toBeCloseTo(expected[2], 6);
  });

  it('is drawn through the terrain and at a fixed size, like the waynet', () => {
    // The point worth marking is routinely one the camera is looking down at
    // from far away, and one inside a building. Both of those hide a dot that
    // depth-tests or that shrinks with distance.
    const marker = new TerrainMarker(POINT);
    const material = marker.point.material as THREE.PointsMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.sizeAttenuation).toBe(false);
  });

  it('answers no raycast, so it cannot steal the click that placed it', () => {
    // A ray straight at the marker's own position in three space. The waynet is
    // picked before the VOBs precisely because `depthTest: false` puts it on
    // top; a marker that could be hit would be picked by the terrain raycast
    // and report itself instead of the ground.
    const marker = new TerrainMarker(POINT);
    const root = mirroredRoot();
    root.add(marker.root);
    root.updateMatrixWorld(true);

    const at = new THREE.Vector3(...zenToThree(POINT));
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 1000 };
    raycaster.set(at.clone().add(new THREE.Vector3(0, 100, 0)), new THREE.Vector3(0, -1, 0));

    expect(raycaster.intersectObject(marker.root, true)).toHaveLength(0);
  });

  it('releases what it allocated', () => {
    // The scene is rebuilt on every structural op, and this is built per pick:
    // whatever is not released here is leaked once per placement.
    const marker = new TerrainMarker(POINT);
    const geometry = jest.spyOn(marker.point.geometry, 'dispose');
    const material = jest.spyOn(marker.point.material as THREE.PointsMaterial, 'dispose');

    marker.dispose();

    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
    expect(marker.root.children).toHaveLength(0);
  });
});
