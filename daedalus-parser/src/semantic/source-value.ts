/** String contents and source expressions have different rendering contracts. */
export type SourceValue =
  | { kind: 'string'; value: string }
  | { kind: 'expression'; source: string };

export function renderSourceValue(value: SourceValue): string {
  if (value.kind === 'expression') return value.source;
  // Daedalus has no escapes. Backslashes and newlines are literal characters;
  // an embedded double quote cannot be represented inside a string token.
  if (value.value.includes('"')) {
    throw new Error('Daedalus string contents cannot contain a double quote');
  }
  return `"${value.value}"`;
}

/** Compatibility adapter for editable fields with legacy …IsExpression flags. */
export function renderStringValue(value: string, isExpression = false): string {
  return renderSourceValue(isExpression
    ? { kind: 'expression', source: value }
    : { kind: 'string', value });
}
