import { evaluateConditions, type TruthValue } from './conditionEvaluator';
import { canonicalizeIdentifier } from './identifier';
import type { SimDialogEntry, SimState, SimulatorModel } from './types';

export interface SimDialogAvailability {
  entry: SimDialogEntry;
  value: TruthValue;
  reason?: string;
  /** False entries are retained for callers that need diagnostics, but hidden from the picker. */
  visible: boolean;
  /** The explicit session policy applied only to an otherwise unknown result. */
  assumedAvailable: boolean;
}

const unknown = (entry: SimDialogEntry, reason: string, assumeUnknownTrue: boolean): SimDialogAvailability => ({
  entry,
  value: 'unknown',
  reason,
  visible: true,
  assumedAvailable: assumeUnknownTrue
});

const compareEntries = (left: SimDialogEntry, right: SimDialogEntry): number =>
  left.nr - right.nr || left.sourceOrder - right.sourceOrder;

/**
 * Determines the selected NPC's C_INFO entries against the current scratch
 * state. Unknown conditions are deliberately retained with their reason; the
 * caller chooses whether its explicit policy treats them as selectable.
 */
export const getDialogAvailability = (
  model: SimulatorModel,
  state: SimState,
  npc: string,
  assumeUnknownTrue: boolean
): SimDialogAvailability[] => {
  const canonicalNpc = canonicalizeIdentifier(npc);
  const entries = model.dialogs
    .filter((entry) => canonicalizeIdentifier(entry.npc) === canonicalNpc)
    .sort(compareEntries);

  const availability: SimDialogAvailability[] = [];
  for (const entry of entries) {
    // A non-permanent C_INFO cannot return after the player has learned it.
    if (!entry.permanent && state.knownInfos.has(canonicalizeIdentifier(entry.name))) {
      continue;
    }

    if (!entry.conditionFunction) {
      availability.push(unknown(entry, 'Missing condition function.', assumeUnknownTrue));
      continue;
    }

    const conditionFunction = model.functions.get(canonicalizeIdentifier(entry.conditionFunction));
    if (!conditionFunction) {
      availability.push(unknown(
        entry,
        `Condition function "${entry.conditionFunction}" was not found.`,
        assumeUnknownTrue
      ));
      continue;
    }

    const evaluation = evaluateConditions(
      conditionFunction.conditions,
      conditionFunction.conditionOperator,
      state,
      model
    );
    availability.push({
      entry,
      value: evaluation.value,
      ...(evaluation.reason ? { reason: evaluation.reason } : {}),
      visible: evaluation.value !== 'false',
      assumedAvailable: evaluation.value === 'unknown' && assumeUnknownTrue
    });
  }

  return availability;
};
