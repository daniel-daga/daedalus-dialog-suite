import type {
  DialogAction,
  DialogCondition,
  DialogFunction,
  SemanticModel
} from '../../shared/types';

type SimulationValue = string | number | boolean;

export interface SimulationLine {
  speaker: string;
  text: string;
  id: string;
}

export interface SimulationChoice {
  text: string;
  targetFunction: string;
}

export interface DialogSimulation {
  status: 'active' | 'unavailable' | 'ended';
  dialogName: string;
  transcript: SimulationLine[];
  choices: SimulationChoice[];
  variables: Record<string, SimulationValue>;
  knownDialogs: string[];
}

const functionName = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'object' && value !== null && 'name' in value
    ? String(value.name) : undefined;

const toComparable = (value: SimulationValue | undefined): SimulationValue => value ?? 0;

const valuesEqual = (left: SimulationValue, right: SimulationValue): boolean =>
  String(left).toUpperCase() === String(right).toUpperCase();

const compare = (left: SimulationValue, operator: string, right: SimulationValue): boolean => {
  if (operator === '==') return valuesEqual(left, right);
  if (operator === '!=') return !valuesEqual(left, right);
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  return operator === '>' ? leftNumber > rightNumber
    : operator === '>=' ? leftNumber >= rightNumber
    : operator === '<' ? leftNumber < rightNumber
    : operator === '<=' ? leftNumber <= rightNumber : false;
};

const conditionPasses = (condition: DialogCondition, state: DialogSimulation): boolean => {
  if (condition.type === 'VariableCondition') {
    const value = toComparable(state.variables[condition.variableName]);
    const result = condition.operator && condition.value !== undefined
      ? compare(value, condition.operator, condition.value)
      : Boolean(value);
    return condition.negated ? !result : result;
  }
  if (condition.type === 'NpcKnowsInfoCondition') {
    return state.knownDialogs.some((name) => name.toUpperCase() === condition.dialogRef.toUpperCase());
  }
  // The simulator deliberately does not guess results for world-dependent checks.
  return false;
};

const functionPasses = (func: DialogFunction | undefined, state: DialogSimulation): boolean => {
  if (!func) return false;
  const results = func.conditions.map((condition) => conditionPasses(condition, state));
  return func.conditionOperator === 'OR' ? results.some(Boolean) : results.every(Boolean);
};

const executeActions = (actions: DialogAction[], state: DialogSimulation): void => {
  for (const action of actions) {
    if (action.type === 'DialogLine') {
      state.transcript.push({ speaker: action.speaker, text: action.text, id: action.id });
    } else if (action.type === 'Choice') {
      state.choices.push({ text: action.text, targetFunction: action.targetFunction });
    } else if (action.type === 'ClearChoicesAction') {
      state.choices = [];
    } else if (action.type === 'SetVariableAction') {
      const oldValue = toComparable(state.variables[action.variableName]);
      const amount = typeof action.value === 'number' ? action.value : Number(action.value);
      state.variables[action.variableName] = action.operator === '+=' && Number.isFinite(amount) ? Number(oldValue) + amount
        : action.operator === '-=' && Number.isFinite(amount) ? Number(oldValue) - amount
        : action.value;
    } else if (action.type === 'ConditionalAction') {
      executeActions(evaluateExpression(action.condition, state) ? action.thenActions : action.elseActions, state);
    }
  }
};

const evaluateExpression = (expression: string, state: DialogSimulation): boolean => {
  const match = expression.trim().match(/^([A-Za-z_][\w]*)\s*(==|!=|>=|<=|>|<)?\s*([\w-]+)?$/);
  if (!match) return false;
  const [, variableName, operator, rawValue] = match;
  const value = toComparable(state.variables[variableName]);
  if (!operator) return Boolean(value);
  const right: SimulationValue = rawValue !== undefined && /^-?\d+(\.\d+)?$/.test(rawValue) ? Number(rawValue) : rawValue ?? 0;
  return compare(value, operator, right);
};

const cloneState = (state: DialogSimulation): DialogSimulation => ({
  ...state,
  transcript: [...state.transcript], choices: [...state.choices], variables: { ...state.variables }, knownDialogs: [...state.knownDialogs]
});

export const createDialogSimulation = (
  model: SemanticModel,
  dialogName: string,
  variables: Record<string, SimulationValue> = {}
): DialogSimulation => {
  const state: DialogSimulation = { status: 'active', dialogName, transcript: [], choices: [], variables: { ...variables }, knownDialogs: [dialogName] };
  const dialog = model.dialogs[dialogName];
  const condition = functionName(dialog?.properties?.condition);
  const information = functionName(dialog?.properties?.information);
  if (!dialog || (condition && !functionPasses(model.functions[condition], state)) || !information) {
    state.status = 'unavailable';
    return state;
  }
  executeActions(model.functions[information]?.actions ?? [], state);
  if (state.choices.length === 0) state.status = 'ended';
  return state;
};

export const selectSimulationChoice = (model: SemanticModel, state: DialogSimulation, choiceIndex: number): DialogSimulation => {
  const next = cloneState(state);
  const choice = next.choices[choiceIndex];
  if (!choice || next.status === 'unavailable') return next;
  next.choices = [];
  executeActions(model.functions[choice.targetFunction]?.actions ?? [], next);
  next.status = next.choices.length > 0 ? 'active' : 'ended';
  return next;
};
