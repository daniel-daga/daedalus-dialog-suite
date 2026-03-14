/**
 * Shared types for action renderer components
 */
import type { SemanticModel } from '../../../shared/types';
import type { DialogAction } from '../../types/global';
import type { ActionBranchKey, ActionPath } from '../nestedActionUtils';
import type { ActionTypeId } from '../actionTypes';

export interface BaseActionRendererProps {
  action: DialogAction;
  path: ActionPath;
  index?: number;
  totalActions?: number;
  npcName: string;
  handleUpdate: (updated: DialogAction) => void;
  handleDelete: () => void;
  flushUpdate: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  mainFieldRef: React.RefObject<HTMLInputElement>;
  semanticModel?: SemanticModel;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction?: (oldName: string, newName: string) => void;
  dialogContextName?: string;
  updateActionAtPath?: (path: ActionPath, action: DialogAction) => void;
  deleteActionAtPath?: (path: ActionPath) => void;
  focusActionAtPath?: (path: ActionPath, scrollIntoView?: boolean) => void;
  addDialogLineAfterPath?: (path: ActionPath, toggleSpeaker?: boolean) => void;
  deleteActionAndFocusPrevAtPath?: (path: ActionPath) => void;
  addActionAfterPath?: (path: ActionPath, actionType: ActionTypeId) => void;
  addActionToBranchEnd?: (path: ActionPath, branch: ActionBranchKey, actionType: ActionTypeId) => void;
  registerActionRef?: (path: ActionPath, element: HTMLInputElement | null) => void;
  getVisibleActionPaths?: () => ActionPath[];
}
