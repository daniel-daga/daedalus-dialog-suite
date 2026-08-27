/**
 * Cheap structural assertions for IPC payloads at the main-process boundary.
 *
 * These are boundary hygiene, not a schema library: the services already fail
 * safe inside try/catch, but a compromised renderer should be rejected early
 * with a clear error rather than reaching deep service internals.
 */

import type { WorldOp } from '../shared/worldTypes';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Assert a semantic-model payload is a plain (non-array) object, and that its
 * `dialogs`/`functions` fields, when present, are plain objects too.
 */
export function assertModelShape(model: unknown): asserts model is Record<string, unknown> {
  if (!isPlainObject(model)) {
    throw new Error('Invalid model payload: expected a plain object');
  }
  if (model.dialogs !== undefined && !isPlainObject(model.dialogs)) {
    throw new Error('Invalid model payload: dialogs must be a plain object');
  }
  if (model.functions !== undefined && !isPlainObject(model.functions)) {
    throw new Error('Invalid model payload: functions must be a plain object');
  }
}

/** Assert a dialog name is a string. */
export function assertDialogName(name: unknown): asserts name is string {
  if (typeof name !== 'string') {
    throw new Error('Invalid dialog name: expected a string');
  }
}

/** Assert a settings payload is a plain object or undefined. */
export function assertSaveFileSettings(settings: unknown): void {
  if (settings !== undefined && !isPlainObject(settings)) {
    throw new Error('Invalid settings payload: expected a plain object or undefined');
  }
}

/**
 * Renderer crash-report forwarding (fix-08 §5). The renderer forwards
 * `window.onerror` / `unhandledrejection` payloads over IPC; a compromised or
 * buggy renderer must not be able to push arbitrary or unbounded data into the
 * local log. Strings only, bounded lengths, drop anything else.
 */
export const RENDERER_ERROR_MESSAGE_MAX = 2000;
export const RENDERER_ERROR_STACK_MAX = 8000;

export function sanitizeRendererErrorPayload(
  payload: unknown
): { message: string; stack?: string } | null {
  if (!isPlainObject(payload)) {
    return null;
  }
  const { message, stack } = payload;
  if (typeof message !== 'string' || message.length === 0 || message.length > RENDERER_ERROR_MESSAGE_MAX) {
    return null;
  }
  if (stack !== undefined) {
    if (typeof stack !== 'string' || stack.length > RENDERER_ERROR_STACK_MAX) {
      return null;
    }
    return { message, stack };
  }
  return { message };
}

const SAVE_FILE_OPTION_KEYS = ['skipValidation', 'forceOnErrors', 'overwriteExternal', 'existingVoiceIds'] as const;

/** Structural check for the ProjectIndex.voiceIds-shaped validation context. */
function isVoiceIdIndex(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.values(value).every(
    (entries) =>
      Array.isArray(entries) &&
      entries.every(
        (entry) =>
          isPlainObject(entry) &&
          typeof entry.filePath === 'string' &&
          typeof entry.functionName === 'string'
      )
  );
}

/**
 * Assert a saveFile options payload is undefined or a plain object whose only
 * keys are the known options.
 */
export function assertSaveFileOptions(options: unknown): void {
  if (options === undefined) return;
  if (!isPlainObject(options)) {
    throw new Error('Invalid options payload: expected a plain object or undefined');
  }
  for (const key of Object.keys(options)) {
    if (!(SAVE_FILE_OPTION_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Invalid options payload: unknown option "${key}"`);
    }
    // Callers spread optional flags (`{ forceOnErrors: options?.forceOnErrors }`),
    // so absent flags arrive as keys with undefined values over structured
    // clone. Treat them as "not set" rather than malformed.
    if (options[key] === undefined) {
      continue;
    }
    if (key === 'existingVoiceIds') {
      if (!isVoiceIdIndex(options[key])) {
        throw new Error('Invalid options payload: option "existingVoiceIds" must map ids to {filePath, functionName} arrays');
      }
      continue;
    }
    if (typeof options[key] !== 'boolean') {
      throw new Error(`Invalid options payload: option "${key}" must be a boolean`);
    }
  }
}

/** The three explicit targets. Never inferred from the file (level-editor.md §9). */
const GAME_VERSIONS = ['g1', 'g2'] as const;

export interface OpenWorldRequestShape {
  worldPath: string;
  gameVersion: 'g1' | 'g2';
  assetSources: string[];
}

/**
 * Assert an open-world request. Beyond the usual boundary hygiene, the two
 * path-bearing fields matter for a specific reason: the caller path-validates
 * `worldPath` and every entry of `assetSources`, and a non-string in that array
 * would pass straight through the validation loop and reach the VFS.
 */
export function assertOpenWorldRequest(request: unknown): asserts request is OpenWorldRequestShape {
  if (!isPlainObject(request)) {
    throw new Error('Invalid world request: expected a plain object');
  }
  if (typeof request.worldPath !== 'string' || request.worldPath === '') {
    throw new Error('Invalid world request: worldPath must be a non-empty string');
  }
  if (!(GAME_VERSIONS as readonly unknown[]).includes(request.gameVersion)) {
    throw new Error(`Invalid world request: gameVersion must be one of ${GAME_VERSIONS.join(', ')}`);
  }
  if (!Array.isArray(request.assetSources)
    || !request.assetSources.every((source) => typeof source === 'string')) {
    throw new Error('Invalid world request: assetSources must be an array of strings');
  }
}

/**
 * Assert a texture request. `maxSize` drives a mipmap-selection loop, so a
 * zero, a negative or a NaN makes that loop's exit condition meaningless.
 */
export function assertTextureRequest(
  request: unknown,
): asserts request is { name: string; maxSize: number } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid texture request: expected a plain object');
  }
  if (typeof request.name !== 'string' || request.name === '') {
    throw new Error('Invalid texture name: expected a non-empty string');
  }
  const { maxSize } = request;
  if (typeof maxSize !== 'number' || !Number.isInteger(maxSize) || maxSize <= 0) {
    throw new Error('Invalid texture request: maxSize must be a positive integer');
  }
}

/** Slots down the children lists, as `setVobPosition` parses it: "0", "0/4". */
const INDEX_PATH = /^\d+(\/\d+)*$/;

function isFiniteNumbers(value: unknown, count: number): boolean {
  return Array.isArray(value) && value.length === count
    && value.every((component) => typeof component === 'number' && Number.isFinite(component));
}

function isZenPosition(value: unknown): value is [number, number, number] {
  return isFiniteNumbers(value, 3);
}

/**
 * Assert a save request (level-editor.md §5).
 *
 * The path goes to the native writer, which creates a temp file beside it and
 * renames — so this is the last place a renderer-supplied string is a string
 * rather than a file on disk. The main process validates it against the
 * whitelist as well; this only settles its shape.
 */
export function assertSaveWorldRequest(
  request: unknown,
): asserts request is { targetPath: string } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid save request: expected a plain object');
  }
  if (typeof request.targetPath !== 'string' || request.targetPath.trim() === '') {
    throw new Error('Invalid save request: targetPath must be a non-empty string');
  }
}

/**
 * Assert an edit batch (level-editor.md §7).
 *
 * This is the first IPC payload that *changes* the world rather than reading a
 * projection of it, and every field of it is handed to native code: the path is
 * parsed in C++ and used to walk the VOB tree, and the position is written into
 * a `zenkit::Vec3`. `op` is checked against the ops that exist rather than
 * assumed, so an op the binding cannot apply is a refusal here and not a
 * silently skipped edit.
 */
/** The boolean properties a `SetVobProp` may carry — the six `vobIndex` emits.
 *  Anything else is refused, exactly as the binding refuses it. */
const VOB_FLAG_KEYS = [
  'showVisual', 'vobStatic', 'ambient', 'cdStatic', 'cdDynamic', 'physicsEnabled',
];

/** The flags a VOB can be *authored* with — the same list minus
 *  `physicsEnabled`, which `insertVob` does not take. ZenGin writes that field
 *  only for some world formats and cannot set it in the Spacer at all, so there
 *  is no meaningful value to author it with. Sharing the list above would let
 *  the boundary wave through exactly what the binding then refuses. */
const NEW_VOB_FLAG_KEYS = [
  'showVisual', 'vobStatic', 'ambient', 'cdStatic', 'cdDynamic',
];

/**
 * One end of a reparent — the path, the parent that holds it and the slot in
 * that parent's children.
 *
 * All three reach C++: `reparentVob` walks the VOB tree by `parentPath`, indexes
 * the children list by `slot`, and the caller checks the path it answers with
 * against `path`. A null `parentPath` is a root and is the one legitimate
 * absence here — everything else is a required field.
 */
function assertVobSlot(value: unknown, side: string): void {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid op: ${side} must be a slot — a path, a parentPath and a slot`);
  }
  if (typeof value.path !== 'string' || !INDEX_PATH.test(value.path)) {
    throw new Error(`Invalid op: ${side}.path must be slot indices separated by "/"`);
  }
  if (value.parentPath !== null
    && (typeof value.parentPath !== 'string' || !INDEX_PATH.test(value.parentPath))) {
    throw new Error(`Invalid op: ${side}.parentPath must be slot indices separated by "/", or null`);
  }
  if (typeof value.slot !== 'number' || !Number.isInteger(value.slot) || value.slot < 0) {
    throw new Error(`Invalid op: ${side}.slot must be a non-negative integer`);
  }
}

export function assertApplyOpsRequest(request: unknown): asserts request is { ops: WorldOp[] } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid ops request: expected a plain object');
  }
  if (!Array.isArray(request.ops)) {
    throw new Error('Invalid ops request: ops must be an array');
  }
  for (const op of request.ops) {
    if (!isPlainObject(op)) throw new Error('Invalid op: expected a plain object');
    if (op.op !== 'MoveVob' && op.op !== 'RotateVob' && op.op !== 'SetVobProp'
      && op.op !== 'AddVob' && op.op !== 'ReparentVob' && op.op !== 'MoveWaypoint') {
      throw new Error(`Invalid op: unknown op ${String(op.op)}`);
    }

    // Before the `vob` check, not merely before the `path` check: a waynet op
    // is not about a VOB at all and carries neither field. The reparent branch
    // below sits after `vob` and could afford to, because a reparent still has
    // one; put this one there and the op is refused with a message about a
    // field it has no business having.
    if (op.op === 'MoveWaypoint') {
      if (typeof op.waypoint !== 'number' || !Number.isInteger(op.waypoint) || op.waypoint < 0) {
        throw new Error('Invalid op: waypoint must be a non-negative integer');
      }
      // The name is the guard the bare index needs, so an absent one is not a
      // tolerable omission: a wrong waypoint index always resolves to a
      // waypoint, and moves it.
      if (typeof op.name !== 'string') {
        throw new Error('Invalid op: name must be the waypoint\'s name');
      }
      for (const field of ['from', 'to'] as const) {
        if (!isFiniteNumbers(op[field], 3)) {
          throw new Error(`Invalid op: ${field} must be three finite numbers`);
        }
      }
      continue;
    }

    if (typeof op.vob !== 'number' || !Number.isInteger(op.vob) || op.vob < 0) {
      throw new Error('Invalid op: vob must be a non-negative integer');
    }

    // Before the `path` check, because a reparent is the one op with no
    // top-level path: a move has two ends and carries one on each side. A
    // validator written around `op.path` refuses it outright, which is what kept
    // the scene tree's drag and drop from ever reaching the binding.
    if (op.op === 'ReparentVob') {
      assertVobSlot(op.from, 'from');
      assertVobSlot(op.to, 'to');
      continue;
    }

    if (typeof op.path !== 'string' || !INDEX_PATH.test(op.path)) {
      throw new Error('Invalid op: path must be slot indices separated by "/"');
    }

    if (op.op === 'RotateVob') {
      // Nine, not three. The two ops share every other field name, so a move
      // mislabelled as a rotation is exactly the shape a check on `op` alone
      // would wave through — into `setVobRotation`, which reads the matrix
      // positionally in C++ and would leave uninitialized rows in a struct
      // ZenKit does not zero.
      for (const field of ['from', 'to'] as const) {
        if (!isFiniteNumbers(op[field], 9)) {
          throw new Error(`Invalid op: ${field} must be nine finite numbers, row-major`);
        }
      }
      // Null is a legitimate answer, not a missing field: a VOB whose visual
      // does not resolve has no bounds to refit and keeps the box it has.
      for (const field of ['fromBbox', 'toBbox'] as const) {
        if (op[field] !== null && !isFiniteNumbers(op[field], 6)) {
          throw new Error(`Invalid op: ${field} must be six finite numbers or null`);
        }
      }
      continue;
    }

    if (op.op === 'AddVob') {
      // The list it is appended to, and the field that decides whether the op
      // renumbers. It walks the VOB tree in C++ just as `path` does, so it is
      // checked in the same shape — null being the roots, and the one absence
      // that means something here.
      if (op.parentPath !== null
        && (typeof op.parentPath !== 'string' || !INDEX_PATH.test(op.parentPath))) {
        throw new Error('Invalid op: parentPath must be slot indices separated by "/", or null');
      }
      // Exactly one side is null. Both null is an op that does nothing; neither
      // null is an add and a delete at once, and `writeOp` would read it as an
      // insert in one direction and an insert in the other — so the VOB would
      // never come back off an undo.
      const nulls = ['from', 'to'].filter((side) => op[side] === null).length;
      if (nulls !== 1) {
        throw new Error('Invalid op: an AddVob has exactly one null side — it adds or it removes');
      }
      const spec = op.from === null ? op.to : op.from;
      if (!isPlainObject(spec)) throw new Error('Invalid op: the vob to add must be an object');
      for (const [key, value] of Object.entries(spec)) {
        if (key === 'name' || key === 'visual') {
          if (typeof value !== 'string') throw new Error(`Invalid op: ${key} must be a string`);
        } else if (NEW_VOB_FLAG_KEYS.includes(key)) {
          if (typeof value !== 'boolean') throw new Error(`Invalid op: ${key} must be a boolean`);
        } else if (key === 'position') {
          if (!isZenPosition(value)) throw new Error('Invalid op: position must be three finite numbers');
        } else if (key === 'rotation') {
          if (!isFiniteNumbers(value, 9)) throw new Error('Invalid op: rotation must be nine finite numbers');
        } else if (key === 'bbox') {
          if (!isFiniteNumbers(value, 6)) throw new Error('Invalid op: bbox must be six finite numbers');
        } else {
          throw new Error(`Invalid op: unknown property ${key}`);
        }
      }
      if (!('position' in spec)) throw new Error('Invalid op: a vob to add needs a position');
      continue;
    }

    if (op.op === 'SetVobProp') {
      // The props reach C++ as a whole object, where an unrecognised key is
      // refused rather than ignored — so the same key set is settled here, and
      // an op the binding would refuse never becomes a half-applied batch.
      const sides = ['from', 'to'] as const;
      for (const side of sides) {
        if (!isPlainObject(op[side])) {
          throw new Error(`Invalid op: ${side} must be an object of properties`);
        }
        for (const [key, value] of Object.entries(op[side])) {
          if (key === 'name' || key === 'visual') {
            if (typeof value !== 'string') {
              throw new Error(`Invalid op: ${side}.${key} must be a string`);
            }
          } else if (VOB_FLAG_KEYS.includes(key)) {
            if (typeof value !== 'boolean') {
              throw new Error(`Invalid op: ${side}.${key} must be a boolean`);
            }
          } else {
            throw new Error(`Invalid op: unknown property ${key}`);
          }
        }
      }
      // The same keys on both sides, or the inverse restores a different set of
      // fields than the op wrote — which is invisible until someone undoes.
      const keys = sides.map((side) => Object.keys(op[side] as object).sort());
      if (keys[0].length === 0) throw new Error('Invalid op: sets no properties');
      if (keys[0].join() !== keys[1].join()) {
        throw new Error('Invalid op: from and to must carry the same properties');
      }
      for (const field of ['fromBbox', 'toBbox'] as const) {
        if (op[field] !== null && !isFiniteNumbers(op[field], 6)) {
          throw new Error(`Invalid op: ${field} must be six finite numbers or null`);
        }
        // Only a visual swap can move the box, and the binding refuses a box
        // without one — so a box on any other change is refused here too rather
        // than at the bottom of a batch that has already applied.
        if (op[field] !== null && !('visual' in (op.to as object))) {
          throw new Error(`Invalid op: ${field} is only meaningful with a change of visual`);
        }
      }
      continue;
    }

    if (!isZenPosition(op.from)) throw new Error('Invalid op: from must be three finite numbers');
    if (!isZenPosition(op.to)) throw new Error('Invalid op: to must be three finite numbers');
  }
}
