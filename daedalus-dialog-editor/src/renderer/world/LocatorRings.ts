import * as THREE from 'three';
import type { LocatorItem } from './itemLocator';
import { markerReticleTexture } from './markerSprite';

// The rings the Item Locator draws (#417) — one per match, in the same ZenGin
// centimetres everything else in the scene is in.
//
// **Why a sprite and not a circle on the ground.** What the locator is for is an
// item lost *inside* geometry, so the ring has to be visible through whatever
// hides the item: `depthTest: false`, like the faint marker pass. And it has to
// be the same size at 3,000 units as at 30, which a world-space circle is not —
// `VobMarkerLayer` draws its pips in pixels for exactly this reason, and the
// reticle tile of the app's shared sprite atlas already is a ring with a centre
// dot: the ring says "look here", the dot says "this is the thing".
//
// **Two colours, one draw call.** `bad` — an instance the loaded project does
// not declare, which the property grid would refuse — is red; everything else
// is the locator's own amber. Same buffer, per-vertex colour, the way the marker
// layer colours 15,749 pips by class.
//
// The radius is a *filter*, not a shape: the layer is handed every item the
// name and "bad only" switches kept, and `setView` compacts the ones inside the
// camera's sphere out of them each frame the camera moves — the same structure
// `VobMarkerLayer.setView` uses, and for the same reason (a live radius with no
// React render behind it).

/** Pixels: larger than a marker pip, because a ring has to read as one. */
export const LOCATOR_RING_SIZE = 26;

const BAD = 0xff1744;
const OK = 0x40c4ff;

export class LocatorRings {
  /** Add this under the scene's converted root, not under the scene — as
   *  `WorldScene` does with every overlay. */
  readonly points: THREE.Points;

  private items: readonly LocatorItem[] = [];
  /** Every candidate's position, whether or not it is drawn — ZenGin
   *  centimetres, a copy of what the locator list carries. */
  private source = new Float32Array(0);
  private colors = new Float32Array(0);
  /** Which slot is drawn where, or -1 for one outside the radius. */
  private drawnAt = new Int32Array(0);
  private drawn: number[] = [];
  private enabled = false;
  private camera = new THREE.Vector3();
  private radius = 0;
  /** Only ever grows: a search narrows the list, and replacing the attributes
   *  on every keystroke would orphan a GPU buffer each time. */
  private capacity = 0;

  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.PointsMaterial;

  constructor() {
    this.material = new THREE.PointsMaterial({
      size: LOCATOR_RING_SIZE,
      // Pixels, not world units — see the header.
      sizeAttenuation: false,
      map: markerReticleTexture(),
      vertexColors: true,
      transparent: true,
      alphaTest: 0.1,
      depthTest: false,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    // Above the marker layer's 13: a locator ring is the thing being looked
    // for, and it is asked to be seen through everything.
    this.points.renderOrder = 14;
    this.points.matrixAutoUpdate = false;
    this.points.frustumCulled = false;
    this.points.raycast = () => undefined;
  }

  /** Every candidate the filters left, and nothing is drawn until asked. */
  setItems(items: readonly LocatorItem[]): void {
    this.items = items;
    this.source = new Float32Array(items.length * 3);
    this.colors = new Float32Array(items.length * 3);
    this.drawnAt = new Int32Array(items.length).fill(-1);

    const color = new THREE.Color();
    items.forEach((item, slot) => {
      this.source[slot * 3] = item.at[0];
      this.source[slot * 3 + 1] = item.at[1];
      this.source[slot * 3 + 2] = item.at[2];
      color.set(item.bad ? BAD : OK);
      this.colors[slot * 3] = color.r;
      this.colors[slot * 3 + 1] = color.g;
      this.colors[slot * 3 + 2] = color.b;
    });

    if (items.length > this.capacity) {
      this.capacity = items.length;
      this.geometry.setAttribute(
        'position', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3),
      );
      this.geometry.setAttribute(
        'color', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3),
      );
    }

    this.setView(this.enabled, [this.camera.x, this.camera.y, this.camera.z], this.radius, true);
  }

  /** Radius and camera are in ZenGin centimetres; zero draws nothing. */
  setView(
    enabled: boolean,
    camera: readonly [number, number, number],
    radiusCm: number,
    force = false,
  ): void {
    if (!force && this.enabled === enabled && this.radius === radiusCm
      && this.camera.x === camera[0] && this.camera.y === camera[1] && this.camera.z === camera[2]) {
      return;
    }
    this.enabled = enabled;
    this.camera.set(...camera);
    this.radius = radiusCm;

    const positions = this.geometry.getAttribute('position');
    const colors = this.geometry.getAttribute('color');
    if (!positions || !colors) return;
    const positionTarget = positions.array as Float32Array;
    const colorTarget = colors.array as Float32Array;
    const reach = this.radius ** 2;

    let changed = false;
    this.drawn = [];
    for (let slot = 0; slot < this.items.length; slot++) {
      const was = this.drawnAt[slot];
      const distanceSquared = (this.source[slot * 3] - this.camera.x) ** 2
        + (this.source[slot * 3 + 1] - this.camera.y) ** 2
        + (this.source[slot * 3 + 2] - this.camera.z) ** 2;
      if (!this.enabled || this.radius <= 0 || distanceSquared > reach) {
        this.drawnAt[slot] = -1;
        if (was !== -1) changed = true;
        continue;
      }

      const at = this.drawn.length;
      this.drawnAt[slot] = at;
      if (was !== at) changed = true;
      positionTarget[at * 3] = this.source[slot * 3];
      positionTarget[at * 3 + 1] = this.source[slot * 3 + 1];
      positionTarget[at * 3 + 2] = this.source[slot * 3 + 2];
      colorTarget[at * 3] = this.colors[slot * 3];
      colorTarget[at * 3 + 1] = this.colors[slot * 3 + 1];
      colorTarget[at * 3 + 2] = this.colors[slot * 3 + 2];
      this.drawn.push(this.items[slot].vob);
    }

    if (changed) {
      positions.needsUpdate = true;
      colors.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, this.drawn.length);
  }

  /** The VOBs rings are drawn for, in the order they are drawn — what the
   *  debug handle reports, and what the scene has no other way to say. */
  get vobs(): readonly number[] {
    return this.drawn;
  }

  dispose(): void {
    this.geometry.dispose();
    // Not its `map`: the atlas is shared with every other marker layer.
    this.material.dispose();
  }
}
