import { TreeSitterNode } from '../semantic-model';

/**
 * Is this child of an argument_list an actual argument? Punctuation is not, and
 * neither is a comment: comments are grammar extras and can appear anywhere
 * inside a call, so counting one as an argument shifts every real argument.
 */
export function isArgumentNode(node: TreeSitterNode): boolean {
  return (
    node.type !== ',' && node.type !== '(' && node.type !== ')' && node.type !== 'comment'
  );
}

/**
 * Parse a tree-sitter argument_list node into normalized argument text values.
 */
export function parseArguments(argsNode: TreeSitterNode): string[] {
  const args: string[] = [];
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (isArgumentNode(child)) {
      args.push(normalizeArgumentText(child));
    }
  }
  return args;
}

/**
 * A single call argument captured with enough information to regenerate it
 * verbatim: `raw` is the exact source text (quotes intact for strings), `value`
 * is the normalized form (quotes stripped) used for display/structured fields,
 * and `isString` records whether the source node was a string literal so
 * generators can decide whether to re-quote.
 */
export interface ParsedArg {
  raw: string;
  value: string;
  isString: boolean;
}

/**
 * Parse a tree-sitter argument_list node into detailed argument descriptors
 * that preserve the raw source text (fidelity by construction).
 */
export function parseArgumentsDetailed(argsNode: TreeSitterNode): ParsedArg[] {
  const args: ParsedArg[] = [];
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (isArgumentNode(child)) {
      args.push({
        raw: child.text.trim(),
        value: normalizeArgumentText(child),
        isString: child.type === 'string'
      });
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
