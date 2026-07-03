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

const SAVE_FILE_OPTION_KEYS = ['skipValidation', 'forceOnErrors', 'overwriteExternal'] as const;

/**
 * Assert a saveFile options payload is undefined or a plain object whose only
 * keys are the known boolean flags.
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
    if (typeof options[key] !== 'boolean') {
      throw new Error(`Invalid options payload: option "${key}" must be a boolean`);
    }
  }
}
