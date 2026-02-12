/**
 * Shared types for action renderer components
 */
import type { SemanticModel } from '../../../shared/types';
import type { DialogAction } from '../types/global';

export interface BaseActionRendererProps {
  action: DialogAction;
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
}
