import type { DialogCondition } from '../../../types/global';

type ParseSuccess = {
  ok: true;
  conditions: DialogCondition[];
  mode: 'structured' | 'generic-expression';
};

type ParseFailure = {
  ok: false;
  error: string;
};

export type ConditionExpressionParseResult = ParseSuccess | ParseFailure;

const COMPARISON_OPERATOR_PATTERN = /(==|!=|<=|>=|<|>)/;

const trimOuterParens = (value: string): string => {
  let current = value.trim();
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0;
    let wrapsWhole = true;
    for (let index = 0; index < current.length; index += 1) {
      const char = current[index];
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth === 0 && index < current.length - 1) {
        wrapsWhole = false;
        break;
      }
      if (depth < 0) {
        wrapsWhole = false;
        break;
      }
    }
    if (!wrapsWhole) break;
    current = current.slice(1, -1).trim();
  }
  return current;
};

const splitTopLevelByOperator = (
  expression: string,
  operator: '&&' | '||'
): { ok: true; segments: string[] } | { ok: false; error: string } => {
  const segments: string[] = [];
  let depth = 0;
  let startIndex = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth < 0) {
        return { ok: false, error: 'Unbalanced parentheses in condition expression.' };
      }
      continue;
    }

    if (depth === 0 && expression.startsWith(operator, index)) {
      segments.push(expression.slice(startIndex, index).trim());
      startIndex = index + operator.length;
      index += operator.length - 1;
    }
  }

  if (depth !== 0) {
    return { ok: false, error: 'Unbalanced parentheses in condition expression.' };
  }

  segments.push(expression.slice(startIndex).trim());

  if (segments.some((segment) => segment.length === 0)) {
    return { ok: false, error: 'Condition expression contains an empty clause.' };
  }

  return { ok: true, segments };
};

const normalizeLiteral = (rawValue: string): string | number | boolean => {
  const trimmed = rawValue.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseSimpleClause = (clause: string): DialogCondition | null => {
  const normalizedClause = trimOuterParens(clause);

  const knowsMatch = normalizedClause.match(/^Npc_KnowsInfo\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/i);
  if (knowsMatch) {
    return {
      type: 'NpcKnowsInfoCondition',
      npc: knowsMatch[1].trim(),
      dialogRef: knowsMatch[2].trim()
    };
  }

  const deadMatch = normalizedClause.match(/^(!)?\s*Npc_IsDead\s*\(\s*([^)]+?)\s*\)$/i);
  if (deadMatch) {
    return {
      type: 'NpcIsDeadCondition',
      npc: deadMatch[2].trim(),
      negated: Boolean(deadMatch[1])
    };
  }

  const variableMatch = normalizedClause.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (variableMatch) {
    return {
      type: 'VariableCondition',
      variableName: variableMatch[1].trim(),
      operator: variableMatch[2] as '==' | '!=' | '<=' | '>=' | '<' | '>',
      value: normalizeLiteral(variableMatch[3]),
      negated: false
    };
  }

  return null;
};

const containsMalformedComparison = (segment: string): boolean => {
  const normalizedSegment = trimOuterParens(segment);
  if (!COMPARISON_OPERATOR_PATTERN.test(normalizedSegment)) {
    return false;
  }

  return !/^([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.test(normalizedSegment);
};

export const validateConditionExpressionSyntax = (expression: string): ParseFailure | { ok: true } => {
  const trimmed = expression.trim();
  if (!trimmed) {
    return { ok: false, error: 'Condition expression cannot be empty.' };
  }

  const orSplit = splitTopLevelByOperator(trimmed, '||');
  if (!orSplit.ok) {
    return { ok: false, error: orSplit.error };
  }

  const andSplit = splitTopLevelByOperator(trimmed, '&&');
  if (!andSplit.ok) {
    return { ok: false, error: andSplit.error };
  }

  const segmentsToValidate = orSplit.segments.length > 1 ? orSplit.segments : andSplit.segments;
  if (segmentsToValidate.some((segment) => containsMalformedComparison(segment))) {
    return { ok: false, error: 'Invalid comparison clause in condition expression.' };
  }

  return { ok: true };
};

export const parseConditionExpressionToConditions = (expression: string): ConditionExpressionParseResult => {
  const trimmed = expression.trim();
  const syntaxValidation = validateConditionExpressionSyntax(trimmed);
  if (!syntaxValidation.ok) {
    return syntaxValidation;
  }

  const orSplit = splitTopLevelByOperator(trimmed, '||');
  if (!orSplit.ok) {
    return orSplit;
  }
  if (orSplit.segments.length > 1) {
    return {
      ok: true,
      mode: 'generic-expression',
      conditions: [{ type: 'Condition', condition: trimmed }]
    };
  }

  const andSplit = splitTopLevelByOperator(trimmed, '&&');
  if (!andSplit.ok) {
    return andSplit;
  }

  const parsedConditions = andSplit.segments.map((segment) => parseSimpleClause(segment));
  const allSegmentsStructured = parsedConditions.every((condition): condition is DialogCondition => condition !== null);

  if (!allSegmentsStructured) {
    return {
      ok: true,
      mode: 'generic-expression',
      conditions: [{ type: 'Condition', condition: trimmed }]
    };
  }

  return {
    ok: true,
    mode: 'structured',
    conditions: parsedConditions
  };
};

