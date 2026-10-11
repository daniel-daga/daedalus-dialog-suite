/**
 * Spacer's camera slots (plan §16.26 row 3): a pose — camera position and
 * orbit pivot — stored into a numbered slot and recalled later, so a modder
 * placing objects along a path can jump between the places they were working.
 *
 * Real `three` under jsdom, as in `flyNav.test.ts`: it is vector copying.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { CameraSlots, CAMERA_SLOT_COUNT, cameraSlotFor } from '../src/renderer/world/cameraSlots';

const keys = (code: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers,
});

describe('cameraSlots', () => {
  test('recall restores the pose store took, position and pivot both', () => {
    const slots = new CameraSlots();
    const position = new THREE.Vector3(10, 20, 30);
    const target = new THREE.Vector3(1, 2, 3);
    slots.store(0, position, target);

    position.set(-5, -6, -7);
    target.set(0, 0, 0);
    expect(slots.recall(0, position, target)).toBe(true);
    expect(position.toArray()).toEqual([10, 20, 30]);
    expect(target.toArray()).toEqual([1, 2, 3]);
  });

  test('store copies: moving the camera afterwards does not move the slot', () => {
    const slots = new CameraSlots();
    const position = new THREE.Vector3(1, 1, 1);
    const target = new THREE.Vector3(2, 2, 2);
    slots.store(1, position, target);
    position.set(9, 9, 9);
    target.set(8, 8, 8);

    slots.recall(1, position, target);
    expect(position.toArray()).toEqual([1, 1, 1]);
    expect(target.toArray()).toEqual([2, 2, 2]);
  });

  test('an empty slot recalls nothing and leaves the camera where it is', () => {
    const slots = new CameraSlots();
    const position = new THREE.Vector3(4, 5, 6);
    const target = new THREE.Vector3(7, 8, 9);
    expect(slots.recall(2, position, target)).toBe(false);
    expect(position.toArray()).toEqual([4, 5, 6]);
    expect(target.toArray()).toEqual([7, 8, 9]);
  });

  test('slots are independent and a second store overwrites', () => {
    const slots = new CameraSlots();
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    slots.store(0, position.set(1, 0, 0), target.set(0, 1, 0));
    slots.store(3, position.set(2, 0, 0), target.set(0, 2, 0));
    slots.store(0, position.set(3, 0, 0), target.set(0, 3, 0));

    slots.recall(0, position, target);
    expect([position.x, target.y]).toEqual([3, 3]);
    slots.recall(3, position, target);
    expect([position.x, target.y]).toEqual([2, 2]);
  });

  test('Ctrl+digit recalls, Ctrl+Shift+digit stores, by key code and within the slot count', () => {
    expect(cameraSlotFor(keys('Digit1', { ctrlKey: true }))).toEqual({ action: 'recall', slot: 0 });
    expect(cameraSlotFor(keys('Digit1', { ctrlKey: true, shiftKey: true }))).toEqual({ action: 'store', slot: 0 });
    expect(cameraSlotFor(keys(`Digit${CAMERA_SLOT_COUNT}`, { ctrlKey: true })))
      .toEqual({ action: 'recall', slot: CAMERA_SLOT_COUNT - 1 });
    // Cmd on a Mac is the Ctrl of every other shortcut in the surface.
    expect(cameraSlotFor(keys('Digit2', { metaKey: true }))).toEqual({ action: 'recall', slot: 1 });
    // Shift alone changes the character (`!` on a US layout) — the physical
    // key is what is read, so the shifted store still lands.
    expect(cameraSlotFor(keys('Digit1', { ctrlKey: true, shiftKey: true, key: '!' } as Partial<KeyboardEvent>)))
      .toEqual({ action: 'store', slot: 0 });

    expect(cameraSlotFor(keys(`Digit${CAMERA_SLOT_COUNT + 1}`, { ctrlKey: true }))).toBeNull();
    expect(cameraSlotFor(keys('Digit0', { ctrlKey: true }))).toBeNull();
    expect(cameraSlotFor(keys('Digit1'))).toBeNull();
    expect(cameraSlotFor(keys('Digit1', { shiftKey: true }))).toBeNull();
    expect(cameraSlotFor(keys('Digit1', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(cameraSlotFor(keys('KeyW', { ctrlKey: true }))).toBeNull();
  });
});
