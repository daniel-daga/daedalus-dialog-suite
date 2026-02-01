import React, { useMemo } from 'react';
import { Box, Typography, Paper, Chip, Stack, List, ListItem, ListItemText, Divider } from '@mui/material';
import type { SemanticModel } from '../types/global';
import { getActionType } from './actionTypes';

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

  const references = useMemo(() => {
    const refs: QuestReference[] = [];

    // Map functions to dialogs for better context
    const funcToDialog = new Map<string, { dialogName: string, npcName?: string }>();
    Object.values(semanticModel.dialogs || {}).forEach(dialog => {
        const info = dialog.properties.information;
        if (typeof info === 'string') {
            funcToDialog.set(info, { dialogName: dialog.name, npcName: dialog.properties.npc });
        } else if (info && typeof info === 'object' && info.name) {
             funcToDialog.set(info.name, { dialogName: dialog.name, npcName: dialog.properties.npc });
        }
    });

    Object.values(semanticModel.functions || {}).forEach(func => {
        func.actions?.forEach(action => {
            if ('topic' in action && action.topic === questName) {
                const context = funcToDialog.get(func.name) || { };
                const type = getActionType(action);

                if (type === 'createTopic') {
                     refs.push({
                        type: 'create',
                        functionName: func.name,
                        dialogName: context.dialogName,
                        npcName: context.npcName,
                        details: `Created${(action as any).topicType ? ` in ${(action as any).topicType}` : ''}`
                     });
                } else if (type === 'logSetTopicStatus') {
                     refs.push({
                        type: 'status',
                        functionName: func.name,
                        dialogName: context.dialogName,
                        npcName: context.npcName,
                        details: `Set status to ${(action as any).status}`
                     });
                } else if (type === 'logEntry') {
                     refs.push({
                        type: 'entry',
                        functionName: func.name,
                        dialogName: context.dialogName,
                        npcName: context.npcName,
                        details: `Entry: "${(action as any).text}"`
                     });
                }
            }
        });

        // Check conditions for MIS_ var
        func.conditions?.forEach(cond => {
             // Basic check for variable condition structure as serialized
             if ('variableName' in cond && (cond as any).variableName === misVarName) {
                 const context = funcToDialog.get(func.name) || { };
                 refs.push({
                    type: 'status',
                    functionName: func.name,
                    dialogName: context.dialogName,
                    npcName: context.npcName,
                    details: `Condition: ${(cond as any).negated ? '!' : ''}${misVarName}`
                 });
             }
        });
    });

    return refs;
  }, [semanticModel, questName, misVarName]);

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Typography variant="h4" gutterBottom>
        {String(questConstant?.value || questName).replace(/^"|"$/g, '')}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <Chip label={questName} variant="outlined" />
        {misVariable ? (
            <Chip label={`Var: ${misVarName}`} color="success" variant="outlined" />
        ) : (
            <Chip label={`Missing Var: ${misVarName}`} color="warning" variant="outlined" />
        )}
      </Stack>

      <Paper sx={{ p: 2, mb: 3 }}>
         <Typography variant="h6" gutterBottom>Log Entries & Updates</Typography>
         <List>
            {references.map((ref, i) => (
                <React.Fragment key={i}>
                    <ListItem alignItems="flex-start">
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
