/**
 * Daedalus identifiers are case-insensitive. The simulator accepts whitespace
 * around references before using them as map keys.
 */
export const canonicalizeIdentifier = (value: string): string => value.trim().toLowerCase();
