import React, { useMemo, useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Stack,
  List,
  ListItem,
  ListItemText,
  Divider,
  IconButton,
  Tooltip,
  Button,
  TextField,
  CircularProgress
} from '@mui/material';
import {
  OpenInNew as OpenInNewIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Info as InfoIcon
} from '@mui/icons-material';
import type { SemanticModel } from '../types/global';
import { getActionType } from './actionTypes';
import { useNavigation } from '../hooks/useNavigation';
import { analyzeQuest } from './QuestEditor/questGraphUtils';
import { useProjectStore } from '../store/projectStore';

interface QuestDetailsProps {
  semanticModel: SemanticModel;
  questName: string | null;
}

interface QuestReference {
  type: 'create' | 'status' | 'entry';
  dialogName?: string;
  functionName: string;
  npcName?: string;
  details: string;
}

const QuestDetails: React.FC<QuestDetailsProps> = ({ semanticModel, questName }) => {
  const { navigateToDialog, navigateToSymbol } = useNavigation();
  const { addVariable, updateGlobalConstant, isLoading } = useProjectStore();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');

  // Reset editing state when quest changes
  useEffect(() => {
      setIsEditingTitle(false);
      setEditTitle('');
  }, [questName]);

  const analysis = useMemo(() => {
    return questName ? analyzeQuest(semanticModel, questName) : null;
  }, [semanticModel, questName]);

  const references = useMemo(() => {
    if (!questName) return [];
    const lowerQuestName = questName.toLowerCase();
    const misVarName = questName.replace('TOPIC_', 'MIS_');
    const lowerMisVarName = misVarName.toLowerCase();
    
    const refs: QuestReference[] = [];

    // Map functions to dialogs for better context
    const funcToDialog = new Map<string, { dialogName: string, npcName?: string }>();
    Object.values(semanticModel.dialogs || {}).forEach(dialog => {
        const info = dialog.properties.information;
        if (typeof info === 'string') {
            funcToDialog.set(info.toLowerCase(), { dialogName: dialog.name, npcName: dialog.properties.npc });
        } else if (info && typeof info === 'object' && info.name) {
             funcToDialog.set(info.name.toLowerCase(), { dialogName: dialog.name, npcName: dialog.properties.npc });
        }
    });

    Object.values(semanticModel.functions || {}).forEach(func => {
        func.actions?.forEach(action => {
            if ('topic' in action && action.topic && action.topic.toLowerCase() === lowerQuestName) {
                const context = funcToDialog.get(func.name.toLowerCase());
                const type = getActionType(action);

                if (type === 'createTopic') {
                     refs.push({
                        type: 'create',
                        functionName: func.name,
                        dialogName: context?.dialogName,
                        npcName: context?.npcName,
                        details: `Created${(action as any).topicType ? ` in ${(action as any).topicType}` : ''}`
                     });
                } else if (type === 'logSetTopicStatus') {
                     refs.push({
                        type: 'status',
                        functionName: func.name,
                        dialogName: context?.dialogName,
                        npcName: context?.npcName,
                        details: `Set status to ${(action as any).status}`
                     });
                } else if (type === 'logEntry') {
                     refs.push({
                        type: 'entry',
                        functionName: func.name,
                        dialogName: context?.dialogName,
                        npcName: context?.npcName,
                        details: `Entry: "${(action as any).text}"`
                     });
                }
            }
        });

        // Check conditions for MIS_ var
        func.conditions?.forEach(cond => {
             // Basic check for variable condition structure as serialized
             if ('variableName' in cond && cond.variableName && (cond as any).variableName.toLowerCase() === lowerMisVarName) {
                 const context = funcToDialog.get(func.name.toLowerCase());
                 refs.push({
                    type: 'status',
                    functionName: func.name,
                    dialogName: context?.dialogName,
                    npcName: context?.npcName,
                    details: `Condition: ${(cond as any).negated ? '!' : ''}${misVarName}`
                 });
             }
        });
    });

    return refs;
  }, [semanticModel, questName]);

  const handleCreateVariable = async () => {
      if (!analysis || analysis.misVariableExists || !analysis.misVariableName) return;

      // Use topic file path if available, or just throw error/ask user (not implemented here)
      const filePath = analysis.filePaths.topic;
      if (filePath) {
           await addVariable(analysis.misVariableName, 'int', undefined, filePath, false);
      } else {
          // Should normally allow picking file, but for now we rely on topic file being present
          console.error("Cannot determine file path for new variable");
      }
  };

  const handleSaveTitle = async () => {
      if (!analysis || !analysis.filePaths.topic || !questName) return;
      await updateGlobalConstant(questName, editTitle, analysis.filePaths.topic);
      setIsEditingTitle(false);
  };

  if (!questName) {
    return (
      <Box sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Typography color="text.secondary">Select a quest to view details</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Box sx={{ mb: 2 }}>
          {isEditingTitle ? (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      fullWidth
                      autoFocus
                      size="small"
                      placeholder="Quest Title"
                  />
                  <IconButton onClick={handleSaveTitle} color="primary" disabled={isLoading}>
                      {isLoading ? <CircularProgress size={24} /> : <SaveIcon />}
                  </IconButton>
                  <IconButton onClick={() => setIsEditingTitle(false)} disabled={isLoading}><CancelIcon /></IconButton>
              </Box>
          ) : (
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="h4" sx={{ flexGrow: 1, wordBreak: 'break-word' }}>
                    {analysis?.description || questName}
                </Typography>
                <Tooltip title="Edit Description">
                    <IconButton onClick={() => {
                        setEditTitle(analysis?.description || '');
                        setIsEditingTitle(true);
                    }}>
                        <EditIcon />
                    </IconButton>
                </Tooltip>
             </Box>
          )}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Chip 
          label={questName} 
          variant="outlined" 
          onDelete={() => navigateToSymbol(questName, { preferSource: true })}
          deleteIcon={<Tooltip title="Follow reference"><OpenInNewIcon /></Tooltip>}
        />

        {analysis?.misVariableExists ? (
            <Chip 
              label={`Var: ${analysis.misVariableName}`}
              color="success" 
              variant="outlined" 
              onDelete={() => navigateToSymbol(analysis.misVariableName, { preferSource: true })}
              deleteIcon={<Tooltip title="Follow reference"><OpenInNewIcon /></Tooltip>}
            />
        ) : (
            <Chip
                label={`Missing Var: ${analysis?.misVariableName || 'MIS_...'}`}
                color="warning"
                variant="outlined"
                onDelete={handleCreateVariable}
                deleteIcon={<Tooltip title="Create Variable"><AddIcon /></Tooltip>}
                disabled={isLoading}
            />
        )}

        <Chip
            label={analysis?.status === 'implemented' ? 'Implemented' :
                   analysis?.status === 'wip' ? 'Work In Progress' :
                   analysis?.status === 'broken' ? 'Broken' : 'Not Started'}
            color={analysis?.status === 'implemented' ? 'success' :
                   analysis?.status === 'wip' ? 'info' :
                   analysis?.status === 'broken' ? 'error' : 'default'}
            icon={analysis?.status === 'implemented' ? <CheckCircleIcon /> :
                  analysis?.status === 'wip' ? <InfoIcon /> :
                  analysis?.status === 'broken' ? <WarningIcon /> : undefined}
            variant="filled"
        />
      </Stack>

      <Paper sx={{ p: 2, mb: 3 }}>
         <Typography variant="h6" gutterBottom>Log Entries & Updates</Typography>
         <List>
            {references.map((ref, i) => (
                <React.Fragment key={i}>
                    <ListItem 
                      alignItems="flex-start"
                      secondaryAction={
                        <Tooltip title="Go to Dialog/Function" arrow>
                          <IconButton 
                            edge="end" 
                            aria-label="go to reference"
                            onClick={() => {
                              if (ref.dialogName) {
                                navigateToDialog(ref.dialogName);
                              } else {
                                navigateToSymbol(ref.functionName, { preferSource: true });
                              }
                            }}
                          >
                            <OpenInNewIcon />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                        <ListItemText
                            primary={ref.details}
                            secondary={
                                <>
                                    <Typography component="span" variant="body2" color="text.primary">
                                        {ref.dialogName || ref.functionName}
                                    </Typography>
                                    {ref.npcName && ` (${ref.npcName})`}
                                </>
                            }
                        />
                    </ListItem>
                    <Divider component="li" />
                </React.Fragment>
            ))}
            {references.length === 0 && (
                <ListItem><ListItemText primary="No references found" /></ListItem>
            )}
         </List>
      </Paper>
    </Box>
  );
};

export default QuestDetails;
