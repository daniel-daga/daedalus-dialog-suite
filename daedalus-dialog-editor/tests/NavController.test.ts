/**
 * Moving the camera (level-editor.md §16.26 row 3, #220).
 *
 * The fly, the walk, the camera slots and the framing keys were closures
 * inside `WorldViewport`'s one big effect, so every rule below could only be
 * reached by rendering the whole viewport. `flyNav`, `walkNav` and
 * `cameraSlots` each already have their own spec and none of them is what is
 * checked here — what is, is the *wiring*: which of the two navigations owns
 * the camera on a given frame, what a mode switch saves and gives back, and
 * which keys the surface never sees because a navigation took them.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { NavController } from '../src/renderer/world/NavController';
import { CameraSlots } from '../src/renderer/world/cameraSlots';

const WIDTH = 800;
const HEIGHT = 600;
/** Above the camera's own start, so a walk's entry search has room. */
const CEILING = 500;

/** A ground quad at y = 0 under the camera, 40 units across — so the centre of
 *  the view hits it and a camera flown off the side misses. */
function ground(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function press(target: EventTarget, button: number): void {
  target.dispatchEvent(new MouseEvent('pointerdown', { button, clientX: 0, clientY: 0, bubbles: true }));
}

function key(type: 'keydown' | 'keyup', code: string, modifiers: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true, ...modifiers });
  window.dispatchEvent(event);
  return event;
}

function harness({ hasMesh = true, ceiling = CEILING, deferLock = false } = {}) {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  document.body.appendChild(host);

  const camera = new THREE.PerspectiveCamera(70, WIDTH / HEIGHT, 0.5, 4000);
  camera.position.set(0, 50, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const meshes = hasMesh ? [ground()] : [];

  let updates = 0;
  const controls = {
    enabled: true,
    target: new THREE.Vector3(0, 0, 0),
    update: () => { updates += 1; },
  };
  const gizmo = { enabled: true, helperVisible: true };

  // jsdom implements neither half of the Pointer Lock API.
  let locked: Element | null = null;
  let lockRequests = 0;
  let lockExits = 0;
  // A real grant is asynchronous — the browser answers the request a frame or
  // more later — and `deferLock` is how a test gets between the two.
  canvas.requestPointerLock = () => { lockRequests += 1; if (!deferLock) locked = canvas; };
  document.exitPointerLock = () => { lockExits += 1; locked = null; };
  Object.defineProperty(document, 'pointerLockElement', { get: () => locked, configurable: true });

  const remembered: THREE.Vector3[] = [];
  let framedSelection = 0;
  let framedAll = 0;
  let paused = false;

  const nav = new NavController({
    host,
    canvas,
    camera,
    controls,
    gizmo,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    worldMeshes: () => meshes,
    slots: new CameraSlots(),
    ceiling,
    paused: () => paused,
    rememberPick: (at) => { remembered.push(at.clone()); },
    frameSelection: () => { framedSelection += 1; },
    frameAll: () => { framedAll += 1; },
  });
  nav.attach();

  return {
    nav, host, canvas, camera, controls, gizmo,
    get updates() { return updates; },
    get lockRequests() { return lockRequests; },
    get lockExits() { return lockExits; },
    get framedSelection() { return framedSelection; },
    get framedAll() { return framedAll; },
    remembered,
    pause: () => { paused = true; },
    /** The lock going away for a reason other than F3 — Escape, a window
     *  switch. */
    loseLock: () => {
      locked = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    },
    lockError: () => {
      locked = null;
      document.dispatchEvent(new Event('pointerlockerror'));
    },
    /** The browser answering a `deferLock` request, whenever it gets to it. */
    grantLock: () => {
      locked = canvas;
      document.dispatchEvent(new Event('pointerlockchange'));
    },
    /** One press-move-release of the fly, without the release. */
    beginFly: () => press(canvas, 2),
    endFly: () => window.dispatchEvent(new MouseEvent('pointerup', { button: 2, bubbles: true })),
    look: (dx: number, dy: number) => window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: dx, clientY: dy, bubbles: true }),
    ),
  };
}

let harnesses: Array<{ nav: NavController }> = [];
function stand(options?: Parameters<typeof harness>[0]) {
  const made = harness(options);
  harnesses.push(made);
  return made;
}

beforeEach(() => { harnesses = []; });
afterEach(() => {
  for (const made of harnesses) made.nav.dispose();
  document.body.innerHTML = '';
});

describe('NavController — the fly', () => {
  it('a right press begins a fly and takes the controls', () => {
    const h = stand();
    h.beginFly();
    expect(h.nav.flying()).toBe(true);
    expect(h.controls.enabled).toBe(false);
  });

  it('a left press begins nothing — the left button selects', () => {
    const h = stand();
    press(h.canvas, 0);
    expect(h.nav.flying()).toBe(false);
    expect(h.controls.enabled).toBe(true);
  });

  it('a right press during a walk begins no fly — both would write the camera', () => {
    const h = stand();
    key('keydown', 'F3');
    h.beginFly();
    expect(h.nav.flying()).toBe(false);
    expect(h.nav.walking()).toBe(true);
  });

  it('the drag turns the camera, and keeps turning off the canvas', () => {
    const h = stand();
    const before = h.camera.quaternion.clone();
    h.beginFly();
    h.look(40, 0);
    expect(h.camera.quaternion.angleTo(before)).toBeGreaterThan(0);
  });

  it('the release gives the controls back and re-seats the pivot on the mesh under the centre', () => {
    const h = stand();
    h.beginFly();
    key('keydown', 'Space');
    h.nav.step(0);
    h.nav.step(100);
    expect(h.camera.position.y).toBeGreaterThan(50);

    h.endFly();
    expect(h.controls.enabled).toBe(true);
    // Straight down at the ground quad: the pivot lands on it, so the reach is
    // the camera's *new* height rather than the 50 the hold began with.
    expect(h.camera.position.distanceTo(h.controls.target)).toBeCloseTo(h.camera.position.y, 2);
    expect(h.remembered).toHaveLength(1);
  });

  it('with nothing under the centre, the pivot goes ahead at the reach the hold began with', () => {
    const h = stand({ hasMesh: false });
    h.beginFly();
    key('keydown', 'Space');
    h.nav.step(0);
    h.nav.step(100);
    const flown = h.camera.position.y;
    expect(flown).toBeGreaterThan(50);

    h.endFly();
    // 50 — the distance to the pivot at the press — not `flown`, which is what
    // a fresh raycast-less re-seat would have used.
    expect(h.camera.position.distanceTo(h.controls.target)).toBeCloseTo(50, 3);
  });

  it('a right press that moved nothing is a click: no pivot, and the menu still opens', () => {
    const h = stand();
    h.beginFly();
    h.endFly();
    expect(h.remembered).toHaveLength(0);
    expect(h.nav.consumeFly()).toBe(false);
  });

  it('a hold that moved is consumed once, so only its own context menu is swallowed', () => {
    const h = stand();
    h.beginFly();
    h.look(40, 0);
    h.endFly();
    expect(h.nav.consumeFly()).toBe(true);
    expect(h.nav.consumeFly()).toBe(false);
  });

  it("a fly's W is forward, and never reaches the surface's gizmo-mode keys", () => {
    const h = stand();
    h.beginFly();
    expect(key('keydown', 'KeyW').defaultPrevented).toBe(true);
  });

  it('W with no fly in hand is the surface\'s, untouched', () => {
    const h = stand();
    expect(key('keydown', 'KeyW').defaultPrevented).toBe(false);
    expect(h.nav.flying()).toBe(false);
  });
});

describe('NavController — the walk', () => {
  it('F3 enters a walk: pointer lock, and the orbit and gizmo stand down', () => {
    const h = stand();
    key('keydown', 'F3');
    expect(h.nav.walking()).toBe(true);
    expect(h.lockRequests).toBe(1);
    expect(h.controls.enabled).toBe(false);
    expect(h.gizmo.enabled).toBe(false);
    expect(h.gizmo.helperVisible).toBe(false);
  });

  it('F3 again gives back exactly what the entry took, and re-seats the pivot', () => {
    const h = stand();
    h.gizmo.enabled = true;
    h.gizmo.helperVisible = false;
    key('keydown', 'F3');
    key('keydown', 'F3');

    expect(h.nav.walking()).toBe(false);
    expect(h.controls.enabled).toBe(true);
    expect(h.gizmo.enabled).toBe(true);
    // Given back as found, not switched back on with it.
    expect(h.gizmo.helperVisible).toBe(false);
    expect(h.lockExits).toBe(1);
    expect(h.remembered).toHaveLength(1);
  });

  // F3 twice inside the grant latency: the walk ends before the lock it asked
  // for exists, so the exit has nothing to give back and the grant lands on
  // nobody. Left alone the canvas stays locked with no walk reading the
  // deltas — a pointer captured until Escape, clicking at frozen coordinates.
  it('gives back a lock that lands after the walk it was for has ended', () => {
    const h = stand({ deferLock: true });
    key('keydown', 'F3');
    expect(h.nav.walking()).toBe(true);
    key('keydown', 'F3');
    expect(h.nav.walking()).toBe(false);
    expect(h.lockExits).toBe(0);

    h.grantLock();

    expect(h.lockExits).toBe(1);
    expect(document.pointerLockElement).toBeNull();
  });

  it('a camera with nowhere to stand enters nothing and touches nothing', () => {
    // The search gives up at the world's own top, and this one is below the
    // camera.
    const h = stand({ ceiling: -1000 });
    key('keydown', 'F3');
    expect(h.nav.walking()).toBe(false);
    expect(h.lockRequests).toBe(0);
    expect(h.gizmo.enabled).toBe(true);
    expect(h.controls.enabled).toBe(true);
  });

  it('the lock lost to Escape ends the walk, through the one teardown', () => {
    const h = stand();
    key('keydown', 'F3');
    h.loseLock();
    expect(h.nav.walking()).toBe(false);
    expect(h.controls.enabled).toBe(true);
    expect(h.gizmo.enabled).toBe(true);
  });

  it('a refused lock rolls the optimistic entry back', () => {
    const h = stand();
    key('keydown', 'F3');
    h.lockError();
    expect(h.nav.walking()).toBe(false);
    expect(h.controls.enabled).toBe(true);
  });

  it('F3 during a fly does nothing — both would write the camera', () => {
    const h = stand();
    h.beginFly();
    key('keydown', 'F3');
    expect(h.nav.walking()).toBe(false);
  });

  it('F3 while something else owns the controls does nothing', () => {
    const h = stand();
    h.controls.enabled = false;
    key('keydown', 'F3');
    expect(h.nav.walking()).toBe(false);
  });

  it('the look reads the locked mouse, whose deltas are `movementX/Y`', () => {
    const h = stand();
    key('keydown', 'F3');
    const before = h.camera.quaternion.clone();
    const move = new MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(move, 'movementX', { value: 40 });
    Object.defineProperty(move, 'movementY', { value: 0 });
    window.dispatchEvent(move);
    expect(h.camera.quaternion.angleTo(before)).toBeGreaterThan(0);
  });

  it("a walk's W never reaches the surface either", () => {
    stand();
    key('keydown', 'F3');
    expect(key('keydown', 'KeyW').defaultPrevented).toBe(true);
  });
});

describe('NavController — which navigation owns the frame', () => {
  it('nothing in hand: the controls drive, and `step` says so', () => {
    const h = stand();
    expect(h.nav.step(16)).toBe(false);
  });

  it('a fly drives instead of the controls', () => {
    const h = stand();
    h.beginFly();
    expect(h.nav.step(16)).toBe(true);
  });

  it('a walk drives instead of the controls', () => {
    const h = stand();
    key('keydown', 'F3');
    expect(h.nav.step(16)).toBe(true);
  });
});

describe('NavController — the keys', () => {
  it('Ctrl+Shift+N stores the pose and Ctrl+N brings both halves of it back', () => {
    const h = stand();
    key('keydown', 'Digit1', { ctrlKey: true, shiftKey: true });

    h.camera.position.set(300, 300, 300);
    h.controls.target.set(200, 0, 200);
    key('keydown', 'Digit1', { ctrlKey: true });

    expect(h.camera.position.toArray()).toEqual([0, 50, 0]);
    expect(h.controls.target.toArray()).toEqual([0, 0, 0]);
    // The recalled pivot is the sky-drag fallback too.
    expect(h.remembered).toHaveLength(1);
  });

  it('a slot nothing was stored in moves nothing', () => {
    const h = stand();
    h.camera.position.set(300, 300, 300);
    key('keydown', 'Digit2', { ctrlKey: true });
    expect(h.camera.position.toArray()).toEqual([300, 300, 300]);
    expect(h.remembered).toHaveLength(0);
  });

  it('the framing keys: `.` frames the selection, Home frames the world', () => {
    const h = stand();
    key('keydown', 'NumpadDecimal');
    key('keydown', 'Period', { key: '.' });
    key('keydown', 'Home', { key: 'Home' });
    expect(h.framedSelection).toBe(2);
    expect(h.framedAll).toBe(1);
  });

  it('a `.` typed into a text field is a decimal point', () => {
    const h = stand();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'NumpadDecimal', key: '.', bubbles: true, cancelable: true,
    }));
    expect(h.framedSelection).toBe(0);
  });

  it('a framing key pressed inside a popover belongs to the popover', () => {
    // §5.4 item 20 of `docs/plans/level-editor-review-2026-09-04.md`. MUI
    // renders a `Select`'s options as `li[role="option"]` inside a listbox and
    // a dialog's buttons as plain `button`s — neither is an INPUT, so Home
    // pressed while picking a snap step framed the whole world behind the open
    // menu. The surface's own shortcuts have always guarded this; the camera's
    // did not.
    const h = stand();
    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    const option = document.createElement('li');
    option.setAttribute('role', 'option');
    listbox.appendChild(option);
    document.body.appendChild(listbox);

    option.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Home', key: 'Home', bubbles: true, cancelable: true,
    }));
    option.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'NumpadDecimal', key: '.', bubbles: true, cancelable: true,
    }));

    expect(h.framedAll).toBe(0);
    expect(h.framedSelection).toBe(0);
    listbox.remove();
  });

  it('another view is on screen: framing a camera nobody can see takes the key for nothing', () => {
    const h = stand();
    h.pause();
    key('keydown', 'Home', { key: 'Home' });
    expect(h.framedAll).toBe(0);
  });

  it('a modified framing key is somebody else\'s shortcut', () => {
    const h = stand();
    key('keydown', 'Home', { key: 'Home', ctrlKey: true });
    expect(h.framedAll).toBe(0);
  });
});

describe('NavController — teardown', () => {
  it('disposing ends a walk still standing, so the lock does not outlive the scene', () => {
    const h = stand();
    key('keydown', 'F3');
    h.nav.dispose();
    expect(h.nav.walking()).toBe(false);
    expect(h.lockExits).toBe(1);
    expect(h.controls.enabled).toBe(true);
  });

  it('a disposed controller hears no more keys', () => {
    const h = stand();
    h.nav.dispose();
    key('keydown', 'Home', { key: 'Home' });
    expect(h.framedAll).toBe(0);
  });
});
