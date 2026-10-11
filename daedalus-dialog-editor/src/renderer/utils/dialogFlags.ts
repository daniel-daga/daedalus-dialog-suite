/**
 * Reading a C_INFO flag (`important`, `permanent`) as the parser
 * actually delivers it (#283). `TRUE`/`FALSE` are identifiers in Daedalus, so
 * they arrive as the strings "TRUE"/"FALSE" rather than booleans, and the
 * property keeps its source casing, so `Permanent = FALSE` sits under
 * `Permanent`. The model is left as parsed so an unedited file saves unchanged.
 */

type FlagName = 'important' | 'permanent';

/** The key a flag is stored under: its source spelling if present, else the canonical name. */
export const dialogFlagKey = (properties: object, name: FlagName): string =>
  Object.keys(properties).find((key) => key.toLowerCase() === name) ?? name;

export const readDialogFlag = (properties: object, name: FlagName): boolean => {
  const value = (properties as Record<string, unknown>)[dialogFlagKey(properties, name)];
  if (typeof value === 'string') {
    const text = value.trim().toUpperCase();
    return text !== 'FALSE' && text !== '0' && text !== '';
  }
  return Boolean(value);
};
