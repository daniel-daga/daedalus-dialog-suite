/**
 * Shared handling for action fields that hold either a plain integer literal
 * or a constant/expression name (e.g. quantity, damage, seconds, chapter).
 * Mirrors the parser's `parseNumericArg` (daedalus-parser
 * src/semantic/parsers/argument-parsing.ts): plain integer text (including
 * "0" and negatives) is stored as a number; anything else is kept as the
 * raw string so identifiers like "Gold_Amount" round-trip without corruption.
 */

/** Convert a text field's raw input into the value stored on the action. */
export function parseNumericOrStringField(input: string): number | string {
  return /^-?\d+$/.test(input) ? Number(input) : input;
}

/** Render a numeric-or-string field value for display in a text input. */
export function displayNumericOrStringField(value: number | string | undefined): string {
  return value === undefined ? '' : String(value);
}
