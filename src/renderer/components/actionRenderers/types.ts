/**
 * Shared types for action renderer components
 */

export interface BaseActionRendererProps {
  action: any;
  npcName: string;
  handleUpdate: (updated: any) => void;
  handleDelete: () => void;
  flushUpdate: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  mainFieldRef: React.RefObject<HTMLInputElement>;
  semanticModel?: any;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction?: (oldName: string, newName: string) => void;
  dialogContextName?: string;
}
