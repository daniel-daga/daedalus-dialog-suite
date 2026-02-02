import { SemanticModel, FunctionTreeNode, FunctionTreeChild } from '../types/global';

export type DialogRowData = {
  type: 'dialog';
  id: string; // dialogName
  dialogName: string;
  hasChildren: boolean;
  isExpanded: boolean;
  depth: number;
};

export type ChoiceRowData = {
  type: 'choice';
  id: string; // choiceKey
  choice: FunctionTreeChild;
  dialogName: string; // parent dialog name
  hasChildren: boolean;
  isExpanded: boolean;
  depth: number;
  index: number; // index in parent children array
};

export type FlatItem = DialogRowData | ChoiceRowData;

export const flattenDialogs = (
  filteredDialogs: string[],
  semanticModel: SemanticModel,
  expandedDialogs: Set<string>,
  expandedChoices: Set<string>,
  buildFunctionTree: (funcName: string, ancestorPath?: string[]) => FunctionTreeNode | null
): FlatItem[] => {
  const items: FlatItem[] = [];

  for (const dialogName of filteredDialogs) {
    const dialog = semanticModel.dialogs?.[dialogName];
    if (!dialog) continue;

    const isExpanded = expandedDialogs.has(dialogName);
    const infoFunc = dialog.properties?.information as any;
    const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;
    const infoFuncData = infoFuncName ? semanticModel.functions?.[infoFuncName] : null;

    let tree: FunctionTreeNode | null = null;
    let hasChildren = false;

    if (isExpanded) {
      tree = infoFuncName ? buildFunctionTree(infoFuncName) : null;
      hasChildren = !!(tree && tree.children && tree.children.length > 0);
    } else if (infoFuncData && infoFuncData.actions) {
      // Shallow check
      hasChildren = infoFuncData.actions.some((a: any) => 'dialogRef' in a && 'targetFunction' in a);
    }

    items.push({
      type: 'dialog',
      id: dialogName,
      dialogName: dialogName,
      hasChildren,
      isExpanded,
      depth: 0
    });

    if (isExpanded && tree && tree.children.length > 0) {
      flattenChoices(items, tree.children, 1, dialogName, expandedChoices);
    }
  }

  return items;
};

const flattenChoices = (
  items: FlatItem[],
  children: FunctionTreeChild[],
  depth: number,
  dialogName: string,
  expandedChoices: Set<string>
) => {
  children.forEach((choice, index) => {
    const choiceKey = `${choice.targetFunction}-${depth}-${index}`;

    const isExpanded = expandedChoices.has(choiceKey);
    // Note: subtree is populated by buildFunctionTree recursively
    const hasSubchoices = !!(choice.subtree && choice.subtree.children && choice.subtree.children.length > 0);

    items.push({
      type: 'choice',
      id: choiceKey,
      choice,
      dialogName,
      hasChildren: hasSubchoices,
      isExpanded,
      depth,
      index
    });

    if (isExpanded && hasSubchoices && choice.subtree) {
      flattenChoices(items, choice.subtree.children, depth + 1, dialogName, expandedChoices);
    }
  });
};
