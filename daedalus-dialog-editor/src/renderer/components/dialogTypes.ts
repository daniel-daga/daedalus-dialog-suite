/**
 * Shared type definitions for dialog editing components
 */

import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import type {
  Dialog,
  DialogAction,
  DialogCondition,
  DialogFunction,
  SemanticModel,
  FunctionTreeNode
} from '../types/global';
import type { ActionTypeId } from './actionTypes';
import type { ActionBranchKey, ActionPath } from './nestedActionUtils';

export type FunctionUpdater = DialogFunction | ((prev: DialogFunction) => DialogFunction);
export type DialogUpdater = (dialog: Dialog) => Dialog;
export type ConditionEditorCondition = DialogCondition & {
  getTypeName?: () => string;
};

export interface ActionCardProps {
  action: DialogAction;
  path: ActionPath;
  index: number;
  totalActions: number;
  npcName: string;
  updateActionAtPath: (path: ActionPath, action: DialogAction) => void;
  deleteActionAtPath: (path: ActionPath) => void;
  focusActionAtPath: (path: ActionPath, scrollIntoView?: boolean) => void;
  addDialogLineAfterPath: (path: ActionPath, toggleSpeaker?: boolean) => void;
  deleteActionAndFocusPrevAtPath: (path: ActionPath) => void;
  addActionAfterPath: (path: ActionPath, actionType: ActionTypeId) => void;
  addActionToBranchEnd?: (path: ActionPath, branch: ActionBranchKey, actionType: ActionTypeId) => void;
  moveAction?: (pathPrefix: ActionPath, sourceIndex: number, destinationIndex: number) => void;
  registerActionRef: (path: ActionPath, element: HTMLInputElement | null) => void;
  getVisibleActionPaths: () => ActionPath[];
  semanticModel?: SemanticModel;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction?: (oldName: string, newName: string) => void;
  dialogContextName?: string; // The dialog/function name for validation prefix
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
  filePath?: string | null;
  // Namespace for nested list droppableIds (fix-05 §2.5). Propagated to
  // ConditionalAction branch lists so a conditional inside a choice sub-dialog
  // does not collide with an outer conditional at the same path.
  droppableNamespace?: string;
}

export interface DialogDetailsEditorProps {
  dialogName: string;
  filePath: string | null;
  functionName?: string; // Optional: if editing a choice function instead of the info function
  onNavigateToFunction?: (functionName: string) => void;
  semanticModel?: SemanticModel; // Optional: if provided, use this instead of reading from store
  onDeleteDialog?: (dialogName: string) => void;
  onRenameDialog?: (dialogName: string) => void;
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
  onAddDialog?: (dialogName: string) => Promise<void> | void;
  onCreateTeacherDialog?: (config: import('../utils/teacherDialogTemplate').TeacherDialogConfig) => Promise<void> | void;
}
