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
import { useNavigation } from '../hooks/useNavigation';
import { analyzeQuest, getQuestReferences } from './QuestEditor/questAnalysis';
import { useProjectStore } from '../store/projectStore';

interface QuestDetailsProps {
  semanticModel: SemanticModel;
  questName: string | null;
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
    return questName ? getQuestReferences(semanticModel, questName) : [];
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

        <Chip
            label={analysis?.logicMethod === 'explicit' ? `Method B: Explicit (${analysis.misVariableName})` : 
                   analysis?.logicMethod === 'implicit' ? 'Method A: Implicit (KnowsInfo/Items)' :
                   'Logic: Unknown/Diary Only'}
            color={analysis?.logicMethod === 'explicit' ? "primary" : 
                   analysis?.logicMethod === 'implicit' ? "info" : "default"}
            variant="outlined"
            icon={<InfoIcon />}
        />

        <Chip
            label={analysis?.status === 'implemented' ? 'Implemented' :
                   analysis?.status === 'wip' ? 'Work In Progress' : 'Not Started'}
            color={analysis?.status === 'implemented' ? 'success' :
                   analysis?.status === 'wip' ? 'info' : 'default'}
            icon={analysis?.status === 'implemented' ? <CheckCircleIcon /> :
                  analysis?.status === 'wip' ? <InfoIcon /> : undefined}
            variant="filled"
        />

        <Chip
            label={
              analysis?.lifecycleSource === 'mis' ? 'Lifecycle: MIS assignments' :
              analysis?.lifecycleSource === 'topic' ? 'Lifecycle: Topic status' :
              analysis?.lifecycleSource === 'mixed' ? 'Lifecycle: Mixed (MIS + Topic)' :
              'Lifecycle: No status signals'
            }
            color={
              analysis?.lifecycleSource === 'mis' ? 'primary' :
              analysis?.lifecycleSource === 'topic' ? 'info' :
              analysis?.lifecycleSource === 'mixed' ? 'secondary' :
              'default'
            }
            variant="outlined"
            icon={<InfoIcon />}
        />

        {analysis?.hasLifecycleConflict && (
          <Chip
            label="State Conflict: Topic vs MIS"
            color="warning"
            icon={<WarningIcon />}
            variant="outlined"
          />
        )}
      </Stack>

      {analysis?.logicMethod === 'unknown' && !analysis?.misVariableExists && (
          <Paper sx={{ p: 2, mb: 3, bgcolor: 'rgba(255, 152, 0, 0.05)', border: '1px solid rgba(255, 152, 0, 0.2)' }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                  <WarningIcon color="warning" />
                  <Typography variant="subtitle1" color="warning.main">State Tracking Advice</Typography>
              </Box>
              <Typography variant="body2" sx={{ mb: 2 }}>
                  This quest only uses the Diary (Log_SetTopicStatus) which is write-only. 
                  Choose a method to track quest state in scripts:
              </Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                  <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle2">Method A: Implicit</Typography>
                      <Typography variant="caption">Use Npc_KnowsInfo or Npc_HasItems. Best for simple, linear quests.</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle2">Method B: Explicit</Typography>
                      <Typography variant="caption">Use a script variable (e.g. {analysis?.misVariableName}). Necessary for complex world-state changes.</Typography>
                      <Button 
                        size="small" 
                        startIcon={<AddIcon />} 
                        onClick={handleCreateVariable}
                        disabled={isLoading}
                        sx={{ mt: 1 }}
                      >
                          Create Variable
                      </Button>
                  </Box>
              </Box>
          </Paper>
      )}

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
