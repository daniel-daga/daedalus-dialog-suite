import type * as THREE from 'three';

// Spacer's camera slots (plan §16.26 row 3): a pose — where the camera is and
// what the orbit turns about — stored under a number and recalled later, so a
// modder working two ends of a path can jump between them without flying.
// The pivot is part of the pose because a recalled camera with the old pivot
// would look right and orbit wrong on the very next drag (`pivotAt`).
//
// Per session and per world: the viewport owns one `CameraSlots` per open
// world and drops it when a different one arrives. Nothing is persisted.

export const CAMERA_SLOT_COUNT = 4;

export interface CameraSlotAction {
  action: 'store' | 'recall';
  /** Zero-based; the key is `slot + 1`. */
  slot: number;
}

/**
 * The slot a key press asks for, or null for a key the slots do not own:
 * Ctrl+1..N recalls, Ctrl+Shift+1..N stores; Cmd stands in for Ctrl as it does
 * for every other shortcut in the surface, and Alt makes it something else.
 *
 * Read by `KeyboardEvent.code`, the physical key: with Shift held, `key` is
 * the shifted character (`!` on a US layout, `+` on a German one) and the
 * digit is gone from it.
 */
export function cameraSlotFor(event: {
  code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean;
}): CameraSlotAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const digit = /^Digit([1-9])$/.exec(event.code);
  if (digit === null) return null;
  const slot = Number(digit[1]) - 1;
  if (slot >= CAMERA_SLOT_COUNT) return null;
  return { action: event.shiftKey ? 'store' : 'recall', slot };
}

/** The slots of one open world. Poses are copied in and copied out, so the
 *  live camera and `OrbitControls.target` are never aliased. */
export class CameraSlots {
  private readonly poses: Array<{ position: number[]; target: number[] } | null> =
    new Array<null>(CAMERA_SLOT_COUNT).fill(null);

  store(slot: number, position: THREE.Vector3, target: THREE.Vector3): void {
    this.poses[slot] = { position: position.toArray(), target: target.toArray() };
  }

  /** Copies the stored pose into `position` and `target`; false — and nothing
   *  touched — for a slot nothing has been stored in. */
  recall(slot: number, position: THREE.Vector3, target: THREE.Vector3): boolean {
    const pose = this.poses[slot];
    if (pose === null || pose === undefined) return false;
    position.fromArray(pose.position);
    target.fromArray(pose.target);
    return true;
  }
}
