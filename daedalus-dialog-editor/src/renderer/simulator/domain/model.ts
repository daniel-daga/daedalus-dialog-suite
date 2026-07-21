import type { SemanticModel } from '../../../shared/types';
import { extractFunctionName } from '../../utils/pathAndIdentifierUtils';
import { canonicalizeIdentifier } from './identifier';
import type { SimDialogEntry, SimulatorModel } from './types';

const isMisVariable = (name: string): boolean => canonicalizeIdentifier(name).startsWith('mis_');

/**
 * Projects a semantic model into the read-only, canonical-keyed data consumed
 * by simulator domain logic. Source declarations themselves are not copied or
 * mutated, preserving their original casing and references for the editor.
 */
export const createSimulatorModel = (source: SemanticModel): SimulatorModel => {
  const functions = new Map<string, SemanticModel['functions'][string]>();
  for (const [name, func] of Object.entries(source.functions || {})) {
    functions.set(canonicalizeIdentifier(name), func);
  }

  const constants = new Map<string, string | number | boolean>();
  for (const [name, constant] of Object.entries(source.constants || {})) {
    constants.set(canonicalizeIdentifier(name), constant.value);
  }

  const declaredMisVariables = new Set<string>();
  for (const [name, variable] of Object.entries(source.variables || {})) {
    const declaredName = variable.name || name;
    if (isMisVariable(declaredName)) {
      declaredMisVariables.add(canonicalizeIdentifier(declaredName));
    }
  }

  const dialogs: SimDialogEntry[] = [];
  Object.values(source.dialogs || {}).forEach((dialog, sourceOrder) => {
    if (canonicalizeIdentifier(dialog.parent) !== 'c_info') return;

    const properties = dialog.properties || {};
    const conditionFunction = extractFunctionName(properties.condition);
    const informationFunction = extractFunctionName(properties.information);
    dialogs.push({
      name: dialog.name,
      npc: properties.npc || '',
      nr: typeof properties.nr === 'number' ? properties.nr : 0,
      ...(conditionFunction ? { conditionFunction } : {}),
      ...(informationFunction ? { informationFunction } : {}),
      important: Boolean(properties.important),
      permanent: Boolean(properties.permanent),
      sourceOrder
    });
  });

  return { functions, dialogs, declaredMisVariables, constants };
};
