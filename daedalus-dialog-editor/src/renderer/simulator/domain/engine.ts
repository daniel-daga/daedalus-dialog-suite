import type { DialogAction, SetVariableAction } from '../../../shared/types';
import { evaluateRawCondition } from './conditionEvaluator';
import { canonicalizeIdentifier } from './identifier';
import type { SimState, SimulatorModel, UnknownValue } from './types';
import { builtInNumber, cloneSimState, findConstant, isUnknownValue } from './values';

export interface SimulatorExecutionOptions {
  assumeUnknown?: boolean;
  actionBudget?: number;
}

const DEFAULT_ACTION_BUDGET = 1_000;

interface ExecutionContext {
  remainingActions: number;
  stopped: boolean;
  budgetExceeded: boolean;
  assumeUnknown: boolean;
}

const unknownValue = (expression: string): UnknownValue => ({ kind: 'unknown', expression });

const resolveNumericValue = (
  value: string | number | boolean,
  model: SimulatorModel,
  seenConstants: ReadonlySet<string> = new Set()
): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;

  const trimmed = value.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const builtIn = builtInNumber(trimmed);
  if (builtIn !== undefined) return builtIn;

  const constantName = canonicalizeIdentifier(trimmed);
  if (seenConstants.has(constantName)) return undefined;
  const constant = findConstant(model, constantName);
  if (constant === undefined) return undefined;
  return resolveNumericValue(constant, model, new Set([...seenConstants, constantName]));
};

const describeAssignment = (action: SetVariableAction, value: number | UnknownValue): string =>
  isUnknownValue(value)
    ? `${action.variableName} ${action.operator} ${String(action.value)} -> unknown (${value.expression})`
    : `${action.variableName} ${action.operator} ${String(action.value)} -> ${value}`;

const applyAssignment = (
  action: SetVariableAction,
  state: SimState,
  model: SimulatorModel
): void => {
  const variableName = canonicalizeIdentifier(action.variableName);
  if (!variableName.startsWith('mis_')) {
    state.transcript.push({
      kind: 'side-effect',
      text: `Ignored unmodeled assignment to ${action.variableName}.`
    });
    return;
  }

  const right = resolveNumericValue(action.value, model);
  const oldValue = state.misVars.get(variableName);
  let nextValue: number | UnknownValue;

  if (right === undefined) {
    nextValue = unknownValue(`${action.variableName} ${action.operator} ${String(action.value)}`);
  } else if (action.operator === '=') {
    nextValue = right;
  } else if (oldValue === undefined || isUnknownValue(oldValue)) {
    nextValue = unknownValue(`${action.variableName} ${action.operator} ${String(action.value)}`);
  } else if (action.operator === '+=') {
    nextValue = oldValue + right;
  } else if (action.operator === '-=') {
    nextValue = oldValue - right;
  } else if (action.operator === '*=') {
    nextValue = oldValue * right;
  } else if (action.operator === '/=') {
    // Daedalus divides integers; the VM truncates toward zero.
    nextValue = right === 0
      ? unknownValue(`${action.variableName} /= 0`)
      : Math.trunc(oldValue / right);
  } else {
    nextValue = unknownValue(`${action.variableName} ${action.operator} ${String(action.value)}`);
  }

  state.misVars.set(variableName, nextValue);
  state.assumedMisVars.delete(variableName);
  state.transcript.push({ kind: 'side-effect', text: describeAssignment(action, nextValue) });
};

const recordBudgetExceeded = (state: SimState, context: ExecutionContext): void => {
  if (context.budgetExceeded) return;
  context.budgetExceeded = true;
  state.status = 'ended';
  state.terminationReason = 'budget-exceeded';
  state.transcript.push({
    kind: 'side-effect',
    text: 'Simulation action budget exceeded; synchronous execution stopped.'
  });
};

const executeActions = (
  actions: readonly DialogAction[],
  state: SimState,
  model: SimulatorModel,
  context: ExecutionContext
): void => {
  for (const action of actions) {
    if (context.stopped || context.budgetExceeded) return;
    if (context.remainingActions <= 0) {
      recordBudgetExceeded(state, context);
      return;
    }
    context.remainingActions -= 1;

    switch (action.type) {
      case 'DialogLine':
        state.transcript.push({
          kind: 'line', speaker: action.speaker, text: action.text, id: action.id
        });
        break;
      case 'Choice':
        state.pendingChoices.push({
          text: action.text,
          targetFunction: action.targetFunction,
          dialogRef: action.dialogRef
        });
        break;
      case 'ClearChoicesAction':
        state.pendingChoices = [];
        break;
      case 'SetVariableAction':
        applyAssignment(action, state, model);
        break;
      case 'ConditionalAction': {
        const evaluation = evaluateRawCondition(action.condition, state, model);
        const assumed = evaluation.value === 'unknown' ? context.assumeUnknown : evaluation.value === 'true';
        if (evaluation.value === 'unknown') {
          state.transcript.push({
            kind: 'condition-note',
            condition: action.condition,
            assumed,
            ...(evaluation.reason ? { reason: evaluation.reason } : {})
          });
        }
        executeActions(assumed ? action.thenActions : action.elseActions, state, model, context);
        break;
      }
      case 'StopProcessInfosAction':
        state.transcript.push({
          kind: 'side-effect',
          text: `AI_StopProcessInfos(${action.target}) ended the simulation.`
        });
        state.status = 'ended';
        state.terminationReason = 'stopped';
        context.stopped = true;
        return;
      case 'CommentAction':
        break;
      default: {
        const customText = 'action' in action && typeof action.action === 'string'
          ? action.action
          : action.type || 'Unknown action';
        state.transcript.push({ kind: 'side-effect', text: customText });
      }
    }
  }
};

const normalizedBudget = (value: number | undefined): number => {
  if (value === undefined) return DEFAULT_ACTION_BUDGET;
  if (!Number.isFinite(value)) return DEFAULT_ACTION_BUDGET;
  return Math.max(0, Math.floor(value));
};

const executeFunctionInto = (
  model: SimulatorModel,
  state: SimState,
  functionName: string,
  options: SimulatorExecutionOptions
): SimState => {
  const func = model.functions.get(canonicalizeIdentifier(functionName));
  if (!func) {
    state.transcript.push({
      kind: 'side-effect',
      text: `Function "${functionName.trim()}" is unavailable.`
    });
    state.status = state.pendingChoices.length > 0 ? 'awaiting-choice' : 'ended';
    state.terminationReason = 'missing-function';
    return state;
  }

  state.status = 'running';
  state.terminationReason = undefined;
  const context: ExecutionContext = {
    remainingActions: normalizedBudget(options.actionBudget),
    stopped: false,
    budgetExceeded: false,
    assumeUnknown: options.assumeUnknown ?? false
  };
  executeActions(func.actions, state, model, context);
  if (!context.stopped && !context.budgetExceeded) {
    state.status = state.pendingChoices.length > 0 ? 'awaiting-choice' : 'ended';
    state.terminationReason = 'completed';
  }
  return state;
};

export const createSimState = (model: SimulatorModel): SimState => {
  const declaredMisVariables = Array.from(
    model.declaredMisVariables,
    canonicalizeIdentifier
  );
  return {
    misVars: new Map(declaredMisVariables.map((name) => [name, 0])),
    assumedMisVars: new Set(declaredMisVariables),
    knownInfos: new Set(),
    transcript: [],
    pendingChoices: [],
    status: 'running'
  };
};

export const executeFunction = (
  model: SimulatorModel,
  state: SimState,
  functionName: string,
  options: SimulatorExecutionOptions = {}
): SimState => executeFunctionInto(model, cloneSimState(state), functionName, options);

export const selectChoice = (
  model: SimulatorModel,
  state: SimState,
  choiceIndex: number,
  options: SimulatorExecutionOptions = {}
): SimState => {
  const next = cloneSimState(state);
  if (next.status !== 'awaiting-choice') return next;
  const choice = next.pendingChoices[choiceIndex];
  if (!choice) return next;

  next.transcript.push({
    kind: 'choice', text: choice.text, targetFunction: choice.targetFunction
  });
  return executeFunctionInto(model, next, choice.targetFunction, options);
};
