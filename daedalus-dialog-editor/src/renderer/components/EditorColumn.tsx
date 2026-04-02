import React, { forwardRef } from 'react';
import EditorPane from './EditorPane';
import type { SemanticModel, Dialog, DialogFunction } from '../types/global';
import type { RecentDialogTab } from './hooks/useRecentDialogTabs';

interface EditorColumnProps {
  selectedDialog: string | null;
  dialogData: Dialog | null;
  currentFunctionName: string | null | undefined;
  currentFunctionData: DialogFunction | null;
  selectedFunctionName: string | null;
  filePath: string | null;
  semanticModel: SemanticModel;
  isLoadingDialog: boolean;
  recentDialogs: RecentDialogTab[];
  onSelectRecentDialog: (dialogName: string, functionName: string | null, npcName: string) => void;
  onCloseRecentDialog: (dialogName: string, npcName: string) => void;
  onNavigateToFunction: (functionName: string) => void;
}

const EditorColumn = forwardRef<HTMLDivElement, EditorColumnProps>((props, ref) => {
  return <EditorPane ref={ref} {...props} />;
});

EditorColumn.displayName = 'EditorColumn';

export default EditorColumn;
