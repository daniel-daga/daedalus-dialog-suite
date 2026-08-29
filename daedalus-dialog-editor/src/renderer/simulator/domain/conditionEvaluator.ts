import type { DialogCondition } from '../../../shared/types';
import { parseConditionExpressionToConditions } from '../../quest/domain/conditionExpressionCodec';
import { canonicalizeIdentifier } from './identifier';
import type { SimState, SimulatorModel, UnknownValue } from './types';
import { builtInNumber, findConstant, isUnknownValue } from './values';

export type TruthValue = 'true' | 'false' | 'unknown';

export interface ConditionEvaluation {
  value: TruthValue;
  reason?: string;
}

type ComparableValue = number | boolean;

const TRUE: ConditionEvaluation = { value: 'true' };
const FALSE: ConditionEvaluation = { value: 'false' };

const unknown = (reason: string): ConditionEvaluation => ({ value: 'unknown', reason });

const normalizeMisIdentifier = (value: string): string => {
  const canonical = canonicalizeIdentifier(value);
  return canonical.startsWith('topic_') ? `mis_${canonical.slice('topic_'.length)}` : canonical;
};

const resolveComparable = (
  raw: string | number | boolean | undefined,
  model: SimulatorModel
): ComparableValue | ConditionEvaluation => {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw !== 'string' || !raw.trim()) return unknown('Condition comparison has no value.');

  const trimmed = raw.trim();
  const builtIn = builtInNumber(trimmed);
  if (builtIn !== undefined) return builtIn;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  const constant = findConstant(model, trimmed);
  if (constant === undefined) return unknown(`Cannot resolve constant "${trimmed}".`);
  if (typeof constant === 'number') return constant;
  if (typeof constant === 'boolean') return constant ? 1 : 0;

  const constantBuiltIn = builtInNumber(constant);
  if (constantBuiltIn !== undefined) return constantBuiltIn;
  if (/^-?\d+(\.\d+)?$/.test(constant.trim())) return Number(constant);
  return unknown(`Constant "${trimmed}" is not a supported scalar value.`);
};

const applyNegation = (evaluation: ConditionEvaluation, negated: boolean | undefined): ConditionEvaluation => {
  if (!negated || evaluation.value === 'unknown') return evaluation;
  return evaluation.value === 'true' ? FALSE : TRUE;
};

const compare = (left: number, operator: string, right: ComparableValue): ConditionEvaluation => {
  if (operator === '==' || operator === '!=') {
    const equal = typeof right === 'number' && left === right;
    return (operator === '==' ? equal : !equal) ? TRUE : FALSE;
  }
  if (typeof right !== 'number') {
    return unknown(`Operator "${operator}" requires numeric operands.`);
  }
  if (operator === '>') return left > right ? TRUE : FALSE;
  if (operator === '>=') return left >= right ? TRUE : FALSE;
  if (operator === '<') return left < right ? TRUE : FALSE;
  if (operator === '<=') return left <= right ? TRUE : FALSE;
  return unknown(`Unsupported comparison operator "${operator}".`);
};

const getMisValue = (variableName: string, state: SimState): number | UnknownValue | undefined =>
  state.misVars.get(normalizeMisIdentifier(variableName));

const evaluateVariable = (
  variableName: string,
  operator: string | undefined,
  rightRaw: string | number | boolean | undefined,
  negated: boolean | undefined,
  state: SimState,
  model: SimulatorModel
): ConditionEvaluation => {
  const left = getMisValue(variableName, state);
  if (left === undefined) return unknown(`MIS variable "${variableName}" has no modeled value.`);
  if (isUnknownValue(left)) return unknown(`MIS variable "${variableName}" is unknown: ${left.expression}`);

  if (!operator || rightRaw === undefined) {
    return applyNegation(left === 0 ? FALSE : TRUE, negated);
  }
  const right = resolveComparable(rightRaw, model);
  if (typeof right === 'object') return right;
  return applyNegation(compare(left, operator, right), negated);
};

const combine = (evaluations: readonly ConditionEvaluation[], operator: 'AND' | 'OR' | undefined): ConditionEvaluation => {
  const isOr = operator === 'OR';
  if (evaluations.length === 0) return isOr ? FALSE : TRUE;

  if (isOr && evaluations.some((evaluation) => evaluation.value === 'true')) return TRUE;
  if (!isOr && evaluations.some((evaluation) => evaluation.value === 'false')) return FALSE;

  const firstUnknown = evaluations.find((evaluation) => evaluation.value === 'unknown');
  if (firstUnknown) return firstUnknown;
  return isOr ? FALSE : TRUE;
};

export const evaluateRawCondition = (
  expression: string,
  state: SimState,
  model: SimulatorModel
): ConditionEvaluation => {
  const parsed = parseConditionExpressionToConditions(expression);
  if (!parsed.ok) return unknown(parsed.error);
  if (parsed.mode !== 'structured') {
    return unknown(`Raw condition is not structurally evaluable: ${expression.trim()}`);
  }
  return evaluateConditions(parsed.conditions, parsed.conditionOperator, state, model);
};

export const evaluateCondition = (
  condition: DialogCondition,
  state: SimState,
  model: SimulatorModel
): ConditionEvaluation => {
  if (condition.type === 'VariableCondition') {
    return evaluateVariable(
      condition.variableName,
      condition.operator,
      condition.value,
      condition.negated,
      state,
      model
    );
  }

  if (condition.type === 'QuestStateCondition') {
    return evaluateVariable(condition.questVariable, '==', condition.state, false, state, model);
  }

  if (condition.type === 'NpcKnowsInfoCondition') {
    const known = state.knownInfos.has(canonicalizeIdentifier(condition.dialogRef));
    const holds = condition.negated ? !known : known;
    return holds ? TRUE : FALSE;
  }

  if (condition.type === 'Condition' || (!condition.type && typeof condition.condition === 'string')) {
    return evaluateRawCondition(condition.condition, state, model);
  }

  return unknown(`Condition type "${condition.type || 'GenericCondition'}" depends on unmodeled world state.`);
};

export const evaluateConditions = (
  conditions: readonly DialogCondition[],
  conditionOperator: 'AND' | 'OR' | undefined,
  state: SimState,
  model: SimulatorModel
): ConditionEvaluation => combine(
  conditions.map((condition) => evaluateCondition(condition, state, model)),
  conditionOperator
);
