import type { TreeSitterNode } from '../semantic-model';

/** Any comment in `node`'s subtree, itself included. Reads the cursor, so no node is materialised (#541). */
export function hasComment(node: TreeSitterNode): boolean {
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

export function getBinaryOperator(node: { childCount: number; child(index: number): { text: string } }): string | null {
  for (let index = 0; index < node.childCount; index += 1) {
    const text = node.child(index).text;
    if (BINARY_OPERATORS.has(text)) return text;
  }
  return null;
}

// Comments are Tree-sitter extras and can appear between operands and operator;
// scan for the exact token instead of assuming a fixed child index.
export function getAssignmentOperator(node: { childCount: number; child(index: number): { text: string } }): string {
  for (let index = 0; index < node.childCount; index += 1) {
    const text = node.child(index).text;
    if (ASSIGNMENT_OPERATORS.has(text)) return text;
  }
  return '=';
}

export function isConditionModeBlockingStatement(nodeType: string): boolean {
  return CONDITION_MODE_BLOCKING_STATEMENTS.has(nodeType);
}
