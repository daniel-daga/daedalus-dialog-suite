/**
 * Shared type definitions for dialog editing components
 */

import type {
  DialogAction,
  SemanticModel,
  FunctionTreeNode
} from '../types/global';
import type { ActionTypeId } from './actionTypes';

export interface ActionCardProps {
  action: DialogAction;
  index: number;
  totalActions: number;
  npcName: string;
  updateAction: (index: number, action: DialogAction) => void;
  deleteAction: (index: number) => void;
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  addDialogLineAfter: (index: number) => void;
  deleteActionAndFocusPrev: (index: number) => void;
  addActionAfter: (index: number, actionType: ActionTypeId) => void;
  semanticModel?: SemanticModel;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction?: (oldName: string, newName: string) => void;
  dialogContextName?: string; // The dialog/function name for validation prefix
}

export interface DialogDetailsEditorProps {
  dialogName: string;
  filePath: string | null;
  functionName?: string; // Optional: if editing a choice function instead of the info function
  onNavigateToFunction?: (functionName: string) => void;
  semanticModel?: SemanticModel; // Optional: if provided, use this instead of reading from store
  isProjectMode?: boolean; // Optional: indicates project mode (no file saving)
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
  semanticModel: SemanticModel;
  selectedDialog: string | null;
  selectedFunctionName: string | null;
  expandedDialogs: Set<string>;
  expandedChoices: Set<string>;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  onToggleChoiceExpand: (choiceKey: string) => void;
  buildFunctionTree: (funcName: string, ancestorPath?: string[]) => FunctionTreeNode | null;
}
