import type { DialogMetadata, SemanticModel } from '../../shared/types';
import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';

import DaedalusParser from 'daedalus-parser';
const daedalusWrapper = new DaedalusParser();

export interface ParsedFileMetadata {
  dialogs: DialogMetadata[];
  instances: Array<{ name: string; parent: string }>;
  prototypes: Array<{ name: string; parent: string }>;
  isQuestFile: boolean;
  routines: string[];
  /** Literal AI_Output voice ids (expression-valued ids are skipped). */
  voiceIds: Array<{ id: string; functionName: string }>;
  /**
   * The full semantic model the metadata pass already built — present only
   * when the parse was clean and both visitor passes completed, so it can be
   * handed to the renderer instead of a second parse (P0 double-parse fix).
   * Error files stay on the parse path, which returns an errors-only model.
   */
  semanticModel?: SemanticModel;
}

const hasQuestTopicConstants = (semanticModel: SemanticModel): boolean => {
  const constantNames = Object.keys(semanticModel.constants || {});
  return constantNames.some((name) => name.toUpperCase().startsWith('TOPIC_'));
};

const hasQuestStateVariables = (semanticModel: SemanticModel): boolean => {
  const variableNames = Object.keys(semanticModel.variables || {});
  return variableNames.some((name) => name.toUpperCase().startsWith('MIS_'));
};

const extractDialogs = (semanticModel: SemanticModel, filePath: string): DialogMetadata[] => {
  const dialogs: DialogMetadata[] = [];

  Object.entries(semanticModel.dialogs || {}).forEach(([dialogName, dialog]) => {
    const npc = dialog?.properties?.npc;
    if (!npc || typeof npc !== 'string') {
      return;
    }

    dialogs.push({
      dialogName: dialog.name || dialogName,
      npc,
      filePath
    });
  });

  return dialogs;
};

const extractInstanceAndPrototypeDeclarations = (
  parseResult: any
): { instances: Array<{ name: string; parent: string }>; prototypes: Array<{ name: string; parent: string }> } => {
  const declarations = typeof daedalusWrapper.extractDeclarations === 'function'
    ? daedalusWrapper.extractDeclarations(parseResult)
    : [];

  const instances: Array<{ name: string; parent: string }> = [];
  const prototypes: Array<{ name: string; parent: string }> = [];
  for (const declaration of declarations) {
    if (!declaration?.name || !declaration.parent) continue;
    if (declaration.type === 'instance') {
      instances.push({ name: declaration.name, parent: declaration.parent });
    } else if (declaration.type === 'prototype') {
      prototypes.push({ name: declaration.name, parent: declaration.parent });
    }
  }
  return { instances, prototypes };
};

const extractDailyRoutines = (semanticModel: SemanticModel): string[] => {
  const routines: string[] = [];
  const seen = new Set<string>();
  for (const instance of Object.values(semanticModel.instances || {})) {
    if (instance.dailyRoutine && !seen.has(instance.dailyRoutine)) {
      routines.push(instance.dailyRoutine);
      seen.add(instance.dailyRoutine);
    }
  }
  return routines;
};

const collectDialogLineVoiceIds = (
  actions: any[],
  functionName: string,
  collected: Array<{ id: string; functionName: string }>
): void => {
  for (const action of actions || []) {
    if (!action) {
      continue;
    }
    if (action.type === 'DialogLine') {
      if (typeof action.id === 'string' && action.id && !action.idIsExpression) {
        collected.push({ id: action.id, functionName });
      }
      continue;
    }
    if (Array.isArray(action.thenActions) || Array.isArray(action.elseActions)) {
      collectDialogLineVoiceIds(action.thenActions || [], functionName, collected);
      collectDialogLineVoiceIds(action.elseActions || [], functionName, collected);
    }
  }
};

const extractVoiceIds = (semanticModel: SemanticModel): Array<{ id: string; functionName: string }> => {
  const voiceIds: Array<{ id: string; functionName: string }> = [];
  for (const [functionName, func] of Object.entries(semanticModel.functions || {})) {
    collectDialogLineVoiceIds(func.actions || [], functionName, voiceIds);
  }
  return voiceIds;
};

export function extractFileMetadataFromSource(sourceCode: string, filePath: string): ParsedFileMetadata {
  const parseResult = daedalusWrapper.parse(sourceCode);
  const tree = parseResult.tree;
  const visitor = new SemanticModelBuilderVisitor();

  visitor.checkForSyntaxErrors(tree.rootNode as any, sourceCode);

  // Try to build as much semantic state as possible, even if syntax errors exist.
  let modelComplete = false;
  try {
    visitor.pass1_createObjects(tree.rootNode as any);
    visitor.pass2_analyzeAndLink(tree.rootNode as any);
    modelComplete = true;
  } catch {
    // Keep partial semantic model for metadata extraction.
  }

  const semanticModel = visitor.semanticModel as SemanticModel;
  const { instances, prototypes } = extractInstanceAndPrototypeDeclarations(parseResult);

  return {
    dialogs: extractDialogs(semanticModel, filePath),
    instances,
    prototypes,
    isQuestFile: hasQuestTopicConstants(semanticModel) || hasQuestStateVariables(semanticModel),
    routines: extractDailyRoutines(semanticModel),
    voiceIds: extractVoiceIds(semanticModel),
    semanticModel: modelComplete && !semanticModel.hasErrors ? semanticModel : undefined
  };
}
