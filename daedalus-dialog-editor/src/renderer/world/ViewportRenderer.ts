import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VobOutline } from './VobOutline';

// Everything in the viewport that belongs to the *mount* rather than to a
// payload (#220, review §4 — and the rest of §3.2's fix).
//
// A structural op cannot be applied to the columnar projection, so the scene is
// rebuilt from the world (level-editor.md §7). The effect that did that used to
// build the renderer with it: a new `WebGLRenderer`, a new canvas, a new
// outline pass and new controls per placement. `WebGLRenderer.dispose()` does
// not release the GL context — only `forceContextLoss` does — and the texture
// cache is deliberately kept, so the old context sat on its uploads until the
// detached canvas was collected, while the new one re-uploaded all 490 textures
// and the 31 MB mesh and recompiled every program. That is the 53-276 ms
// shader-compile cost §3 of the plan moved off the first click, paid again per
// placement, against a browser cap of about sixteen live contexts. Keying the
// effect on the bbox's value removed the *duplicate* rebuild; this removes the
// rebuild.
//
// So what is here is what a structural op must not touch: the context, the
// canvas the whole pointer story is bound to, the outline pass and its render
// target, and the camera and its controls — which is also why the view a
// placement was aimed from now survives it as a plain fact rather than as a
// pose saved and restored around the teardown.
//
// The scene is here for the same reason the renderer is, and holds nothing of
// its own: `SceneHost` hangs the world's mirrored root under it per payload and
// takes it back off, and the gizmo does the same with its helper.

export class ViewportRenderer {
  /** The top level, for the outline pass and the gizmo helper: the world's own
   *  root carries a 0.01 scale and a mirror, and handles under it would be
   *  unusable. */
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  // No `scene.background`: the outline pass owns every clear of the frame, and
  // a Scene with a background forces one of its own. The sky is its.
  readonly outline = new VobOutline(0x10141c);
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  /**
   * Picking the world mesh, shared by everything that casts a ray: the
   * navigation pivot on every press, `PickController` when a click hit no
   * waypoint and no prop, the fly and walk probes, and the measurement handle.
   */
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();

  private readonly resize: ResizeObserver;

  constructor(private readonly host: HTMLElement) {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height);
    this.outline.setSize(width, height);
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, width / height, 0.5, 4000);

    this.raycaster.firstHitOnly = true;
    // The world mesh draws on `WORLD_LAYER` (the outline pass draws the frame
    // in two halves), and a raycaster only meets what it shares a layer with.
    this.raycaster.layers.enableAll();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // No damping: the camera stops when the drag stops. Three's default coast
    // reads as the viewport lagging the hand, and neither Spacer nor Blender —
    // the two sets of hands this is aimed at — coasts. The gizmo's own damping
    // (`DampedTransformControls`) is a separate rate and is not this.
    this.controls.enableDamping = false;

    this.resize = new ResizeObserver(() => { this.setSize(); });
    this.resize.observe(host);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** One frame of whatever is in the scene, through the outline pass — which
   *  owns the clear, the mask and the two halves of the frame. */
  render(): void {
    this.outline.render(this.renderer, this.scene, this.camera);
  }

  /**
   * Point the camera at a world it has not looked at yet — its own bounds,
   * which `extractWorldMesh` computes from the vertices it emitted because
   * every retail `zCMesh` stores that box as all zeros.
   *
   * Only for a world the camera has never been in: a rebuild of the same world
   * must leave the view exactly where the placement was aimed from, and here
   * that costs nothing, because nothing tore the camera down.
   */
  frameWorld(centre: readonly number[], span: number): void {
    this.camera.position.set(
      centre[0] + span * 0.6, centre[1] + span * 0.35, centre[2] + span * 0.6,
    );
    this.controls.target.set(centre[0], centre[1], centre[2]);
  }

  private setSize(): void {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height);
    this.outline.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.resize.disconnect();
    this.controls.dispose();
    this.outline.dispose();
    this.renderer.dispose();
    this.host.removeChild(this.renderer.domElement);
  }
}
