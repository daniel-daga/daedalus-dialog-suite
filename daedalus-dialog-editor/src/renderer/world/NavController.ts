import * as THREE from 'three';
import { pivotAt } from './cameraNav';
import { isTypingOrInPopover } from './keyboardTarget';
import { cameraSlotFor, type CameraSlotOutcome, type CameraSlots } from './cameraSlots';
import { Fly, flyMoveFor, flySpeedFor, pivotAhead } from './flyNav';
import { Walk, walkMoveFor, findWalkEntry, WALK_EXIT_PIVOT_DISTANCE } from './walkNav';

// Moving the camera (level-editor.md §16.26 row 3), lifted out of
// `WorldViewport`'s one big effect (#220).
//
// `flyNav`, `walkNav` and `cameraSlots` are the navigations themselves; this is
// the wiring around them, which is where every rule that was only reachable
// through a mocked viewport lived:
//
//   - **which of them owns the camera on a frame.** OrbitControls re-aims at
//     its target on every `update()`, so while a fly or a walk is writing the
//     camera the draw loop must step that instead — `step()` says whether it
//     did, and the loop calls `controls.update()` only when it did not.
//   - **what a mode switch takes and gives back.** A fly is a press-scoped
//     hold and takes only the controls; a walk is a long-lived mode and also
//     stands the gizmo down, so what it switched off is snapshotted and handed
//     back exactly rather than guessed at.
//   - **where the pivot ends up.** Both navigations move the camera without
//     OrbitControls, so both have to re-seat the pivot on the way out or the
//     next orbit snaps the view back to wherever it was.
//   - **which keys the surface never sees**, because a navigation took them.
//
// The two are mutually exclusive by construction — each entry refuses while
// the other is in hand — because both write `camera.position` every frame.

export interface NavControllerOptions {
  /** The viewport element. The fly's press is captured here, ahead of
   *  OrbitControls and the gizmo, for the ordering reason `attachBlenderNav`
   *  gives. */
  host: HTMLElement;
  /** The renderer's canvas — the element a walk locks the pointer to. */
  canvas: HTMLElement;
  camera: THREE.PerspectiveCamera;
  /** OrbitControls: both navigations take it for the length of their gesture,
   *  and both write `target` on the way out. */
  controls: { enabled: boolean; target: THREE.Vector3; update: () => void };
  /** The gizmo, which a walk stands down: a mode that hides the cursor must
   *  not leave draggable handles under it. */
  gizmo: { enabled: boolean; helperVisible: boolean };
  /** The viewport's own world-mesh raycaster and pointer, shared rather than
   *  duplicated — see `PickController`, which shares the same pair. */
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  /** Read per probe rather than captured: a structural op replaces them. */
  worldMeshes: () => readonly THREE.Mesh[];
  /** This world's camera slots, which outlive the scene the way the pose
   *  does. */
  slots: CameraSlots;
  /** The world's own top, in three space: where a walk's entry search gives
   *  up looking for somewhere to stand. */
  ceiling: number;
  /** Another view is on screen. This is a window listener, and framing a
   *  camera nobody can see is at best a swallowed keystroke. */
  paused: () => boolean;
  /** Where the view came to rest, in three space: the fallback pivot for a
   *  later drag that begins over the sky. */
  rememberPick: (at: THREE.Vector3) => void;
  /** What a slot keystroke did, so the surface can say it. Called only for a
   *  press the slots actually took: a digit past the slot count, an
   *  Alt-modified one and a bare one are handed back, and a paused viewport
   *  never reaches the slots at all. */
  onCameraSlot?: (outcome: CameraSlotOutcome, slot: number) => void;
  frameSelection: () => void;
  frameAll: () => void;
}

export class NavController {
  /** One right-mouse hold. */
  private fly: Fly | null = null;
  /** Whether the hold that just ended moved anything — what tells a fly from
   *  the right click that opens the context menu. */
  private flew = false;
  /** The distance to the pivot when the hold began: what the release falls
   *  back to when there is no world mesh under the centre of the view. */
  private flyReach = 0;
  private flyLastX = 0;
  private flyLastY = 0;

  /** One walk, from F3 to F3 or to the lock being lost. */
  private walk: Walk | null = null;
  private walkBeforeControlsEnabled: boolean | null = null;
  private walkBeforeGizmo: { enabled: boolean; helperVisible: boolean } | null = null;

  constructor(private readonly options: NavControllerOptions) {}

  attach(): void {
    const { host } = this.options;
    // Window listeners, so a drag that leaves the canvas keeps looking and a
    // release over another panel still ends the hold.
    host.addEventListener('pointerdown', this.onFlyPointerDown, { capture: true });
    window.addEventListener('pointermove', this.onFlyPointerMove);
    window.addEventListener('pointerup', this.onFlyPointerUp);
    window.addEventListener('pointercancel', this.onFlyPointerUp);
    // Capture on the window, ahead of the surface's own W/E gizmo-mode keys:
    // while the right button is down, W is "forward".
    window.addEventListener('keydown', this.onFlyKey, { capture: true });
    window.addEventListener('keyup', this.onFlyKey, { capture: true });

    window.addEventListener('mousemove', this.onWalkMouseMove);
    window.addEventListener('keydown', this.onWalkKey, { capture: true });
    window.addEventListener('keyup', this.onWalkKey, { capture: true });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);

    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Ends a walk still standing before it removes anything: a lock left held
   *  would outlive the scene, and the pivot would never be re-seated. */
  dispose(): void {
    const { host } = this.options;
    this.exitWalk();
    host.removeEventListener('pointerdown', this.onFlyPointerDown, { capture: true });
    window.removeEventListener('pointermove', this.onFlyPointerMove);
    window.removeEventListener('pointerup', this.onFlyPointerUp);
    window.removeEventListener('pointercancel', this.onFlyPointerUp);
    window.removeEventListener('keydown', this.onFlyKey, { capture: true });
    window.removeEventListener('keyup', this.onFlyKey, { capture: true });

    window.removeEventListener('mousemove', this.onWalkMouseMove);
    window.removeEventListener('keydown', this.onWalkKey, { capture: true });
    window.removeEventListener('keyup', this.onWalkKey, { capture: true });
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);

    window.removeEventListener('keydown', this.onKeyDown);
  }

  /**
   * Advance whichever navigation has the camera. **True when one of them
   * drove it**, which is the draw loop's cue not to call `controls.update()`:
   * OrbitControls would re-aim at a target neither of them is moving.
   */
  step(now: number): boolean {
    if (this.fly !== null) { this.fly.step(now); return true; }
    if (this.walk !== null) { this.walk.step(now); return true; }
    return false;
  }

  /** A walk is in hand. Read by everything that must not treat a press as a
   *  gesture: under pointer lock the buttons still fire, at frozen
   *  coordinates. */
  walking(): boolean {
    return this.walk !== null;
  }

  /** A fly is in hand — the emulated middle button's guard, which must not
   *  stand the gizmo down twice. */
  flying(): boolean {
    return this.fly !== null;
  }

  /** Whether the right press that just ended was a fly rather than a click.
   *  Consumed by the `contextmenu` it belongs to, which on Windows fires after
   *  the release. */
  consumeFly(): boolean {
    if (!this.flew) return false;
    this.flew = false;
    return true;
  }

  // ── fly navigation ────────────────────────────────────────────────────────
  //
  // Hold the right button: the drag looks, WASD/Space/X moves, Shift hurries
  // (`flyNav`). The right button is free — OrbitControls' RIGHT is `null` —
  // except for the click that opens the context menu, and a hold is told from
  // a click by whether it moved anything (`flew`).

  private readonly onFlyPointerDown = (event: PointerEvent) => {
    // A walk and a fly would both write the camera every frame.
    if (event.button !== 2 || this.fly !== null || this.walk !== null) return;
    const { camera, controls } = this.options;
    this.flew = false;
    this.flyReach = camera.position.distanceTo(controls.target);
    this.fly = new Fly(camera, flySpeedFor(this.flyReach));
    this.flyLastX = event.clientX;
    this.flyLastY = event.clientY;
    controls.enabled = false;
  };

  private readonly onFlyPointerMove = (event: PointerEvent) => {
    if (this.fly === null) return;
    this.fly.look(event.clientX - this.flyLastX, event.clientY - this.flyLastY);
    this.flyLastX = event.clientX;
    this.flyLastY = event.clientY;
  };

  /**
   * The release re-seats the pivot ahead of the camera — on the world mesh
   * under the centre of the view if there is one, else at the distance the
   * hold began with — so the next orbit turns about what is being looked at
   * and the next dolly and pan keep their scale.
   */
  private readonly onFlyPointerUp = (event: PointerEvent) => {
    if (this.fly === null || event.button !== 2) return;
    const { camera, controls } = this.options;
    this.flew = this.fly.moved;
    this.fly = null;
    controls.enabled = true;
    if (!this.flew) return;
    if (!this.pivotUnderCentre()) pivotAhead(camera, controls.target, this.flyReach);
    // The sky-fallback pivot too, for the same reason `frameFramables` does.
    this.options.rememberPick(controls.target);
  };

  private readonly onFlyKey = (event: KeyboardEvent) => {
    if (this.fly === null) return;
    const taken = event.type === 'keydown'
      ? this.fly.press(event.code, event.shiftKey)
      : (this.fly.release(event.code, event.shiftKey), flyMoveFor(event.code) !== null);
    if (!taken) return;
    event.preventDefault();
    event.stopPropagation();
  };

  // ── walk navigation (the grounded half) ───────────────────────────────────
  //
  // F3 toggles a walk (`walkNav`): the mouse looks under pointer lock — the
  // app's first use of it, and the only way a look has no edge to run into —
  // WASD walks, gravity and the world mesh do the rest. Unlike the fly it is a
  // long-lived mode, not a press-scoped hold, so what it switches off is
  // snapshotted and given back exactly (the `gizmoBeforeNav` precedent); the
  // selection is never touched.
  //
  // Entry is optimistic: the walk begins on the keydown, where the lock
  // request needs the user's activation, and a refused lock rolls it back
  // through `pointerlockerror`. A camera with nowhere to stand — the search
  // above it finds nothing before the world's top — enters nothing and says
  // nothing.

  private enterWalk(): void {
    const { camera, canvas, controls, gizmo, ceiling } = this.options;
    const meshes = this.options.worldMeshes();
    const entry = findWalkEntry(camera.position, meshes, ceiling);
    if (entry === null) return;
    this.walkBeforeControlsEnabled = controls.enabled;
    this.walkBeforeGizmo = { enabled: gizmo.enabled, helperVisible: gizmo.helperVisible };
    controls.enabled = false;
    gizmo.enabled = false;
    gizmo.helperVisible = false;
    camera.position.copy(entry);
    // A promise in Chromium, nothing in older engines; a refusal arrives as
    // `pointerlockerror` either way, so the rejection carries nothing new.
    Promise.resolve(canvas.requestPointerLock()).catch(() => {});
    this.walk = new Walk(camera, meshes);
  }

  /** The one teardown, for every way a walk ends: F3 again, the lock lost to
   *  Escape or a window switch, a refused lock, the scene going away. */
  private exitWalk(): void {
    if (this.walk === null) return;
    const { camera, canvas, controls, gizmo } = this.options;
    this.walk = null;
    if (this.walkBeforeControlsEnabled !== null) controls.enabled = this.walkBeforeControlsEnabled;
    if (this.walkBeforeGizmo !== null) {
      gizmo.enabled = this.walkBeforeGizmo.enabled;
      gizmo.helperVisible = this.walkBeforeGizmo.helperVisible;
    }
    this.walkBeforeControlsEnabled = null;
    this.walkBeforeGizmo = null;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    // The pivot as the fly's release leaves it, but at a fixed reach: the
    // fly's own is the distance it began with, and a walk can have crossed the
    // level since F3.
    if (!this.pivotUnderCentre()) {
      pivotAhead(camera, controls.target, WALK_EXIT_PIVOT_DISTANCE);
    }
    this.options.rememberPick(controls.target);
  }

  /** `mousemove`, not the `pointermove` the fly reads: under pointer lock the
   *  deltas are `movementX/Y`, which is a mouse event's field. */
  private readonly onWalkMouseMove = (event: MouseEvent) => {
    if (this.walk === null) return;
    this.walk.look(event.movementX, event.movementY);
  };

  private readonly onWalkKey = (event: KeyboardEvent) => {
    if (this.walk === null) return;
    const taken = event.type === 'keydown'
      ? this.walk.press(event.code, event.shiftKey)
      : (this.walk.release(event.code, event.shiftKey), walkMoveFor(event.code) !== null);
    if (!taken) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onPointerLockChange = () => {
    const locked = document.pointerLockElement === this.options.canvas;
    if (this.walk !== null) {
      if (!locked) this.exitWalk();
      return;
    }
    // A grant that arrives after the walk it was for has ended — F3 twice
    // inside the grant latency, where `exitWalk` had no lock to give back yet.
    // Nothing reads the deltas now, and nothing else here ever asks for the
    // lock, so it is ours to release.
    if (locked) document.exitPointerLock();
  };

  private readonly onPointerLockError = () => { this.exitWalk(); };

  /** Re-seat the pivot on the world mesh under the centre of the view. False
   *  when there is nothing there — sky — which is what both navigations' own
   *  fallback distance answers. */
  private pivotUnderCentre(): boolean {
    const { camera, controls, raycaster, pointer } = this.options;
    raycaster.setFromCamera(pointer.set(0, 0), camera);
    const hit = raycaster.intersectObjects(this.options.worldMeshes() as THREE.Mesh[], false)[0];
    if (!hit) return false;
    pivotAt(camera, controls.target, hit.point);
    return true;
  }

  // ── the keys ──────────────────────────────────────────────────────────────

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const { camera, controls, slots } = this.options;
    // Another view is on screen: this is a window listener, and framing a
    // camera nobody can see is at best a swallowed keystroke.
    if (this.options.paused()) return;
    // The property grid is a pile of text fields, and a '.' typed into one of
    // them is a decimal point, not a camera move — and a Home pressed inside an
    // open Select belongs to the Select, which is the half this used to miss.
    if (isTypingOrInPopover(event.target)) return;

    // Spacer's camera slots: Ctrl+Shift+N stores the pose, Ctrl+N brings it
    // back — camera and pivot both, so the next orbit turns about the same
    // point. `Ctrl+digit` is bound nowhere else in the app.
    const slot = cameraSlotFor(event);
    if (slot !== null) {
      event.preventDefault();
      let outcome: CameraSlotOutcome;
      if (slot.action === 'store') {
        slots.store(slot.slot, camera.position, controls.target);
        outcome = 'stored';
      } else if (slots.recall(slot.slot, camera.position, controls.target)) {
        controls.update();
        // The sky-fallback pivot too, as `frameFramables` does.
        this.options.rememberPick(controls.target);
        outcome = 'recalled';
      } else {
        outcome = 'empty';
      }
      this.options.onCameraSlot?.(outcome, slot.slot);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Spacer's walk key. Not during a fly — both would write the camera — and
    // not while something else owns the controls (a gizmo drag, a benchmark),
    // for the same reason.
    if (event.code === 'F3') {
      event.preventDefault();
      if (this.walk !== null) this.exitWalk();
      else if (this.fly === null && controls.enabled) this.enterWalk();
      return;
    }

    // Blender's key is numpad-period; laptops without a numpad send the
    // ordinary one, and both mean the same thing here.
    if (event.code === 'NumpadDecimal' || event.key === '.') { this.options.frameSelection(); return; }
    if (event.key === 'Home') this.options.frameAll();
  };
}
