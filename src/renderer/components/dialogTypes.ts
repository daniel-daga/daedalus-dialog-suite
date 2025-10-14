/**
 * Shared type definitions for dialog editing components
 */

export interface ActionCardProps {
  action: any;
  index: number;
  totalActions: number;
  npcName: string;
  updateAction: (index: number, action: any) => void;
  deleteAction: (index: number) => void;
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  addDialogLineAfter: (index: number) => void;
  deleteActionAndFocusPrev: (index: number) => void;
  addActionAfter: (index: number, actionType: string) => void;
  semanticModel?: any;
  onUpdateFunction?: (functionName: string, func: any) => void;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction?: (oldName: string, newName: string) => void;
  dialogContextName?: string; // The dialog/function name for validation prefix
}

export interface DialogDetailsEditorProps {
  dialogName: string;
  dialog: any;
  infoFunction: any;
  filePath: string;
  onUpdateDialog: (dialog: any) => void;
  onUpdateFunction: (func: any) => void;
  onNavigateToFunction?: (functionName: string) => void;
}

export interface ChoiceActionEditorProps {
  open: boolean;
  onClose: () => void;
  targetFunctionName: string;
  targetFunction: any;
  onUpdateFunction: (func: any) => void;
  npcName: string;
  semanticModel: any;
  onUpdateSemanticFunction: (functionName: string, func: any) => void;
}

export interface NPCListProps {
  npcs: string[];
  npcMap: Map<string, string[]>;
  selectedNPC: string | null;
  onSelectNPC: (npc: string) => void;
}

export interface DialogTreeProps {
  selectedNPC: string | null;
  dialogsForNPC: string[];
  semanticModel: any;
  selectedDialog: string | null;
  selectedFunctionName: string | null;
  expandedDialogs: Set<string>;
  expandedChoices: Set<string>;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  onToggleChoiceExpand: (choiceKey: string) => void;
  buildFunctionTree: (funcName: string, ancestorPath?: string[]) => any;
}
