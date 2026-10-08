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
  CircularProgress,
  Alert
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
import { analyzeQuest, getQuestReferences, buildQuestDiary, implicitQuestSource, type QuestDiaryItem, type QuestDiaryState } from '../quest/domain';
import { useProjectStore } from '../store/projectStore';
import { saveDiaryEntryText, upgradeImplicitQuest } from './questDiarySave';

const STATE_LABEL: Record<QuestDiaryState, string> = {
  running: 'Quest started',
  success: 'Quest completed',
  failed: 'Quest failed',
  obsolete: 'Quest cancelled'
};

interface QuestDetailsProps {
  semanticModel: SemanticModel;
  questName: string | null;
}

const QuestDetails: React.FC<QuestDetailsProps> = ({ semanticModel, questName }) => {
  const { navigateToDialog, navigateToSymbol } = useNavigation();
  const updateGlobalConstant = useProjectStore((s) => s.updateGlobalConstant);
  const isLoading = useProjectStore((s) => s.isLoading);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editingEntry, setEditingEntry] = useState<QuestDiaryItem | null>(null);
  const [entryText, setEntryText] = useState('');
  const [isWriting, setIsWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  // Reset editing state when quest changes
  useEffect(() => {
      setIsEditingTitle(false);
      setEditTitle('');
      setEditingEntry(null);
      setWriteError(null);
  }, [questName]);

  const analysis = useMemo(() => {
    return questName ? analyzeQuest(semanticModel, questName) : null;
  }, [semanticModel, questName]);

  const references = useMemo(() => {
    return questName ? getQuestReferences(semanticModel, questName) : [];
  }, [semanticModel, questName]);

  const diary = useMemo(() => {
    return questName ? buildQuestDiary(semanticModel, questName) : [];
  }, [semanticModel, questName]);

  const conditionReferences = useMemo(() => references.filter((ref) => ref.type === 'condition'), [references]);

  const write = async (task: () => Promise<void>) => {
      setIsWriting(true);
      setWriteError(null);
      try {
          await task();
          return true;
      } catch (error) {
          setWriteError(error instanceof Error ? error.message : String(error));
          return false;
      } finally {
          setIsWriting(false);
      }
  };

  const handleSaveEntry = async () => {
      if (!editingEntry) return;
      if (await write(() => saveDiaryEntryText(editingEntry, entryText))) setEditingEntry(null);
  };

  const handleUpgrade = () => {
      const declarationFile = analysis?.filePaths.topic;
      if (!questName || !declarationFile) return;
      void write(() => upgradeImplicitQuest(questName, diary, declarationFile));
  };

  const goTo = (item: { dialogName?: string; functionName: string }) => {
      if (item.dialogName) {
          navigateToDialog(item.dialogName);
      } else {
          navigateToSymbol(item.functionName, { preferSource: true });
      }
  };

  const hasEnding = diary.some((item) => item.kind === 'state' && item.state !== 'running');

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

      {writeError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setWriteError(null)}>{writeError}</Alert>
      )}

      {analysis && !analysis.misVariableExists && diary.length > 0 && (
          <Alert
              severity="info"
              sx={{ mb: 3 }}
              action={
                  <Tooltip title={analysis.filePaths.topic ? `Declare ${analysis.misVariableName} and set it where the diary sets the quest's state` : 'The quest has no TOPIC_ declaration to put it beside'}>
                      <span>
                          <Button
                              size="small"
                              startIcon={<AddIcon />}
                              onClick={handleUpgrade}
                              disabled={isWriting || isLoading || !analysis.filePaths.topic}
                          >
                              Add {analysis.misVariableName}
                          </Button>
                      </span>
                  </Tooltip>
              }
          >
              State inferred from dialog {implicitQuestSource(diary)}
          </Alert>
      )}

      <Paper sx={{ p: 2, mb: 3 }}>
         <Typography variant="h6" gutterBottom>Diary</Typography>
         <List data-testid="quest-diary">
            {diary.map((item, i) => {
                const isEditing = editingEntry === item;
                return (
                <React.Fragment key={`${item.functionName}-${item.path.join('.')}-${i}`}>
                    <ListItem
                      data-testid="quest-diary-item"
                      alignItems="flex-start"
                      // Room for both buttons, so a long entry never runs under them.
                      sx={item.kind === 'entry' && !isEditing ? { pr: 12 } : undefined}
                      secondaryAction={isEditing ? undefined : (
                        <>
                          {item.kind === 'entry' && item.editable && item.filePath && (
                            <Tooltip title="Edit entry" arrow>
                              <IconButton
                                aria-label="edit entry"
                                disabled={isWriting}
                                onClick={() => {
                                  setEntryText(item.text ?? '');
                                  setEditingEntry(item);
                                }}
                              >
                                <EditIcon />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Go to Dialog/Function" arrow>
                            <IconButton edge="end" aria-label="go to reference" onClick={() => goTo(item)}>
                              <OpenInNewIcon />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    >
                        {isEditing ? (
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', width: '100%' }}>
                                <TextField
                                    label="Diary entry"
                                    value={entryText}
                                    onChange={(e) => setEntryText(e.target.value)}
                                    fullWidth
                                    multiline
                                    autoFocus
                                    size="small"
                                />
                                <IconButton aria-label="save entry" onClick={handleSaveEntry} color="primary" disabled={isWriting}>
                                    {isWriting ? <CircularProgress size={24} /> : <SaveIcon />}
                                </IconButton>
                                <IconButton aria-label="cancel edit" onClick={() => setEditingEntry(null)} disabled={isWriting}><CancelIcon /></IconButton>
                            </Box>
                        ) : (
                        <ListItemText
                            primary={item.kind === 'entry' ? item.text : STATE_LABEL[item.state!]}
                            primaryTypographyProps={item.kind === 'state' ? { fontWeight: 'bold' } : undefined}
                            secondary={
                                <>
                                    <Typography component="span" variant="body2" color="text.primary">
                                        {item.dialogName || item.functionName}
                                    </Typography>
                                    {item.npc && ` (${item.npc})`}
                                </>
                            }
                        />
                        )}
                    </ListItem>
                    <Divider component="li" />
                </React.Fragment>
                );
            })}
            {diary.length === 0 && (
                <ListItem><ListItemText primary="Nothing writes to this quest's diary yet" /></ListItem>
            )}
            {diary.length > 0 && !hasEnding && (
                <ListItem><ListItemText secondary="No ending yet" /></ListItem>
            )}
         </List>
      </Paper>

      {conditionReferences.length > 0 && (
          <Paper sx={{ p: 2, mb: 3 }}>
             <Typography variant="h6" gutterBottom>Checked by</Typography>
             <List>
                {conditionReferences.map((ref, i) => (
                    <ListItem
                      key={i}
                      secondaryAction={
                        <Tooltip title="Go to Dialog/Function" arrow>
                          <IconButton edge="end" aria-label="go to reference" onClick={() => goTo(ref)}>
                            <OpenInNewIcon />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                        <ListItemText
                            primary={ref.dialogName || ref.functionName}
                            secondary={ref.npcName}
                        />
                    </ListItem>
                ))}
             </List>
          </Paper>
      )}
    </Box>
  );
};

export default QuestDetails;
