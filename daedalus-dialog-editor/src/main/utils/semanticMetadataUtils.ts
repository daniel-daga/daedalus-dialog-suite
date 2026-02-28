import type { DialogMetadata, SemanticModel } from '../../shared/types';
import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';

// @ts-ignore - CommonJS module
const DaedalusParser = require('daedalus-parser');
const daedalusWrapper = new DaedalusParser();

export interface ParsedFileMetadata {
  dialogs: DialogMetadata[];
  isQuestFile: boolean;
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

export function extractFileMetadataFromSource(sourceCode: string, filePath: string): ParsedFileMetadata {
  const parseResult = daedalusWrapper.parse(sourceCode);
  const tree = parseResult.tree;
  const visitor = new SemanticModelBuilderVisitor();

  visitor.checkForSyntaxErrors(tree.rootNode as any, sourceCode);

  // Try to build as much semantic state as possible, even if syntax errors exist.
  try {
    visitor.pass1_createObjects(tree.rootNode as any);
    visitor.pass2_analyzeAndLink(tree.rootNode as any);
  } catch {
    // Keep partial semantic model for metadata extraction.
  }

  const semanticModel = visitor.semanticModel as SemanticModel;

  return {
    dialogs: extractDialogs(semanticModel, filePath),
    isQuestFile: hasQuestTopicConstants(semanticModel) || hasQuestStateVariables(semanticModel)
  };
}
