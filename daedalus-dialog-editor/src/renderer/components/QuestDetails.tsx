import React, { useMemo } from 'react';
import { Box, Typography, Paper, Chip, Stack, List, ListItem, ListItemText, Divider, IconButton, Tooltip } from '@mui/material';
import { OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import type { SemanticModel } from '../types/global';
import { getActionType } from './actionTypes';
import { useNavigation } from '../hooks/useNavigation';

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

  if (!questName) {
    return (
      <Box sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Typography color="text.secondary">Select a quest to view details</Typography>
      </Box>
    );
  }

  const questConstant = semanticModel.constants?.[questName];
  const misVarName = questName.replace('TOPIC_', 'MIS_');
  const misVariable = semanticModel.variables?.[misVarName];

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Typography variant="h4" gutterBottom>
        {String(questConstant?.value || questName).replace(/^"|"$/g, '')}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <Chip 
          label={questName} 
          variant="outlined" 
          onDelete={() => navigateToSymbol(questName)}
          deleteIcon={<Tooltip title="Follow reference"><OpenInNewIcon /></Tooltip>}
        />
        {misVariable ? (
            <Chip 
              label={`Var: ${misVarName}`} 
              color="success" 
              variant="outlined" 
              onDelete={() => navigateToSymbol(misVarName)}
              deleteIcon={<Tooltip title="Follow reference"><OpenInNewIcon /></Tooltip>}
            />
        ) : (
            <Chip label={`Missing Var: ${misVarName}`} color="warning" variant="outlined" />
        )}
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
                                navigateToSymbol(ref.functionName);
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
