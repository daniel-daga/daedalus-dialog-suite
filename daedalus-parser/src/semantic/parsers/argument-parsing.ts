import { TreeSitterNode } from '../semantic-model';

/**
 * Parse a tree-sitter argument_list node into normalized argument text values.
 */
export function parseArguments(argsNode: TreeSitterNode): string[] {
  const args: string[] = [];
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (child.type !== ',' && child.type !== '(' && child.type !== ')') {
      args.push(normalizeArgumentText(child));
    }
  }
  return args;
}

/**
 * Normalize argument text, removing only outer quotes for string nodes.
 */
export function normalizeArgumentText(node: TreeSitterNode): string {
  if (node.type === 'string') {
    return node.text.replace(/^"/, '').replace(/"$/, '');
  }
  return node.text.trim();
}

/**
 * Parse a numeric argument while preserving source fidelity: a plain integer
 * literal (including `0` and negatives) becomes a number; anything else (a
 * constant name, an expression, etc.) keeps its raw trimmed text so it can be
 * regenerated verbatim.
 */
export function parseNumericArg(raw: string | undefined, fallback: number): number | string {
  if (raw === undefined || raw === '') return fallback;
  const trimmed = raw.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}
