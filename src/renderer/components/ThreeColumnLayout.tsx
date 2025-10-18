import React, { useState, useCallback } from 'react';
import { Box, Typography, Alert, Paper, List, ListItem, ListItemText } from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import NPCList from './NPCList';
import DialogTree from './DialogTree';
import DialogDetailsEditor from './DialogDetailsEditor';

interface ThreeColumnLayoutProps {
  filePath: string;
}

const ThreeColumnLayout: React.FC<ThreeColumnLayoutProps> = ({ filePath }) => {
  const { openFiles, updateModel } = useEditorStore();
  const fileState = openFiles.get(filePath);

  const [selectedNPC, setSelectedNPC] = useState<string | null>(null);
  const [selectedDialog, setSelectedDialog] = useState<string | null>(null);
  const [selectedFunctionName, setSelectedFunctionName] = useState<string | null>(null); // Can be dialog info function or choice function
  const [expandedDialogs, setExpandedDialogs] = useState<Set<string>>(new Set());
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set()); // Track expanded choice nodes

  if (!fileState) {
    return <Typography>Loading...</Typography>;
  }

  // Check for syntax errors - if present, show error display instead of editor
  if (fileState.hasErrors) {
    return (
      <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Syntax Errors Detected
          </Typography>
          <Typography variant="body2">
            This file contains syntax errors and cannot be edited until they are fixed.
            Please correct the errors in a text editor and reload the file.
          </Typography>
        </Alert>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Error Details:
          </Typography>
          <List>
            {(fileState.errors || []).map((error, index) => (
              <ListItem key={index} sx={{ flexDirection: 'column', alignItems: 'flex-start', borderBottom: '1px solid', borderColor: 'divider' }}>
                <ListItemText
                  primary={error.message}
                  secondary={
                    <>
                      <Typography component="span" variant="body2" color="text.secondary">
                        Type: {error.type}
                      </Typography>
                      {error.position && (
                        <>
                          <br />
                          <Typography component="span" variant="body2" color="text.secondary">
                            Location: Line {error.position.row}, Column {error.position.column}
                          </Typography>
                        </>
                      )}
                      {error.text && (
                        <>
                          <br />
                          <Typography component="span" variant="body2" color="error" sx={{ fontFamily: 'monospace', mt: 1, display: 'block' }}>
                            {error.text}
                          </Typography>
                        </>
                      )}
                    </>
                  }
                />
              </ListItem>
            ))}
          </List>
        </Paper>

        <Box sx={{ mt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            File path: {filePath}
          </Typography>
        </Box>
      </Box>
    );
  }

  const { semanticModel } = fileState;

  // Build function tree for a given function (recursively find choices)
  // ancestorPath tracks the path from root to current node to prevent direct cycles
  const buildFunctionTree = useCallback((funcName: string, ancestorPath: string[] = []): any => {
    // Prevent direct cycles (A -> B -> A), but allow diamonds (A -> B, A -> C, both -> D)
    if (ancestorPath.includes(funcName)) {
      return null; // Direct cycle detected
    }

    const func = semanticModel.functions?.[funcName];
    if (!func) return null;

    const choices = (func.actions || []).filter((action: any) =>
      action.dialogRef !== undefined && action.targetFunction !== undefined
    );

    const newPath = [...ancestorPath, funcName];

    return {
      name: funcName,
      function: func,
      children: choices.map((choice: any) => {
        const subtree = buildFunctionTree(choice.targetFunction, newPath);
        return {
          text: choice.text || '(no text)',
          targetFunction: choice.targetFunction,
          subtree: subtree,
          isShared: choices.filter((c: any) => c.targetFunction === choice.targetFunction).length > 1
        };
      }).filter((c: any) => c.subtree !== null)
    };
  }, [semanticModel]);

  // Extract unique NPCs from all dialogs
  const npcMap = new Map<string, string[]>();
  Object.entries(semanticModel.dialogs || {}).forEach(([dialogName, dialog]: [string, any]) => {
    const npcName = dialog.properties?.npc || 'Unknown NPC';
    if (!npcMap.has(npcName)) {
      npcMap.set(npcName, []);
    }
    npcMap.get(npcName)!.push(dialogName);
  });

  const npcs = Array.from(npcMap.keys()).sort();

  // Get dialogs for selected NPC
  const dialogsForNPC = selectedNPC ? (npcMap.get(selectedNPC) || []) : [];

  // Get selected dialog data
  const dialogData = selectedDialog ? semanticModel.dialogs[selectedDialog] : null;

  // Get the information function for the selected dialog
  const infoFunction = dialogData?.properties?.information as any;
  const dialogInfoFunctionName = typeof infoFunction === 'string' ? infoFunction : infoFunction?.name;

  // Get the currently selected function (either dialog info or choice function)
  const currentFunctionName = selectedFunctionName || dialogInfoFunctionName;
  const currentFunctionData = currentFunctionName ? semanticModel.functions[currentFunctionName] : null;

  const handleSelectNPC = (npc: string) => {
    setSelectedNPC(npc);
    setSelectedDialog(null);
  };

  const handleSelectDialog = (dialogName: string, functionName: string | null) => {
    setSelectedDialog(dialogName);
    setSelectedFunctionName(functionName);
  };

  const handleToggleDialogExpand = (dialogName: string) => {
    setExpandedDialogs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(dialogName)) {
        newSet.delete(dialogName);
      } else {
        newSet.add(dialogName);
      }
      return newSet;
    });
  };

  const handleToggleChoiceExpand = (choiceKey: string) => {
    setExpandedChoices((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(choiceKey)) {
        newSet.delete(choiceKey);
      } else {
        newSet.add(choiceKey);
      }
      return newSet;
    });
  };

  const handleNavigateToFunction = (functionName: string) => {
    // Navigate to the choice function
    setSelectedFunctionName(functionName);
    // Optionally expand the dialog tree to show the choice
    if (selectedDialog) {
      setExpandedDialogs((prev) => new Set([...prev, selectedDialog]));
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Column 1: NPC List */}
      <NPCList
        npcs={npcs}
        npcMap={npcMap}
        selectedNPC={selectedNPC}
        onSelectNPC={handleSelectNPC}
      />

      {/* Column 2: Dialog Tree with Nested Choices */}
      <DialogTree
        selectedNPC={selectedNPC}
        dialogsForNPC={dialogsForNPC}
        semanticModel={semanticModel}
        selectedDialog={selectedDialog}
        selectedFunctionName={selectedFunctionName}
        expandedDialogs={expandedDialogs}
        expandedChoices={expandedChoices}
        onSelectDialog={handleSelectDialog}
        onToggleDialogExpand={handleToggleDialogExpand}
        onToggleChoiceExpand={handleToggleChoiceExpand}
        buildFunctionTree={buildFunctionTree}
      />

      {/* Column 3: Function Action Editor */}
      <Box sx={{ flex: '1 1 auto', overflow: 'auto', p: 2, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selectedDialog && dialogData && currentFunctionName && currentFunctionData ? (
          <Box sx={{ width: '100%' }}>
            <DialogDetailsEditor
              key={`${selectedDialog}-${currentFunctionName}`}
              dialogName={selectedDialog}
              dialog={dialogData}
              infoFunction={currentFunctionData}
              filePath={filePath}
              onUpdateDialog={(updatedDialog) => {
                const updatedModel = {
                  ...semanticModel,
                  dialogs: {
                    ...semanticModel.dialogs,
                    [selectedDialog]: updatedDialog
                  }
                };
                updateModel(filePath, updatedModel);
              }}
              onUpdateFunction={(updatedFunction) => {
                if (currentFunctionName) {
                  const updatedModel = {
                    ...semanticModel,
                    functions: {
                      ...semanticModel.functions,
                      [currentFunctionName]: updatedFunction
                    }
                  };
                  updateModel(filePath, updatedModel);
                }
              }}
              onNavigateToFunction={handleNavigateToFunction}
            />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="body1" color="text.secondary">
              Select a dialog to edit
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ThreeColumnLayout;
