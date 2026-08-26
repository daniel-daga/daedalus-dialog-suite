/**
 * Cheap structural assertions for IPC payloads at the main-process boundary.
 *
 * These are boundary hygiene, not a schema library: the services already fail
 * safe inside try/catch, but a compromised renderer should be rejected early
 * with a clear error rather than reaching deep service internals.
 */

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
