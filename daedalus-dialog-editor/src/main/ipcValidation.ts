/**
 * Cheap structural assertions for IPC payloads at the main-process boundary.
 *
 * These are boundary hygiene, not a schema library: the services already fail
 * safe inside try/catch, but a compromised renderer should be rejected early
 * with a clear error rather than reaching deep service internals.
 */

import {
  baseFieldOf, classPropKeys, decalFieldOf, fieldOf, isAuthorableVobClass,
  type FieldDescriptor,
} from 'zen-world';
import type { WorldOp } from '../shared/worldTypes';
import { PROJECT_ASSET_SOURCE_LIMITS } from '../shared/projectConfigTypes';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertAssetSourcesPayload(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > PROJECT_ASSET_SOURCE_LIMITS.maxCount
    || !Array.from({ length: value.length }, (_, index) => index)
      .every((index) => Object.prototype.hasOwnProperty.call(value, index)
        && typeof value[index] === 'string'
        && value[index].length > 0
        && value[index].length <= PROJECT_ASSET_SOURCE_LIMITS.maxLength
        && !/[\x00-\x1f\x7f]/.test(value[index]))) {
    throw new Error('Invalid assetSources payload: expected an array of strings');
  }
}

export function assertOptionalFolderPath(value: unknown): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === ''
    || /[\x00-\x1f\x7f]/.test(value))) {
    throw new Error('Invalid folder path: expected a non-empty string or undefined');
  }
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

/** Assert a parseSource payload is a string. */
export function assertParseSourcePayload(source: unknown): asserts source is string {
  if (typeof source !== 'string') {
    throw new Error('Invalid source payload: expected a string');
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
  projectFilePath: string;
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
  if (typeof request.projectFilePath !== 'string' || request.projectFilePath === '') {
    throw new Error('Invalid world request: projectFilePath must be a non-empty string');
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

/**
 * A visual by name for the Assets panel's mesh preview. The name is resolved
 * inside the mounted VFS namespace and never reaches the disk, so this shape
 * check is the whole boundary.
 */
export function assertVisualRequest(request: unknown): asserts request is { name: string } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid visual request: expected a plain object');
  }
  if (typeof request.name !== 'string' || request.name.trim() === '') {
    throw new Error('Invalid visual name: expected a non-empty string');
  }
}

/** Assert a request to read the `<project>.assets.json` sidecar (§16.26). */
export function assertAssetCatalogGetRequest(
  request: unknown,
): asserts request is { projectFilePath: string } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid asset catalog request: expected a plain object');
  }
  if (typeof request.projectFilePath !== 'string' || request.projectFilePath.trim() === '') {
    throw new Error('Invalid asset catalog request: projectFilePath must be a non-empty string');
  }
}

/** Presence only — the catalogue is re-derived through `parseAssetCatalog`
 *  before it is written, as `folders` is for the VOB folders sidecar. */
export function assertAssetCatalogSaveRequest(
  request: unknown,
): asserts request is { projectFilePath: string; catalog: unknown } {
  assertAssetCatalogGetRequest(request);
  if (!('catalog' in request)) {
    throw new Error('Invalid asset catalog save request: catalog is required');
  }
}

/** A thumbnail read: the asset's name, resolved by the VFS like a visual's. */
export function assertThumbnailGetRequest(request: unknown): asserts request is { name: string } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid thumbnail request: expected a plain object');
  }
  if (typeof request.name !== 'string' || request.name.trim() === '') {
    throw new Error('Invalid thumbnail name: expected a non-empty string');
  }
}

/** A thumbnail is 96 px of PNG — a few KB; this is a ceiling against a
 *  renderer filling `userData` one write at a time, not a budget. */
export const THUMBNAIL_DATA_URL_MAX = 512 * 1024;
const THUMBNAIL_KEY = /^[0-9a-f]{64}$/;

/**
 * A thumbnail write: the key the cache service minted for a read (a hex
 * digest, so it can never be a path) and the PNG the renderer drew. The bytes
 * are checked again where they are written; this is the shape and the size.
 */
export function assertThumbnailPutRequest(
  request: unknown,
): asserts request is { key: string; dataUrl: string } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid thumbnail request: expected a plain object');
  }
  if (typeof request.key !== 'string' || !THUMBNAIL_KEY.test(request.key)) {
    throw new Error('Invalid thumbnail key: expected a 64-digit hex digest');
  }
  if (typeof request.dataUrl !== 'string' || !request.dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Invalid thumbnail: expected a PNG data URL');
  }
  if (request.dataUrl.length > THUMBNAIL_DATA_URL_MAX) {
    throw new Error('Invalid thumbnail: too large');
  }
}

/** Slots down the children lists, as `setVobPosition` parses it: "0", "0/4". */
const INDEX_PATH = /^\d+(\/\d+)*$/;

/**
 * A Daedalus symbol name: a letter or an underscore, then letters, digits and
 * underscores — the identifier the grammar accepts, and therefore the only shape
 * an `oCItem.instance` can name (`daedalus-parser/grammar.js`).
 *
 * This is the whole of what the *main process* can say about an item instance.
 * Which instances a project actually declares is the renderer's question and
 * only the renderer's: nothing here holds an item index — `ProjectIndex` carries
 * NPCs, dialogs, routines and voice ids and no instances at all, and
 * `ProjectService.primedModels` is a take-once hand-off cache of at most
 * `MAX_PRIMED_MODELS` per-file models, deliberately not a second copy of the
 * renderer's. Building one here would be a new index pass, a new IPC and a
 * lifetime coupling of `WorldService` to `ProjectService`, and it would still
 * have to let every world through that is edited with no script project open.
 */
const DAEDALUS_INSTANCE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isFiniteNumbers(value: unknown, count: number): boolean {
  return Array.isArray(value) && value.length === count
    && value.every((component) => typeof component === 'number' && Number.isFinite(component));
}

function isZenPosition(value: unknown): value is [number, number, number] {
  return isFiniteNumbers(value, 3);
}

/** A colour is four channels — r, g, b and the alpha ZenGin keeps — each a whole
 *  number, because the archive stores each in a byte. Fixed arity, since the
 *  binding reads them positionally: a three-element colour would leave one
 *  channel to whatever the struct happened to hold. */
function isColorChannels(value: unknown, min: number, max: number): boolean {
  return Array.isArray(value) && value.length === 4
    && value.every((channel) => typeof channel === 'number' && Number.isInteger(channel)
      && channel >= min && channel <= max);
}

/**
 * Check one class-property value against its catalogue descriptor.
 *
 * The bounds are read off the descriptor rather than written here, so the number
 * a light's range is refused below is the same number the grid rejects a typed
 * value with — the reason the catalogue carries them at all (`vobClasses.ts`).
 */
function assertClassPropValue(field: FieldDescriptor, side: string, value: unknown): void {
  const where = `${side}.${field.key}`;
  if (field.kind === 'string') {
    if (typeof value !== 'string') {
      throw new Error(`Invalid op: ${where} must be a string`);
    }
    return;
  }
  if (field.kind === 'color') {
    if (!isColorChannels(value, field.min ?? 0, field.max ?? 255)) {
      throw new Error(`Invalid op: ${where} must be four whole channels ${field.min ?? 0}-${field.max ?? 255}`);
    }
    return;
  }
  // A decal's size or offset: two float32s, so finite rather than whole, and
  // fixed arity for `color`'s reason — the binding reads them positionally.
  if (field.kind === 'vec2') {
    const ok = Array.isArray(value) && value.length === 2
      && value.every((part) => typeof part === 'number' && Number.isFinite(part)
        && (field.min === undefined || part >= field.min));
    if (!ok) {
      throw new Error(`Invalid op: ${where} must be two finite numbers${field.min === undefined ? '' : `, ${field.min} or greater`}`);
    }
    return;
  }
  // A boolean is checked by type and by nothing else: there is no value between
  // false and true for a bound to exclude, and `0` is refused rather than
  // coerced — a truthy number reaching a `bool` member is a byte the caller
  // never chose, and every field in this op is invisible in the viewport.
  if (field.kind === 'bool') {
    if (typeof value !== 'boolean') {
      throw new Error(`Invalid op: ${where} must be true or false`);
    }
    return;
  }
  // An enumerator is a whole number and nothing else is checked about it: the
  // set lives in the catalogue's fourth table and is offered by the grid, not
  // enforced here (level-editor.md §16.21). Retail holds values outside every
  // documented set, and an undo writes the `from` side back — so a validator
  // that knew the set would refuse the restore of a value the world already had.
  // Whole, though, and non-negative: the archive member is a `uint32_t`, so 2.5
  // truncates on the cast in C++ and -1 wraps, both reporting success.
  if (field.kind === 'enum') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error(`Invalid op: ${where} must be a whole number`);
    }
    if (value < 0) throw new Error(`Invalid op: ${where} must be 0 or greater`);
    return;
  }
  // The integer check stands in for the finite one rather than following it:
  // `Number.isInteger` already refuses NaN and Infinity, and the two remaining
  // refusals are different facts a caller needs told apart — -1 is a whole
  // number out of range, 1.5 is in range and not one. An `int` field is an
  // `int32_t` in the archive, so a fraction truncates on the cast and reports
  // success, which is why `int` is its own kind and not a float with a rule.
  const whole = field.kind === 'int';
  if (typeof value !== 'number' || !(whole ? Number.isInteger(value) : Number.isFinite(value))) {
    throw new Error(`Invalid op: ${where} must be a ${whole ? 'whole' : 'finite'} number`);
  }
  if (field.min !== undefined && value < field.min) {
    throw new Error(`Invalid op: ${where} must be ${field.min} or greater`);
  }
  if (field.max !== undefined && value > field.max) {
    throw new Error(`Invalid op: ${where} must be ${field.max} or less`);
  }
}

/**
 * Assert a class-property read (level-editor.md §7).
 *
 * A read, but the path is parsed in C++ and used to walk the VOB tree, so it is
 * held to exactly the shape the ops are: the same regex, refused here rather
 * than handed to `ParseIndexPath` to reject.
 */
export function assertVobPropsRequest(
  request: unknown,
): asserts request is { path: string } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid vob props request: expected a plain object');
  }
  if (typeof request.path !== 'string' || !INDEX_PATH.test(request.path)) {
    throw new Error('Invalid vob props request: path must be slot indices separated by "/"');
  }
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
 * Assert a `script:appendInsertNpc` request (level-editor.md §16.19, slice 16
 * C). The instance and waypoint are spliced verbatim into a script line, so
 * the instance must be an identifier and the waypoint must not be able to
 * close the string literal or the line. `INIT_` is refused outright: spawns
 * belong in `STARTUP_`, and the renderer's resolver never picks it.
 */
export function assertAppendInsertNpcRequest(
  request: unknown,
): asserts request is { filePath: string; functionName: string; npcInstance: string; spawnPoint: string } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid appendInsertNpc request: expected a plain object');
  }
  for (const key of ['filePath', 'functionName', 'npcInstance', 'spawnPoint'] as const) {
    if (typeof request[key] !== 'string' || (request[key] as string).trim() === '') {
      throw new Error(`Invalid appendInsertNpc request: ${key} must be a non-empty string`);
    }
  }
  if (/^INIT_/i.test(request.functionName as string)) {
    throw new Error('Invalid appendInsertNpc request: functionName must not be an INIT_ function');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(request.npcInstance as string)) {
    throw new Error('Invalid appendInsertNpc request: npcInstance must be an identifier');
  }
  if (/["\r\n]/.test(request.spawnPoint as string)) {
    throw new Error('Invalid appendInsertNpc request: spawnPoint must not contain quotes or line breaks');
  }
}

/** Assert a request to read the `<worldname>.folders.json` sidecar (VOB folders slice). */
export function assertVobFoldersGetRequest(
  request: unknown,
): asserts request is { worldPath: string } {
  if (!isPlainObject(request)) {
    throw new Error('Invalid vob folders request: expected a plain object');
  }
  if (typeof request.worldPath !== 'string' || request.worldPath.trim() === '') {
    throw new Error('Invalid vob folders request: worldPath must be a non-empty string');
  }
}

/**
 * Assert a request to write the sidecar. `folders` is only checked for
 * presence here — its content is untrusted regardless of this shape check, so
 * `WorldFoldersService.save`'s caller re-derives it through `parseVobFolders`
 * rather than writing whatever a compromised renderer sent.
 */
export function assertVobFoldersSaveRequest(
  request: unknown,
): asserts request is { worldPath: string; folders: unknown } {
  assertVobFoldersGetRequest(request);
  if (!('folders' in request)) {
    throw new Error('Invalid vob folders save request: folders is required');
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
      && op.op !== 'SetVobClassProp' && op.op !== 'AddVob' && op.op !== 'ReparentVob'
      && op.op !== 'MoveWaypoint' && op.op !== 'RenameWaypoint' && op.op !== 'AddWaypoint'
      && op.op !== 'SetWaypointEdge' && op.op !== 'DeleteWaypoint'
      && op.op !== 'DeleteVob') {
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

    // Beside the move rather than after the `vob` check, and for the same
    // reason: a rename is a waynet op and has neither a `vob` nor a `path`. Its
    // own shape is the difference — both sides are names, so a move's
    // three-number check would refuse every legal one.
    if (op.op === 'RenameWaypoint') {
      if (typeof op.waypoint !== 'number' || !Number.isInteger(op.waypoint) || op.waypoint < 0) {
        throw new Error('Invalid op: waypoint must be a non-negative integer');
      }
      // `from` is the guard the bare index needs — this op has no separate
      // `name` field because the name it replaces *is* its origin.
      if (typeof op.from !== 'string') {
        throw new Error('Invalid op: from must be the name the waypoint has now');
      }
      // Non-empty, because a waypoint with no name cannot be addressed by the
      // index+name pair at all. Whether the name is already another waypoint's
      // is a question only the point list can answer, and the binding does.
      if (typeof op.to !== 'string' || op.to.length === 0) {
        throw new Error('Invalid op: to must be a non-empty name');
      }
      continue;
    }

    // The third waynet op, beside its two siblings and for the same reason. Its
    // own shape is the difference again: the sides are *nullable* positions,
    // because a null side means "not in the waynet" and one op shape is both the
    // append and the removal it inverts to.
    if (op.op === 'AddWaypoint') {
      if (typeof op.waypoint !== 'number' || !Number.isInteger(op.waypoint) || op.waypoint < 0) {
        throw new Error('Invalid op: waypoint must be a non-negative integer');
      }
      // At the top level rather than on a side: it is the description on the
      // side that exists and the index's guard on the side that does not, so
      // there is no direction in which it may be absent. Whether it is a name
      // some other waypoint already carries is a question only the point list
      // can answer, and the binding does.
      if (typeof op.name !== 'string' || op.name.length === 0) {
        throw new Error('Invalid op: name must be a non-empty name');
      }
      for (const field of ['from', 'to'] as const) {
        if (op[field] !== null && !isFiniteNumbers(op[field], 3)) {
          throw new Error(`Invalid op: ${field} must be three finite numbers, or null`);
        }
      }
      // Exactly one side in the waynet. Two would describe no edit and none
      // would describe nothing, and both would reach the binding as an append.
      if ((op.from === null) === (op.to === null)) {
        throw new Error('Invalid op: exactly one of from and to must be null');
      }
      continue;
    }

    // The fourth waynet op, beside its three siblings and for the same reason.
    // Its own shape is the difference again: an edge is a *pair*, so each end
    // carries the index+name pair the others carry once, and the sides are
    // booleans — whether the edge is there — rather than a payload.
    if (op.op === 'SetWaypointEdge') {
      for (const end of ['a', 'b'] as const) {
        if (typeof op[end] !== 'number' || !Number.isInteger(op[end]) || (op[end] as number) < 0) {
          throw new Error(`Invalid op: ${end} must be a non-negative integer`);
        }
        if (typeof op[`${end}Name`] !== 'string') {
          throw new Error(`Invalid op: ${end}Name must be that waypoint's name`);
        }
      }
      // By index, because that is the address. Two waypoints may legally share a
      // name, and an edge from a waypoint to itself is the one thing this layer
      // can rule out without the point list.
      if (op.a === op.b) throw new Error('Invalid op: a waypoint cannot be joined to itself');
      for (const field of ['from', 'to'] as const) {
        if (typeof op[field] !== 'boolean') {
          throw new Error(`Invalid op: ${field} must be a boolean`);
        }
      }
      // Exactly one side has the edge. Sides that agree describe no edit and
      // would still reach the binding as a join or an unjoin nobody asked for.
      if (op.from === op.to) {
        throw new Error('Invalid op: exactly one of from and to must have the edge');
      }
      continue;
    }

    // The fifth waynet op, and the waynet's own `DeleteVob` (§16.7, W4). Beside
    // its siblings for their reason — it has neither a `vob` nor a `path` — and
    // exhaustive about its keys for the delete's: it is a barrier, so a side
    // arriving on it is an inverse somebody expected it to have, and a field
    // waved through here is that expectation reaching the binding unchallenged.
    if (op.op === 'DeleteWaypoint') {
      if (typeof op.waypoint !== 'number' || !Number.isInteger(op.waypoint) || op.waypoint < 0) {
        throw new Error('Invalid op: waypoint must be a non-negative integer');
      }
      // Non-empty, because it is the guard rather than a label: this op deletes
      // whatever the index names, and the name is what says the index is still
      // the one the op was made against.
      if (typeof op.name !== 'string' || op.name.length === 0) {
        throw new Error('Invalid op: name must be the waypoint\'s name');
      }
      for (const key of Object.keys(op)) {
        if (key !== 'op' && key !== 'waypoint' && key !== 'name') {
          throw new Error(
            `Invalid op: a DeleteWaypoint carries only a waypoint and a name, not ${key}`,
          );
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

    if (op.op === 'DeleteVob') {
      // A `vob` and a `path`, both already checked above, and **nothing else**.
      // The exhaustive key check is not tidiness here: this is the one op with
      // no inverse (§15), so a delete arriving with a `from` is either a
      // mislabelled `AddVob` — whose null-side rule means "the op describes the
      // VOB completely" — or something reaching for an inverse that does not
      // exist. Ignoring the field would let both through as an ordinary delete.
      for (const key of Object.keys(op)) {
        if (key !== 'op' && key !== 'vob' && key !== 'path') {
          throw new Error(`Invalid op: a DeleteVob carries only a vob and a path, not ${key}`);
        }
      }
      continue;
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
      // **It crosses this boundary as an add, never as its own inverse.** The
      // delete direction is a real direction — `writeOp` reads a null side as
      // `deleteVob` — but it is built by `invertOp` off the undo stack in the
      // main process and is not a request. Arriving here it is a subtree delete
      // wearing an add's name: none of `DeleteVob`'s guards apply (§16 has the
      // reasons they exist), `isBarrierOp` is false so `applyOps` records it as
      // invertible, and its inverse inserts a bare `zCVob` where a retail
      // `oCMobInter` and its children stood — the "undo that looks like it
      // worked" the `DeleteVob` doc comment says must never happen.
      //
      // So `from` is null and `to` is the spec, always. Both null is an op that
      // does nothing; neither null is an add and a delete at once, which
      // `writeOp` would read as an insert in both directions.
      if (op.to === null) {
        throw new Error('Invalid op: an AddVob with a null to is a delete — send a DeleteVob');
      }
      if (op.from !== null) {
        throw new Error('Invalid op: an AddVob adds — from must be null');
      }
      const spec = op.to;
      if (!isPlainObject(spec)) throw new Error('Invalid op: the vob to add must be an object');
      for (const [key, value] of Object.entries(spec)) {
        if (key === 'class') {
          // A closed set, and the one key here whose value the binding cannot
          // fall back on: the class is the object's C++ type, so a class it has
          // no construction for would either throw in C++ or — worse, if this
          // waved it through as a tag — be authored as a bare `zCVob` wearing
          // the name, on which every `SetVobClassProp` is then refused. The set
          // is `zen-world`'s, shared with the dialog that offers it, so a class
          // the binding learns is not refused here by omission.
          if (!isAuthorableVobClass(value)) {
            throw new Error(`Invalid op: no class construction exists for ${JSON.stringify(value)}`);
          }
        } else if (key === 'instance') {
          // The shape of a Daedalus symbol is the whole of what this process can
          // say about an item instance — it holds no item index, and a world may
          // be edited with no script project open. The renderer makes the
          // existence check, exactly as it does for `SetVobClassProp`.
          if (typeof value !== 'string' || !DAEDALUS_INSTANCE.test(value)) {
            throw new Error(`Invalid op: instance must be a Daedalus instance name, not ${JSON.stringify(value)}`);
          }
        } else if (key === 'name' || key === 'visual') {
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
      // The instance belongs to the one class that has one, in both directions:
      // an `oCItem` without it spawns nothing the engine can resolve, and any
      // other class has no such field, so naming one is a mistake about the
      // class rather than a value the binding should drop.
      if (('class' in spec ? spec.class : 'zCVob') === 'oCItem') {
        if (!('instance' in spec)) throw new Error('Invalid op: an oCItem needs an instance');
      } else if ('instance' in spec) {
        throw new Error('Invalid op: only an oCItem carries an instance');
      }
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
          // A decal field is looked up in its own table: it is legal only on a
          // VOB whose visual is a decal, and this process holds no world to ask.
          // So the shape is checked here and the per-VOB refusal is the
          // binding's — the split `oCItem.instance` already has, for the same
          // reason and in the other direction.
          const base = baseFieldOf(key) ?? decalFieldOf(key);
          if (key === 'name' || key === 'visual') {
            if (typeof value !== 'string') {
              throw new Error(`Invalid op: ${side}.${key} must be a string`);
            }
          } else if (VOB_FLAG_KEYS.includes(key)) {
            if (typeof value !== 'boolean') {
              throw new Error(`Invalid op: ${side}.${key} must be a boolean`);
            }
          } else if (base !== null) {
            // The base and decal fields, which have no column, checked through
            // the catalogue's own descriptor exactly as a class field is — the
            // bounds are the packed vob layout's bit fields for three of them,
            // and a value outside those is written truncated by ZenGin's own
            // writer and reported as written. Both sides, because `from` is what
            // an undo writes.
            assertClassPropValue(base, side, value);
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

    if (op.op === 'SetVobClassProp') {
      // The first op whose legal key set depends on which VOB it addresses, and
      // this validator is stateless with respect to the world: no index, no
      // handle, nothing but the payload. `className` is therefore the only thing
      // that can make a key legal here — a declaration of intent the binding
      // re-checks against the VOB's real type, exactly as `writeOp` re-checks
      // the path a reparent landed on.
      //
      // The catalogue in `zen-world` is what decides, rather than a fourth
      // hand-maintained allowlist beside `VOB_FLAG_KEYS`: the op builder, this
      // check and the property grid all read the one table, so adding a class is
      // one entry rather than three that have to agree by hand.
      if (typeof op.className !== 'string' || classPropKeys(op.className).length === 0) {
        throw new Error(`Invalid op: no class properties are known for ${String(op.className)}`);
      }
      const className = op.className;
      const sides = ['from', 'to'] as const;
      for (const side of sides) {
        if (!isPlainObject(op[side])) {
          throw new Error(`Invalid op: ${side} must be an object of class properties`);
        }
        for (const [key, value] of Object.entries(op[side])) {
          const field = fieldOf(className, key);
          if (field === null) {
            throw new Error(`Invalid op: a ${className} has no class property ${key}`);
          }
          assertClassPropValue(field, side, value);
        }
      }
      // Both sides walked, not just `to`: the walk is what refuses a value, and
      // an unchecked `from` is the side an undo writes — so skipping it would
      // hand C++ a colour nobody looked at, at the moment the user is trying to
      // get back to where they were.
      // The one class field whose value is a name in *another file*: an `oCItem`
      // spawns the Daedalus instance it names, and a name no script declares is
      // a documented ZenGin crash (level-editor.md §14.1). The renderer refuses
      // a name absent from the project's item index; this is the half of it that
      // holds with no project loaded at all — a value that could not be a
      // Daedalus symbol could not be an instance under any scripts.
      //
      // **`to` only, deliberately.** `from` is the value the world already
      // holds, and a hand-edited or third-party world is free to hold something
      // this shape refuses. Checking it would refuse the one edit that repairs
      // such a VOB, and refuse the undo of an edit that has already applied.
      const to = op.to as Record<string, unknown>;
      if (className === 'oCItem' && typeof to.instance === 'string'
        && !DAEDALUS_INSTANCE.test(to.instance)) {
        throw new Error(
          `Invalid op: to.instance must be a Daedalus instance name, not ${JSON.stringify(to.instance)}`,
        );
      }
      const keys = sides.map((side) => Object.keys(op[side] as object).sort());
      if (keys[0].length === 0) throw new Error('Invalid op: sets no class properties');
      if (keys[0].join() !== keys[1].join()) {
        throw new Error('Invalid op: from and to must carry the same class properties');
      }
      // Exhaustively, in the `DeleteVob` idiom: no field in this slice can move
      // the culling box, so the op has no `fromBbox`/`toBbox` — and an op that
      // arrived carrying one is either a `SetVobProp` mislabelled or a caller
      // expecting a refit that will not happen.
      for (const key of Object.keys(op)) {
        if (key !== 'op' && key !== 'vob' && key !== 'path' && key !== 'className'
          && key !== 'from' && key !== 'to') {
          throw new Error(`Invalid op: a SetVobClassProp carries no ${key}`);
        }
      }
      continue;
    }

    if (!isZenPosition(op.from)) throw new Error('Invalid op: from must be three finite numbers');
    if (!isZenPosition(op.to)) throw new Error('Invalid op: to must be three finite numbers');
  }
}
