import React, { forwardRef } from 'react';
import { Box, Typography, Alert, Tabs, Tab } from '@mui/material';
import DialogDetailsEditor from './DialogDetailsEditor';
import DialogLoadingSkeleton from './DialogLoadingSkeleton';
import type { SemanticModel, Dialog, DialogFunction } from '../types/global';

interface RecentDialogTab {
  dialogName: string;
  npcName: string;
  functionName: string | null;
}

interface EditorPaneProps {
  selectedDialog: string | null;
  dialogData: Dialog | null;
  currentFunctionName: string | null | undefined;
  currentFunctionData: DialogFunction | null;
  selectedFunctionName: string | null;
  filePath: string | null;
  semanticModel: SemanticModel;
  isProjectMode: boolean;
  isLoadingDialog: boolean;
  recentDialogs: RecentDialogTab[];
  onSelectRecentDialog: (dialogName: string, functionName: string | null, npcName: string) => void;
  onNavigateToFunction: (functionName: string) => void;
}

/**
 * The right-most pane that displays the dialog editor or placeholder content
 */
const EditorPane = forwardRef<HTMLDivElement, EditorPaneProps>(({
  selectedDialog,
  dialogData,
  currentFunctionName,
  currentFunctionData,
  selectedFunctionName,
  filePath,
  semanticModel,
  isProjectMode,
  isLoadingDialog,
  recentDialogs,
  onSelectRecentDialog,
  onNavigateToFunction
}, ref) => {
  const activeNpcName = dialogData?.properties?.npc || null;
  const selectedTabIndex = selectedDialog
    ? recentDialogs.findIndex((tab) => tab.dialogName === selectedDialog && tab.npcName === activeNpcName)
    : -1;

  const tabsHeader = recentDialogs.length > 0 && (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}>
      <Tabs
        value={selectedTabIndex >= 0 ? selectedTabIndex : false}
        onChange={(_event, index: number) => {
          const tab = recentDialogs[index];
          if (tab) {
            onSelectRecentDialog(tab.dialogName, tab.functionName, tab.npcName);
          }
        }}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
      >
        {recentDialogs.map((tab) => (
          <Tab
            key={`${tab.npcName}:${tab.dialogName}`}
            label={`${tab.npcName}: ${tab.dialogName}`}
            title={`${tab.npcName}: ${tab.dialogName}`}
          />
        ))}
      </Tabs>
    </Box>
  );

  // No dialog selected - show placeholder
  if (!selectedDialog || !dialogData) {
    return (
      <Box
        ref={ref}
        sx={{
          flex: '1 1 auto',
          overflow: 'auto',
          p: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          height: '100%'
        }}
      >
        {tabsHeader}
        <Box sx={{ p: 2, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            Select a dialog to edit
          </Typography>
        </Box>
      </Box>
    );
  }

  // No information function defined
  if (!currentFunctionName) {
    return (
      <Box
        ref={ref}
        sx={{
          flex: '1 1 auto',
          overflow: 'auto',
          p: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          height: '100%'
        }}
      >
        {tabsHeader}
        <Box sx={{ p: 2, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Alert severity="warning">
            <Typography variant="body2">
              This dialog does not have an information function defined.
            </Typography>
          </Alert>
        </Box>
      </Box>
    );
  }

  // Function not found
  if (!currentFunctionData) {
    return (
      <Box
        ref={ref}
        sx={{
          flex: '1 1 auto',
          overflow: 'auto',
          p: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          height: '100%'
        }}
      >
        {tabsHeader}
        <Box sx={{ p: 2, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Alert severity="error">
            <Typography variant="body2">
              Function "{currentFunctionName}" not found in the file.
            </Typography>
          </Alert>
        </Box>
      </Box>
    );
  }

  // Normal editing view
  return (
    <Box
      ref={ref}
      sx={{
        flex: '1 1 auto',
        overflow: 'auto',
        p: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}
    >
      {tabsHeader}

      <Box sx={{ width: '100%', p: 2, minHeight: 0, flex: 1 }}>
        {isLoadingDialog ? (
          <DialogLoadingSkeleton />
        ) : (
          <DialogDetailsEditor
            dialogName={selectedDialog}
            filePath={filePath}
            functionName={selectedFunctionName || undefined}
            onNavigateToFunction={onNavigateToFunction}
            semanticModel={semanticModel}
            isProjectMode={isProjectMode}
          />
        )}
      </Box>
    </Box>
  );
});

EditorPane.displayName = 'EditorPane';

export default EditorPane;
