/**
 * Pure utility functions for path manipulation and identifier normalisation.
 * Extracted from ThreeColumnLayout.tsx.
 */

export function normalizeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    return fallback;
  }

  return /^[0-9]/.test(normalized) ? `N_${normalized}` : normalized;
}

export function makeUniqueName(baseName: string, existing: Set<string>): string {
  // Daedalus identifiers are case-insensitive
  const taken = new Set(Array.from(existing, (name) => name.toUpperCase()));
  if (!taken.has(baseName.toUpperCase())) {
    return baseName;
  }

  let suffix = 1;
  let candidate = `${baseName}_${suffix}`;
  while (taken.has(candidate.toUpperCase())) {
    suffix += 1;
    candidate = `${baseName}_${suffix}`;
  }

  return candidate;
}

/**
 * Make a user-typed value safe to embed in generated Daedalus source:
 * Daedalus string literals have no escape sequences, so a raw quote would
 * terminate the literal and a newline would break the line (or a trailing
 * // comment).
 */
export function sanitizeDaedalusString(value: string): string {
  return value.replace(/"/g, "'").replace(/\s*[\r\n]+\s*/g, ' ');
}

export function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/');
}

export function getDirectoryName(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
}

export function joinPath(directory: string, fileName: string): string {
  if (!directory) {
    return fileName;
  }

  const normalized = normalizePath(directory).replace(/\/+$/g, '');
  return `${normalized}/${fileName}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalise a dialog property that can be either a plain function-name string
 * or an object with an optional `name` field (as produced by the parser for
 * inline function references).  Returns the string name, or `undefined` when
 * neither form yields a value.
 */
export function extractFunctionName(
  ref: string | { name?: string } | null | undefined
): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'string') return ref || undefined;
  return ref.name || undefined;
}
