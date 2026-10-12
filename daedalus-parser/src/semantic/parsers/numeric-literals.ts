/** Keep a numeric token verbatim whenever conversion would change its spelling. */
export function parseNumericLiteral(text: string): number | string {
  const value = Number(text);
  // JavaScript can round large integers, remove decimal zeroes or leading
  // zeroes, and respell `1e5`, `.5` or `5.` (#383).
  // Canonical finite numbers stay numbers for existing editor consumers.
  return Number.isFinite(value) && String(value) === text ? value : text;
}

/** Emit edited numeric values in plain decimal, never JavaScript's exponent notation. */
export function formatNumericValue(value: number | string | boolean): string {
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) throw new Error('Cannot generate a non-finite Daedalus number.');
  const text = String(value);
  const [mantissa, exponent] = text.split('e');
  if (exponent === undefined) return text;
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const point = unsigned.includes('.') ? unsigned.indexOf('.') : unsigned.length;
  const digits = unsigned.replace('.', '');
  const position = point + Number(exponent);
  const sign = negative ? '-' : '';
  if (position <= 0) return `${sign}0.${'0'.repeat(-position)}${digits}`;
  if (position >= digits.length) return `${sign}${digits}${'0'.repeat(position - digits.length)}`;
  return `${sign}${digits.slice(0, position)}.${digits.slice(position)}`;
}
