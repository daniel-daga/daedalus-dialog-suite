import React, { useState, useCallback } from 'react';
import { Box, Typography, Alert, Button } from '@mui/material';
import DialogTree from './DialogTree';
import { useNpcDialogErrors } from './hooks/useNpcDialogErrors';
import type { SemanticModel, DialogMetadata, FunctionTreeNode } from '../types/global';
import type { ParsedFileCache } from '../store/projectStore';

interface DialogTreeColumnProps {
  isProjectMode: boolean;
  selectedNPC: string | null;
  selectedDialog: string | null;
  selectedFunctionName: string | null;
  dialogsForNPC: string[];
  deferredSemanticModel: SemanticModel;
  expandedDialogs: Set<string>;
  buildFunctionTree: (funcName: string, ancestorPath?: string[]) => FunctionTreeNode | null;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  onAddDialog: (dialogName: string) => Promise<void>;
  dialogIndex: Map<string, DialogMetadata[]>;
  parsedFiles: Map<string, ParsedFileCache>;
  setIngestedFilesOpen: (open: boolean) => void;
}

const DialogTreeColumn: React.FC<DialogTreeColumnProps> = ({
  isProjectMode,
  selectedNPC,
  selectedDialog,
  selectedFunctionName,
  dialogsForNPC,
  deferredSemanticModel,
  expandedDialogs,
  buildFunctionTree,
  onSelectDialog,
  onToggleDialogExpand,
  onAddDialog,
  dialogIndex,
  parsedFiles,
  setIngestedFilesOpen,
}) => {
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set());

  const { npcDialogErrors, hasNpcDialogErrors } = useNpcDialogErrors({
    isProjectMode,
    selectedNPC,
    dialogIndex,
    parsedFiles,
  });

  const handleToggleChoiceExpand = useCallback((choiceKey: string) => {
    setExpandedChoices((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(choiceKey)) {
        newSet.delete(choiceKey);
      } else {
        newSet.add(choiceKey);
      }
      return newSet;
    });
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: '0 0 350px', overflow: 'hidden' }}>
      {isProjectMode && hasNpcDialogErrors && (
        <Alert severity="error" sx={{ borderRadius: 0, flexShrink: 0 }}>
          <Typography variant="body2" gutterBottom>
            Failed to parse dialog file(s) for {selectedNPC}
          </Typography>
          <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
            {npcDialogErrors.length} error(s) found. Open the file list (top bar list icon) for full details.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setIngestedFilesOpen(true)}
            sx={{ mb: 0.5 }}
          >
            View details
          </Button>
          {npcDialogErrors.slice(0, 3).map((err, index) => (
            <Typography key={index} variant="caption" display="block" sx={{ whiteSpace: 'pre-wrap' }}>
              - {err.message}
            </Typography>
          ))}
          {npcDialogErrors.length > 3 && (
            <Typography variant="caption" display="block" sx={{ fontStyle: 'italic' }}>
              ...and {npcDialogErrors.length - 3} more
            </Typography>
          )}
        </Alert>
      )}
      <DialogTree
        selectedNPC={selectedNPC}
        dialogsForNPC={dialogsForNPC}
        semanticModel={deferredSemanticModel}
        selectedDialog={selectedDialog}
        selectedFunctionName={selectedFunctionName}
        expandedDialogs={expandedDialogs}
        expandedChoices={expandedChoices}
        onSelectDialog={onSelectDialog}
        onToggleDialogExpand={onToggleDialogExpand}
        onToggleChoiceExpand={handleToggleChoiceExpand}
        buildFunctionTree={buildFunctionTree}
        onAddDialog={onAddDialog}
      />
    </Box>
  );
};

export default DialogTreeColumn;
