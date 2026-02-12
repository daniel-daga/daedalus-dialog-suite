import { TreeSitterNode } from '../semantic-model';

export type PrimitiveValue = string | number | boolean;

export function parseLiteralOrIdentifier(node: TreeSitterNode): PrimitiveValue {
  if (node.type === 'number') {
    return Number(node.text);
  }

  if (node.type === 'boolean') {
    return node.text.toLowerCase() === 'true';
  }

  return node.text;
}

