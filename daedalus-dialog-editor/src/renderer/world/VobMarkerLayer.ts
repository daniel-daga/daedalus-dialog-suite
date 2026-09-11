import * as THREE from 'three';
import type { VobIndex } from '../../shared/worldTypes';
import { markerDotTexture } from './markerSprite';
import { NO_PICK } from './pickIds';
import { NO_POINT, pickPoint } from './pickWaypoint';

// The VOBs with no visual, drawn (level-editor.md §7 — "The VOBs with no
// visual, drawn"; carded as plan §16.38, closed by #247).
//
// `buildInstancedVisuals` opens its loop with `if (name === '') continue`, and
// that one line is **15,749 of the 41,393 retail VOBs, 38.0 %** — every sound,
// light, zone, trigger, mover, code master, message filter, touch-damage
// volume, startpoint and spot. None of them had an instance, so nothing was
// drawn where they stand, `VobPicker` had no pixel to write for them, and the
// gizmo detached even for one selected in the scene tree: placing a sound was
// typing three coordinates.
//
// A marker needs no new data. `VobIndex` already carries a position and a class
// for every VOB in the world, `markerSprite` already builds the rimmed pip, and
// `SpawnOverlay` already draws a `THREE.Points` layer of them — so this is a
// buffer and one draw call, with no binding change, no IPC, no worker op and
// nothing that touches the `.zen` file.
//
// Three decisions in it are load-bearing:
//
//   - **which VOBs.** Everything that resolves to no geometry, which is two
//     causes rather than one. An empty visual name is what "this VOB has no
//     visual" is on disk. A `.TGA` or a `.PFX` is a *name* that resolves to no
//     geometry, which was a different answer (§16.40, #249) and now shares this
//     one: the decal is drawn as itself, as a quad, and the particle effect is
//     not drawn at all — but both still need a handle, and the pick, the gizmo
//     and `positionOf` all come through here. The quad is the picture and the
//     pip at its centre is the handle.
//   - **the colour is the whole of what tells two markers apart.** One shape at
//     one size for all of them, and a class table for the colour: a sound, a
//     trigger volume and a startpoint are three unrelated objects and the dot
//     alone says nothing about which is which.
//   - **it draws only what the class filter left on**, and hands the pick only
//     that. Hiding `zCVobSound` used to hide nothing because nothing was drawn
//     (§16.38 consequence 4); a layer that drew regardless would swap that for
//     a marker that cannot be switched off.
//
// It hangs under the same mirrored root the world mesh, the VOBs, the waynet and
// the spawn markers do, so the positions stay exactly as the index holds them —
// ZenGin centimetres, unconverted.

/** How big a marker is drawn, in **pixels**. Between the waynet's 3.5 and the
 *  spawn layer's 11: there are five times as many of these as waypoints, so a
 *  spawn marker's size would read as one mass with the whole world in frame. */
export const MARKER_SIZE = 9;

/** How near the pointer has to be, in pixels — wider than the dot, because a
 *  dot is hard to hit exactly. `WAYPOINT_PICK_RADIUS`'s reasoning exactly. */
export const MARKER_PICK_RADIUS = 9;

// The colours, by what the class *is*. Kept clear of the waynet's blue, orange
// and green and of the spawn layer's pink, because a marker and a waypoint are
// drawn in the same place whenever a startpoint stands on one.
const SOUND = 0x00e5ff;
const LIGHT = 0xffe082;
const ZONE = 0xb388ff;
/** The trigger family, the movers and the two logic classes: what a designer
 *  places to make something *happen*, as against something that is there. */
const TRIGGER = 0xff5252;
/** A startpoint or a spot: a named place, and nothing else. */
const POINT = 0x76ff03;
/** Everything else, a bare `zCVob` included. */
const OTHER = 0xcfd8dc;
/** A decal — its quad says where it is and how big; the pip is the handle. */
const DECAL = 0xffab91;
/** A particle effect: a `.PFX` is a Daedalus script, so the pip is all there is. */
const PARTICLE = 0xea80fc;

/**
 * The visual types that resolve to no geometry, and so are drawn by nobody
 * else. Exactly the two `buildInstancedVisuals` counts into `unresolvedByType`
 * on every retail world — 1,932 decals and 1,391 particle effects across the
 * three of them.
 */
const UNDRAWABLE_VISUALS = new Set(['DECAL', 'PARTICLE_EFFECT']);

const MARKER_COLORS = new Map<string, number>([
  ['zCVobSound', SOUND],
  ['zCVobSoundDaytime', SOUND],
  ['zCVobLight', LIGHT],
  // The `…Default` variants are a world's own fallback fog, far plane and
  // music rather than something a designer placed — one object each, and
  // coloured with the zones they are the default for.
  ['zCZoneZFog', ZONE],
  ['zCZoneZFogDefault', ZONE],
  ['oCZoneMusic', ZONE],
  ['oCZoneMusicDefault', ZONE],
  ['zCZoneVobFarPlane', ZONE],
  ['zCZoneVobFarPlaneDefault', ZONE],
  ['zCTrigger', TRIGGER],
  ['zCTriggerList', TRIGGER],
  ['zCTriggerWorldStart', TRIGGER],
  ['zCTriggerUntouch', TRIGGER],
  ['oCTriggerScript', TRIGGER],
  ['oCTriggerChangeLevel', TRIGGER],
  ['zCMover', TRIGGER],
  ['oCTouchDamage', TRIGGER],
  ['zCCodeMaster', TRIGGER],
  ['zCMessageFilter', TRIGGER],
  ['zCVobStartpoint', POINT],
  ['zCVobSpot', POINT],
]);

/**
 * What colour a class's markers are drawn in.
 *
 * A `Map` rather than an object literal, so a class named `constructor` or
 * `toString` cannot answer with something off `Object.prototype` — the hazard
 * `vobClasses.ts` guards by hand for the same reason.
 *
 * A class the table has never heard of still gets a marker. The table is a way
 * of reading a world, not a list of what a world is allowed to contain: a mod's
 * own class, or one nobody has catalogued yet, is exactly the object somebody
 * needs to find.
 */
export function markerColorOf(className: string, visualType?: string): number {
  // The visual wins where there is one, because the class does not say: every
  // retail decal sits on a plain `zCVob`, so colouring those by class would
  // make 1,932 of them the same grey as everything uncatalogued.
  if (visualType === 'DECAL') return DECAL;
  if (visualType === 'PARTICLE_EFFECT') return PARTICLE;
  return MARKER_COLORS.get(className) ?? OTHER;
}

export class VobMarkerLayer {
  /**
   * Add this under the scene's converted root, not under the scene — `WorldScene`
   * does, and owns it.
   */
  readonly markers: THREE.Points;

  /** Every VOB this layer has a marker for, in the order it holds them. */
  private readonly vobs: Uint32Array;
  /** Which slot a VOB's marker is, or -1. A `Map` rather than a column over the
   *  whole index: the markers are 38 % of it and this is asked per press, per
   *  drag frame and per pick. */
  private readonly slots = new Map<number, number>();
  /** Every marker's position, whether or not it is currently drawn — three
   *  floats each, ZenGin centimetres, a copy of the index's own column exactly
   *  as an instance matrix is. `setHidden` compacts the drawn ones out of it. */
  private readonly source: Float32Array;
  /** Every marker's colour, the same way, so the compaction can carry it. */
  private readonly colors: Float32Array;
  /** Which slot is drawn where, or -1 for a marker the filter switched off —
   *  what makes a live drag's write O(1) rather than a scan of the drawn set. */
  private readonly drawnAt: Int32Array;
  /** The VOB behind each drawn marker: a pick answers a slot in this. */
  private drawnVobs: number[] = [];

  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.PointsMaterial;

  constructor(index: VobIndex) {
    const positions = new Float32Array(index.positions);
    const classIndex = new Uint32Array(index.classIndex);
    const visualIndex = new Uint32Array(index.visualIndex);

    const visualTypeIndex = new Uint32Array(index.visualTypeIndex);
    const markered: number[] = [];
    for (let vob = 0; vob < index.count; vob++) {
      // The criterion is "nothing else draws this VOB". An empty name is the
      // line `buildInstancedVisuals` skips on; the two visual types below are
      // the ones it counts into `unresolvedByType` on every retail world,
      // because a texture and a particle script are not geometry.
      const name = index.visuals[visualIndex[vob]];
      if (name !== '' && !UNDRAWABLE_VISUALS.has(index.visualTypes[visualTypeIndex[vob]])) continue;
      markered.push(vob);
    }

    this.vobs = Uint32Array.from(markered);
    this.source = new Float32Array(this.vobs.length * 3);
    this.colors = new Float32Array(this.vobs.length * 3);
    this.drawnAt = new Int32Array(this.vobs.length).fill(-1);

    const color = new THREE.Color();
    this.vobs.forEach((vob, slot) => {
      this.slots.set(vob, slot);
      this.source[slot * 3] = positions[vob * 3];
      this.source[slot * 3 + 1] = positions[vob * 3 + 1];
      this.source[slot * 3 + 2] = positions[vob * 3 + 2];
      color.set(markerColorOf(
        index.classes[classIndex[vob]], index.visualTypes[visualTypeIndex[vob]],
      ));
      this.colors[slot * 3] = color.r;
      this.colors[slot * 3 + 1] = color.g;
      this.colors[slot * 3 + 2] = color.b;
    });

    // Allocated at the marker count — an upper bound on the drawn set, since
    // hiding only ever removes — and drawn as a range inside it. Replacing the
    // attribute per filter change instead would orphan its GPU buffer each
    // time, which is `SpawnOverlay`'s reason as well.
    this.geometry.setAttribute(
      'position', new THREE.BufferAttribute(new Float32Array(this.vobs.length * 3), 3),
    );
    this.geometry.setAttribute(
      'color', new THREE.BufferAttribute(new Float32Array(this.vobs.length * 3), 3),
    );

    this.material = new THREE.PointsMaterial({
      size: MARKER_SIZE,
      // Pixels, not world units: a sound has no size, and a marker that shrank
      // with distance would be invisible from the viewpoint that shows the
      // world. It is also what makes the pick a pixel one — see `pickPoint`.
      sizeAttenuation: false,
      // Per marker, from the class table. One layer and one draw call for all
      // of them; a layer per colour would be six.
      vertexColors: true,
      // A rimmed round pip rather than the flat square `PointsMaterial` draws
      // by default: a marker sits over terrain of any brightness, and the black
      // rim is what keeps it readable over the bright half. Shared and never
      // disposed here — see `markerSprite`.
      map: markerDotTexture(),
      // The pip is transparent to its corners, and two markers a few pixels
      // apart are the ordinary case: without this the nearer one's empty
      // corners blend the far one away.
      alphaTest: 0.1,
      // A sound inside a building is exactly the one worth looking at, and the
      // waynet and the spawn layer are drawn on the same terms.
      depthTest: false,
      transparent: true,
    });

    this.markers = new THREE.Points(this.geometry, this.material);
    // Above the waynet's 10 and the spawn layer's 11: a marker is a thing,
    // where a waypoint is a place, and the thing is what a click means to hit.
    this.markers.renderOrder = 12;
    this.markers.matrixAutoUpdate = false;
    this.markers.frustumCulled = false;
    // Nothing raycasts an overlay: the pick is `pickPoint` in pixels, and a
    // stray hit here would only ever be a bug in something else's cast.
    this.markers.raycast = () => undefined;

    this.setHidden(null);
  }

  /** How many markers exist at all — a VOB per markerless VOB in the world. */
  get count(): number {
    return this.vobs.length;
  }

  /** How many are drawn right now: `count` less whatever the class filter is
   *  hiding. */
  get drawn(): number {
    return this.drawnVobs.length;
  }

  /**
   * Where a VOB's marker is, in ZenGin centimetres — or null for a VOB this
   * layer does not draw.
   *
   * Answered for a *hidden* marker too, which is deliberate: hiding a class is
   * a view setting, and the VOB is still in the index, still listed in the scene
   * tree and still selectable from it, exactly as a hidden instance is.
   */
  positionOf(vob: number): [number, number, number] | null {
    const slot = this.slots.get(vob);
    if (slot === undefined) return null;
    return [this.source[slot * 3], this.source[slot * 3 + 1], this.source[slot * 3 + 2]];
  }

  /**
   * Draw a VOB's marker somewhere else, and say whether there was one.
   *
   * Both halves are written: `source`, which is what `positionOf` answers and
   * what the next filter change compacts from, and the drawn buffer, which is
   * what the GPU reads. That is the live preview of a drag — the world in the
   * main process still has the VOB where it was — and it is also how a
   * committed move, an undo and a redo reach the marker, since all four arrive
   * through `WorldScene.moveVob`.
   */
  setPosition(vob: number, to: readonly [number, number, number]): boolean {
    const slot = this.slots.get(vob);
    if (slot === undefined) return false;

    this.source[slot * 3] = to[0];
    this.source[slot * 3 + 1] = to[1];
    this.source[slot * 3 + 2] = to[2];

    const drawn = this.drawnAt[slot];
    if (drawn === -1) return true;

    const attribute = this.geometry.getAttribute('position');
    const target = attribute.array as Float32Array;
    target[drawn * 3] = to[0];
    target[drawn * 3 + 1] = to[1];
    target[drawn * 3 + 2] = to[2];
    attribute.needsUpdate = true;
    return true;
  }

  /**
   * Which VOBs not to draw: one byte per VOB, 1 for hidden — the mask
   * `WorldScene.setHiddenVobs` takes, which is the scene tree's own predicate
   * (`matchVobs`). Null draws every marker.
   *
   * The drawn markers are *compacted* to the front of the buffer rather than
   * flagged in place, because a `THREE.Points` layer has no per-vertex "skip"
   * — the instanced meshes push a hidden instance out of the clip volume in the
   * vertex shader, and there is no shader of ours here. The compaction is what
   * makes the pick agree with the picture for free: it is handed the drawn
   * range and nothing else.
   */
  setHidden(hidden: Uint8Array | null): void {
    const positions = this.geometry.getAttribute('position');
    const colors = this.geometry.getAttribute('color');
    const positionTarget = positions.array as Float32Array;
    const colorTarget = colors.array as Float32Array;

    this.drawnVobs = [];
    for (let slot = 0; slot < this.vobs.length; slot++) {
      const vob = this.vobs[slot];
      if (hidden !== null && vob < hidden.length && hidden[vob] !== 0) {
        this.drawnAt[slot] = -1;
        continue;
      }

      const at = this.drawnVobs.length;
      this.drawnAt[slot] = at;
      positionTarget[at * 3] = this.source[slot * 3];
      positionTarget[at * 3 + 1] = this.source[slot * 3 + 1];
      positionTarget[at * 3 + 2] = this.source[slot * 3 + 2];
      colorTarget[at * 3] = this.colors[slot * 3];
      colorTarget[at * 3 + 1] = this.colors[slot * 3 + 1];
      colorTarget[at * 3 + 2] = this.colors[slot * 3 + 2];
      this.drawnVobs.push(vob);
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;
    this.geometry.setDrawRange(0, this.drawnVobs.length);
    // Fitted over the whole attribute rather than the drawn range — `three` has
    // no range-aware form — so the slots past the range make it loose. Harmless
    // here and only here: this layer sets `frustumCulled = false`, so nothing
    // ever tests the sphere. `SpawnOverlay` says the same.
    this.geometry.computeBoundingSphere();
  }

  /**
   * The VOB whose marker is under the pointer, or `NO_PICK`.
   *
   * In pixels after the projection, for the reason `pickPoint` gives: the layer
   * draws with `sizeAttenuation: false`, so a world-unit threshold is wrong at
   * every distance. Only the *drawn* markers are offered, so a class the view
   * controls have switched off is not clickable either — which is the same rule
   * the instanced pick pass follows by reading the hidden flag the draw reads.
   *
   * `toClip` is projection × view × the scene root's matrix, and `x`/`y` are
   * pixels from the top-left of the canvas.
   */
  pick(
    toClip: THREE.Matrix4,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number = MARKER_PICK_RADIUS,
  ): number {
    const drawn = (this.geometry.getAttribute('position').array as Float32Array)
      .subarray(0, this.drawnVobs.length * 3);
    const at = pickPoint(drawn, toClip, x, y, width, height, radius);
    return at === NO_POINT ? NO_PICK : this.drawnVobs[at];
  }

  dispose(): void {
    this.geometry.dispose();
    // Not its `map`: that is the app's one pip, shared with the spawn markers.
    // `Material.dispose` leaves a texture alone.
    this.material.dispose();
  }
}
