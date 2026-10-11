import * as THREE from 'three';
import { threeToZen, zenToThree, type ZenPosition } from 'zen-world';
import { navFor } from './cameraNav';
import { ScatterRing } from './ScatterRing';

// The scatter brush (level-editor.md §16.25), lifted out of `WorldViewport`'s
// one big effect (#220).
//
// It was ~140 lines of closure inside a 1,310-line effect, which is why the
// review found a dead raycaster here two days after it shipped: the brush could
// only be reached through a mocked viewport, so nothing could say in one
// assertion that a press starts a stroke. As a class it is a unit test — the
// meshes, the camera and the gizmo arrive as accessors, and a spec hands it a
// real triangle and a real press.
//
// The left button is free for this: `attachBlenderNav` maps LEFT to null, so
// nothing here has to fight OrbitControls for it, and the only other thing a
// left press can land on is a gizmo axis. That one is real — the palette *is*
// the selection, so the gizmo is standing exactly where the user is about to
// paint — and it is settled the way a nav press settles it, by switching the
// gizmo off for the length of the stroke.
//
// What the brush emits is where the cursor went and nothing else. It does not
// know the palette, the spacing or the seed; `WorldSurface` turns a stroke into
// candidates, raycasts them and commits the batch.

export interface ScatterBrushOptions {
  /** Where the press is caught, ahead of the gizmo and the picker. */
  host: HTMLElement;
  /** The canvas: the rect a pointer is measured against, and what captures it. */
  canvas: HTMLElement;
  camera: THREE.Camera;
  /** The scene's converted root — the ring's positions are written in it. */
  root: THREE.Object3D;
  /** Read per ray, not captured: a structural op replaces the world's meshes. */
  worldMeshes: () => THREE.Object3D[];
  /** The brush radius in ZenGin centimetres, or null while the brush is off. */
  radius: () => number | null;
  /** True while a walk owns the pointer — a walk's press is not a stroke. */
  walking: () => boolean;
  /** The gizmo, switched off for the length of a stroke and put back after. */
  gizmo: { enabled: boolean };
  onStroke: (samples: readonly ZenPosition[]) => void;
}

export class ScatterBrush {
  private readonly ring = new ScatterRing();
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();

  /** The stroke in hand, or null when the button is up. */
  private stroke: ZenPosition[] | null = null;
  /** Consumed by the click that ends a stroke, exactly as `endedDrag` is. */
  private painted = false;
  private gizmoBeforeStroke: boolean | null = null;

  constructor(private readonly options: ScatterBrushOptions) {
    this.raycaster.firstHitOnly = true;
    // The world mesh draws on `WORLD_LAYER`, and a raycaster only meets what it
    // shares a layer with. Without this every `intersectObjects` below returns
    // nothing, no press starts a stroke, and the brush is inert — which is
    // exactly how it shipped once (review §3.1).
    this.raycaster.layers.enableAll();
    options.root.add(this.ring.root);
  }

  /** Whether the click now arriving is the tail of a stroke, and clears it —
   *  a click that selected whatever the stroke painted with would make a
   *  second stroke impossible. */
  consumePainted(): boolean {
    if (!this.painted) return false;
    this.painted = false;
    return true;
  }

  /** Hide the footprint — the brush has been switched off. */
  hide(): void {
    this.ring.hide();
  }

  attach(): void {
    this.options.host.addEventListener('pointerdown', this.onDown, { capture: true });
    // On the window rather than the host: a stroke that runs off the edge of
    // the canvas and comes back is one stroke, and a button released outside it
    // still has to commit what was painted.
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp, { capture: true });
    window.addEventListener('pointercancel', this.onUp, { capture: true });
  }

  dispose(): void {
    this.options.host.removeEventListener('pointerdown', this.onDown, { capture: true });
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp, { capture: true });
    window.removeEventListener('pointercancel', this.onUp, { capture: true });
    this.options.root.remove(this.ring.root);
    this.ring.dispose();
  }

  /** What is under the cursor, in ZenGin space — the same conversion
   *  `raycastDown` makes, against the same meshes. */
  private hitAt(event: PointerEvent): { point: ZenPosition; normal: ZenPosition } | null {
    const rect = this.options.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.options.camera);
    return this.hit();
  }

  /** The nearest world-mesh hit for the ray as it stands, converted. */
  private hit(): { point: ZenPosition; normal: ZenPosition } | null {
    const hit = this.raycaster.intersectObjects(this.options.worldMeshes(), false)[0];
    if (!hit || !hit.face) return null;

    const normal = hit.face.normal.clone()
      .transformDirection(hit.object.matrixWorld).normalize();
    return {
      point: threeToZen(hit.point.toArray() as ZenPosition),
      normal: threeToZen(normal.toArray() as ZenPosition),
    };
  }

  /**
   * The ground at a horizontal position, for the ring's drape — the same
   * downward ray a placement makes, so the ring predicts rather than decorates.
   *
   * It starts a radius above the cursor's own height for the reason the
   * placements do: a vertex uphill of the cursor has its ground *above* the
   * cursor, and a ray from the cursor's height would pass through the inside of
   * the slope and report the far side of the hill.
   */
  private ground(from: number, lift: number) {
    return (x: number, z: number) => {
      const origin = zenToThree([x, from + lift, z]);
      this.raycaster.set(
        new THREE.Vector3(...origin),
        new THREE.Vector3(...zenToThree([0, -1, 0])).normalize(),
      );
      const hit = this.hit();
      return hit === null ? null : { y: hit.point[1], normal: hit.normal };
    };
  }

  private readonly onDown = (event: PointerEvent) => {
    if (this.options.radius() === null || this.options.walking()) return;
    // Alt+left is the emulated middle button, so a modified press is a
    // navigation and never a stroke — the brush must not take the one gesture
    // a trackpad orbits with.
    if (event.button !== 0 || navFor(event) !== 'none') return;

    const hit = this.hitAt(event);
    if (hit === null) return;

    this.stroke = [hit.point];
    this.painted = true;
    this.gizmoBeforeStroke = this.options.gizmo.enabled;
    this.options.gizmo.enabled = false;
    // Ahead of the gizmo and the picker, both of which listen on the canvas.
    event.stopPropagation();
    this.options.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent) => {
    const radius = this.options.radius();
    if (radius === null) return;

    const hit = this.hitAt(event);
    if (hit === null) {
      // Off the mesh: no footprint to show, and a stale ring would be a lie
      // about where a press would land. The stroke itself is not ended — a
      // cursor crossing the sky between two hillsides is one stroke.
      this.ring.hide();
      return;
    }

    this.ring.moveTo(hit.point, hit.normal, radius, this.ground(hit.point[1], radius));
    if (this.stroke !== null) {
      this.stroke.push(hit.point);
      event.stopPropagation();
    }
  };

  private readonly onUp = (event: PointerEvent) => {
    if (this.stroke === null) return;
    const samples = this.stroke;
    this.stroke = null;
    if (this.gizmoBeforeStroke !== null) {
      this.options.gizmo.enabled = this.gizmoBeforeStroke;
      this.gizmoBeforeStroke = null;
    }
    event.stopPropagation();
    if (this.options.canvas.hasPointerCapture(event.pointerId)) {
      this.options.canvas.releasePointerCapture(event.pointerId);
    }
    this.options.onStroke(samples);
  };
}
