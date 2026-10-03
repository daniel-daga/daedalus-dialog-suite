import { TreeSitterNode } from '../semantic-model';
import { normalizeArgumentText } from './argument-parsing';
import { parseNumericLiteral } from './numeric-literals';

export type PrimitiveValue = string | number | boolean;

type ParseLiteralOptions = {
  normalizeStringLiterals?: boolean;
  trimNonLiterals?: boolean;
};

export function parseLiteralOrIdentifier(
  node: TreeSitterNode,
  options: ParseLiteralOptions = {}
): PrimitiveValue {
  const { normalizeStringLiterals = false, trimNonLiterals = false } = options;

  if (node.type === 'number') {
    return parseNumericLiteral(node.text);
  }

  if (node.type === 'boolean') {
    return node.text.toLowerCase() === 'true';
  }

  if (node.type === 'string') {
    return normalizeStringLiterals ? normalizeArgumentText(node) : node.text;
  }

  return trimNonLiterals ? node.text.trim() : node.text;
}
