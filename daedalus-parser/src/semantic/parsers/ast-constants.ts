export const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);
export const CONDITION_MODE_BLOCKING_STATEMENTS = new Set(['if_statement', 'return_statement']);
export const CONDITION_ALLOWED_PARENT_TYPES = new Set(['if_statement', 'parenthesized_expression']);
export const ANCESTOR_TRAVERSAL_BOUNDARY_TYPES = new Set(['if_statement', 'block', 'function_declaration']);

export function isComparisonOperator(operator: string | null | undefined): operator is string {
  return !!operator && COMPARISON_OPERATORS.has(operator);
}

export function isLogicalOperator(operator: string | null | undefined): boolean {
  return operator === '&&' || operator === '||';
}

export function getBinaryOperator(node: { childCount: number; child(index: number): { text: string } }): string | null {
  return node.childCount >= 2 ? node.child(1).text : null;
}

export function isConditionModeBlockingStatement(nodeType: string): boolean {
  return CONDITION_MODE_BLOCKING_STATEMENTS.has(nodeType);
}

export function isConditionAllowedParentType(nodeType: string): boolean {
  return CONDITION_ALLOWED_PARENT_TYPES.has(nodeType);
}

export function isAncestorTraversalBoundaryType(nodeType: string): boolean {
  return ANCESTOR_TRAVERSAL_BOUNDARY_TYPES.has(nodeType);
}
