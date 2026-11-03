import React, { useState } from 'react';
import { Box, IconButton, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { Code as CodeIcon } from '@mui/icons-material';
import type { SetVariableAction } from '../../../shared/types';
import type { BaseActionRendererProps } from './types';
import { ActionDeleteButton } from '../common';
import {
  buildStageWrite,
  recognizeStageWrite,
  stageWriteScript,
  type QuestStage,
  type QuestStageWriteKind
} from '../../quest/domain/questStages';

const FORMS: Array<{ kind: QuestStageWriteKind; label: string }> = [
  { kind: 'reached', label: 'Reached' },
  { kind: 'reset', label: 'Reset' },
  { kind: 'counts', label: 'Counts up' }
];

/**
 * A stage write (#325): "Quest X reached stage Y" over one `SetVariableAction`,
 * with the plain line behind show-script.
 */
const StageWriteRenderer: React.FC<BaseActionRendererProps & { stages: QuestStage[] }> = ({
  action,
  stages,
  handleUpdate,
  handleDelete,
  flushUpdate
}) => {
  const [showScript, setShowScript] = useState(false);
  const typed = action as SetVariableAction;
  const write = recognizeStageWrite(action) ?? { variable: '', kind: 'reached' as QuestStageWriteKind };
  const stage = stages.find((s) => s.variable.toUpperCase() === typed.variableName?.toUpperCase()) ?? null;

  const update = (variable: string, kind: QuestStageWriteKind) =>
    handleUpdate({ ...typed, ...buildStageWrite(variable, kind) } as unknown as typeof action);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="stage-write-card">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ minWidth: 110, pt: 1 }}>
          Stage
        </Typography>
        <TextField
          select
          label="Stage"
          size="small"
          value={stage?.variable ?? ''}
          onChange={(e) => update(e.target.value, write.kind)}
          onBlur={flushUpdate}
          SelectProps={{ displayEmpty: true, renderValue: (value) => (value as string) || 'Pick a stage' }}
          sx={{ flex: 1, minWidth: 200 }}
        >
          {stages.map((s) => (
            <MenuItem key={s.variable} value={s.variable}>{`${s.questTitle} · ${s.name}`}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Form"
          size="small"
          value={write.kind}
          onChange={(e) => update(typed.variableName, e.target.value as QuestStageWriteKind)}
          onBlur={flushUpdate}
          sx={{ width: 140 }}
        >
          {FORMS.map(({ kind, label }) => (
            <MenuItem key={kind} value={kind}>{label}</MenuItem>
          ))}
        </TextField>
        <Tooltip title={showScript ? 'Hide script' : 'Show script'}>
          <IconButton
            size="small"
            aria-label={showScript ? 'Hide script' : 'Show script'}
            aria-pressed={showScript}
            onClick={() => setShowScript((shown) => !shown)}
          >
            <CodeIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <ActionDeleteButton onClick={handleDelete} />
      </Box>
      {showScript && (
        <Box
          component="pre"
          data-testid="stage-write-script"
          sx={{ m: 0, p: 1, fontFamily: 'monospace', fontSize: '0.8rem', bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap' }}
        >
          {stageWriteScript(action)}
        </Box>
      )}
    </Box>
  );
};

export default StageWriteRenderer;
