/**
 * Pure utility for analysing quest usage across a set of parsed dialog files.
 * Extracted from projectStore.ts so that the computation lives outside the store.
 */

import type { SemanticModel } from '../types/global';
import type { ParsedFileCache } from '../store/projectStore';
import {
  getCanonicalQuestKey,
  getQuestMisVariableName,
  isCaseInsensitiveMatch
} from './questIdentity';

function createEmptySemanticModel(): SemanticModel {
  return {
    dialogs: {},
    functions: {},
    constants: {},
    variables: {},
    instances: {},
    items: {},
    npcs: {},
    animations: {},
    hasErrors: false,
    errors: []
  };
}

/**
 * Two-pass scan of all parsed files that returns a SemanticModel containing
 * only the dialogs, functions, constants, and variables that are related to
 * the given quest name.
 *
 * Pass 1 – collects relevant functions (those whose actions reference the
 *   quest topic constant or MIS variable, or whose conditions check the MIS
 *   variable).
 * Pass 2 – collects dialogs that use those relevant functions, plus the
 *   one-hop linked condition functions for each matched info function.
 */
export function getQuestUsage(
  parsedFiles: Map<string, ParsedFileCache>,
  questName: string
): SemanticModel {
  const result = createEmptySemanticModel();
  const misVarName = getQuestMisVariableName(questName);
  const relevantFunctionKeys = new Set<string>();
  const functionLookup = new Map<string, { name: string; func: any; filePath: string }>();

  // Pass 1: Identify all relevant functions and add definitions
  for (const [filePath, fileData] of parsedFiles.entries()) {
    const model = fileData.semanticModel;

    // Constants & Variables
    const topicKey = Object.keys(model.constants || {}).find((key) =>
      isCaseInsensitiveMatch(key, questName)
    );
    if (topicKey && model.constants) {
      result.constants = result.constants || {};
      result.constants[topicKey] = model.constants[topicKey];
    }
    const misKey = Object.keys(model.variables || {}).find((key) =>
      isCaseInsensitiveMatch(key, misVarName)
    );
    if (misKey && model.variables) {
      result.variables = result.variables || {};
      result.variables[misKey] = model.variables[misKey];
    }

    // Functions
    if (model.functions) {
      Object.values(model.functions).forEach((func) => {
        const funcKey = getCanonicalQuestKey(func.name);
        if (!functionLookup.has(funcKey)) {
          functionLookup.set(funcKey, {
            name: func.name,
            func,
            filePath: func.filePath || filePath
          });
        }
      });

      Object.values(model.functions).forEach((func) => {
        let isRelevant = false;

        // Check Actions
        if (func.actions) {
          for (const action of func.actions) {
            // Topic references
            if ('topic' in action && isCaseInsensitiveMatch(action.topic, questName)) {
              isRelevant = true;
              break;
            }
            // Explicit MIS writers (writer-only quest handlers)
            if (
              action.type === 'SetVariableAction' &&
              isCaseInsensitiveMatch(action.variableName, misVarName)
            ) {
              isRelevant = true;
              break;
            }
          }
        }

        // Check Conditions
        if (!isRelevant && func.conditions) {
          for (const cond of func.conditions) {
            if ('variableName' in cond && isCaseInsensitiveMatch(cond.variableName, misVarName)) {
              isRelevant = true;
              break;
            }
          }
        }

        if (isRelevant) {
          relevantFunctionKeys.add(getCanonicalQuestKey(func.name));
          result.functions[func.name] = {
            ...func,
            filePath: func.filePath || filePath
          };
        }
      });
    }
  }

  // Pass 2: Identify dialogs that use relevant functions and include one-hop
  // linked condition functions.
  for (const fileData of parsedFiles.values()) {
    const model = fileData.semanticModel;

    if (model.dialogs) {
      Object.values(model.dialogs).forEach((dialog) => {
        const info = dialog.properties.information;
        const cond = dialog.properties.condition;

        const infoName =
          typeof info === 'string' ? info : typeof info === 'object' ? info.name : null;
        const condName =
          typeof cond === 'string' ? cond : typeof cond === 'object' ? cond.name : null;
        const infoKey = infoName ? getCanonicalQuestKey(infoName) : null;
        const condKey = condName ? getCanonicalQuestKey(condName) : null;
        const infoIsRelevant = Boolean(infoKey && relevantFunctionKeys.has(infoKey));

        // One-hop closure: include linked condition functions for already relevant
        // dialog info functions.
        if (infoIsRelevant && condName && condKey && !relevantFunctionKeys.has(condKey)) {
          const linkedConditionFunc = functionLookup.get(condKey);
          if (linkedConditionFunc) {
            relevantFunctionKeys.add(condKey);
            result.functions[linkedConditionFunc.name] = {
              ...linkedConditionFunc.func,
              filePath:
                linkedConditionFunc.func.filePath || linkedConditionFunc.filePath
            };
          }
        }

        const dialogUsesRelevantFunction = Boolean(
          (infoKey && relevantFunctionKeys.has(infoKey)) ||
            (condKey && relevantFunctionKeys.has(condKey))
        );

        if (dialogUsesRelevantFunction) {
          result.dialogs[dialog.name] = dialog;
        }
      });
    }
  }

  return result;
}
