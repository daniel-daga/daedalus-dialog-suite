import { TreeSitterNode } from '../semantic-model';

/**
 * Is this child of an argument_list an actual argument? Punctuation is not, and
 * neither is a comment: comments are grammar extras and can appear anywhere
 * inside a call, so counting one as an argument shifts every real argument.
 * Reads the node type alone, so a cursor can ask before materialising a node.
 */
export function isArgumentType(type: string): boolean {
  return type !== ',' && type !== '(' && type !== ')' && type !== 'comment';
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
  // A cursor, so punctuation and comments cost a type read rather than a node,
  // and each argument's text is read once for both forms (#541).
  const cursor = argsNode.walk();
  if (!cursor.gotoFirstChild()) return args;
  do {
    const type = cursor.nodeType;
    if (!isArgumentType(type)) continue;
    const text = cursor.currentNode.text;
    args.push({
      raw: text.trim(),
      value: type === 'string' ? text.replace(/^"/, '').replace(/"$/, '') : text.trim(),
      isString: type === 'string'
    });
  } while (cursor.gotoNextSibling());
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
 * literal (including `0` and negatives) becomes a number when it is a safe
 * integer. Source-call metadata retains noncanonical spelling. Anything else (a
 * constant name, an expression, etc.) keeps its raw trimmed text so it can be
 * regenerated verbatim.
 */
export function parseNumericArg(raw: string): number | string {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  return /^-?\d+$/.test(trimmed) && Number.isSafeInteger(value) ? value : trimmed;
}
