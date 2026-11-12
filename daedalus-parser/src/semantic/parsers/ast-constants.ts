import type { TreeSitterNode } from '../semantic-model';

/**
 * Any comment in `node`'s subtree, itself included. Reads the cursor, so no
 * node is materialised (#541). A comment cannot exist without a `//` or `/*`
 * in the text, so most calls answer without walking at all; a string literal
 * can only make the gate say yes, and the walk then settles it.
 */
export function hasComment(node: TreeSitterNode): boolean {
  const text = node.text;
  if (!text.includes('//') && !text.includes('/*')) return false;
  const cursor = node.walk();
  for (;;) {
    if (cursor.nodeType === 'comment') return true;
    if (cursor.gotoFirstChild()) continue;
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) return false;
    }
  }
}

export const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);
const BINARY_OPERATORS = new Set(['||', '&&', '|', '&', '==', '!=', '<', '<=', '>', '>=', '<<', '>>', '+', '-', '*', '/', '%']);
const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=']);
export const CONDITION_MODE_BLOCKING_STATEMENTS = new Set(['if_statement', 'return_statement']);

export function isComparisonOperator(operator: string | null | undefined): operator is string {
  return !!operator && COMPARISON_OPERATORS.has(operator);
}

export function isLogicalOperator(operator: string | null | undefined): boolean {
  return operator === '&&' || operator === '||';
}

export function getBinaryOperator(node: TreeSitterNode): string | null {
  const cursor = node.walk();
  if (!cursor.gotoFirstChild()) return null;
  do {
    if (BINARY_OPERATORS.has(cursor.nodeType)) return cursor.nodeType;
  } while (cursor.gotoNextSibling());
  return null;
}

// Comments are Tree-sitter extras and can appear between operands and operator;
// scan for the exact token instead of assuming a fixed child index. The cursor
// reads each child's type instead of materialising and reading its text (#541).
export function getAssignmentOperator(node: TreeSitterNode): string {
  const cursor = node.walk();
  if (!cursor.gotoFirstChild()) return '=';
  do {
    if (ASSIGNMENT_OPERATORS.has(cursor.nodeType)) return cursor.nodeType;
  } while (cursor.gotoNextSibling());
  return '=';
}

export function isConditionModeBlockingStatement(nodeType: string): boolean {
  return CONDITION_MODE_BLOCKING_STATEMENTS.has(nodeType);
}
