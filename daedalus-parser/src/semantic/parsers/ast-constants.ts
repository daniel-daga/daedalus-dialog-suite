export const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);

export function isComparisonOperator(operator: string | null | undefined): operator is string {
  return !!operator && COMPARISON_OPERATORS.has(operator);
}

export function isLogicalOperator(operator: string | null | undefined): boolean {
  return operator === '&&' || operator === '||';
}

export function getBinaryOperator(node: { childCount: number; child(index: number): { text: string } }): string | null {
  return node.childCount >= 2 ? node.child(1).text : null;
}
