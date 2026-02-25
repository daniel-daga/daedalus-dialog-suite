import React, { forwardRef } from 'react';
import { Box, Typography, Alert, Tabs, Tab, IconButton } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
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
  onCloseRecentDialog: (dialogName: string, npcName: string) => void;
  onNavigateToFunction: (functionName: string) => void;
}

const TABS_HEIGHT = 40;

const editorPaneContainerStyles = {
  flex: '1 1 auto',
  overflowY: 'auto',
  overflowX: 'hidden',
  scrollbarGutter: 'stable',
  p: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  height: '100%'
} as const;

const editorPaneContentStyles = {
  p: 2,
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
} as const;

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
  onCloseRecentDialog,
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
        sx={{ minHeight: TABS_HEIGHT, '& .MuiTab-root': { minHeight: TABS_HEIGHT, textTransform: 'none' } }}
      >
        {recentDialogs.map((tab) => (
          <Tab
            key={`${tab.npcName}:${tab.dialogName}`}
            label={(
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {`${tab.npcName}: ${tab.dialogName}`}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={`Close tab ${tab.npcName}: ${tab.dialogName}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseRecentDialog(tab.dialogName, tab.npcName);
                  }}
                  onMouseDown={(event) => {
                    // Keep focus/selection behavior stable while closing tabs.
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  sx={{ p: 0.25 }}
                >
                  <CloseIcon fontSize="inherit" />
                </IconButton>
              </Box>
            )}
            title={`${tab.npcName}: ${tab.dialogName}`}
          />
        ))}
      </Tabs>
    </Box>
  );

  const renderStateShell = (content: React.ReactNode) => (
    <Box ref={ref} sx={editorPaneContainerStyles}>
      {tabsHeader}
      <Box sx={editorPaneContentStyles}>{content}</Box>
    </Box>
  );

  // No dialog selected - show placeholder
  if (!selectedDialog || !dialogData) {
    return renderStateShell(
      <Typography variant="body1" color="text.secondary">
        Select a dialog to edit
      </Typography>
    );
  }

  // No information function defined
  if (!currentFunctionName) {
    return renderStateShell(
      <Alert severity="warning">
        <Typography variant="body2">
          This dialog does not have an information function defined.
        </Typography>
      </Alert>
    );
  }

  // Function not found
  if (!currentFunctionData) {
    return renderStateShell(
      <Alert severity="error">
        <Typography variant="body2">
          Function "{currentFunctionName}" not found in the file.
        </Typography>
      </Alert>
    );
  }

  // Normal editing view
  return (
    <Box ref={ref} sx={editorPaneContainerStyles}>
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
