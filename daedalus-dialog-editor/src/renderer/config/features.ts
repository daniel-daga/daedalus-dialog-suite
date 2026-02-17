const readImportMetaEnv = (): Record<string, string | undefined> | null => {
  try {
    const runtimeGetter = Function('try { return import.meta?.env ?? null; } catch { return null; }');
    const env = runtimeGetter();
    if (env && typeof env === 'object') {
      return env as Record<string, string | undefined>;
    }
  } catch {
    // Runtime environment may not support import.meta in Function context.
  }
  return null;
};

const readEnvFlag = (name: string): boolean | null => {
  const metaEnv = readImportMetaEnv();
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = metaEnv?.[name] ?? processEnv?.[name];
  if (value === undefined) return null;
  return value === '1' || value.toLowerCase() === 'true';
};

export const isWritableQuestEditorEnabled = (): boolean => {
  const envValue = readEnvFlag('VITE_WRITABLE_QUEST_EDITOR');
  if (envValue !== null) {
    return envValue;
  }

  try {
    const localValue = window.localStorage.getItem('feature.writableQuestEditor');
    if (localValue === '0' || localValue === 'false') return false;
    if (localValue === '1' || localValue === 'true') return true;
  } catch {
    // Ignore unavailable localStorage.
  }

  return true;
};
