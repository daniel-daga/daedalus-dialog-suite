import React, { useCallback, useMemo, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { Code as CodeIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';
import type { QuestStepAction } from '../actionTypes';
import { ActionTextField, ActionDeleteButton } from '../common';
import QuestPicker from '../common/QuestPicker';
import { createRowTabHandlers } from './rowTabNavigation';

const KIND_LABEL: Record<QuestStepAction['kind'], string> = {
  start: 'Start quest',
  complete: 'Complete quest',
  fail: 'Fail quest',
  cancel: 'Cancel quest',
  note: 'Note'
};

const QUEST_FIELD_SX = { flex: 1, minWidth: 180 };

/**
 * A quest step card (#322): one card for the vanilla lines that start, log,
 * end or note a quest. Edits go back to those lines through ActionsList.
 */
const QuestStepRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const step = action as unknown as QuestStepAction;
  const [showScript, setShowScript] = useState(false);
  const update = useCallback(
    (patch: Partial<QuestStepAction>) => handleUpdate({ ...step, ...patch } as unknown as typeof action),
    [handleUpdate, step]
  );

  const handleTopicChange = useCallback((topic: string) => update({ topic }), [update]);

  const hasXp = step.kind === 'complete';
  const fieldKeyDown = useMemo(
    () => createRowTabHandlers(handleKeyDown, hasXp ? 3 : 2),
    [handleKeyDown, hasXp]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="quest-step-card">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ minWidth: 110, pt: 1 }}>
          {KIND_LABEL[step.kind]}
        </Typography>
        <QuestPicker
          label={step.kind === 'note' ? 'Note topic' : 'Quest'}
          kind={step.kind === 'note' ? 'note' : 'quest'}
          value={step.topic}
          onChange={handleTopicChange}
          onFlush={flushUpdate}
          onKeyDown={fieldKeyDown[0]}
          mainFieldRef={mainFieldRef}
          sx={QUEST_FIELD_SX}
        />
        {hasXp && (
          <ActionTextField
            label="XP (optional)"
            placeholder="XP_… or a number"
            value={step.xp}
            onChange={(value) => update({ xp: value.trim() })}
            onFlush={flushUpdate}
            onKeyDown={fieldKeyDown[1]}
            sx={{ width: 170 }}
          />
        )}
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
      <ActionTextField
        fullWidth
        label={step.kind === 'note' ? 'Note text' : 'Diary entry'}
        placeholder={step.kind === 'start' || step.kind === 'note' ? '' : 'Optional'}
        value={step.text}
        onChange={(value) => update({ text: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[hasXp ? 2 : 1]}
        multiline
        minRows={1}
      />
      {showScript && (
        <Box
          component="pre"
          data-testid="quest-step-script"
          sx={{ m: 0, p: 1, fontFamily: 'monospace', fontSize: '0.8rem', bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap' }}
        >
          {step.script}
        </Box>
      )}
    </Box>
  );
};

export default QuestStepRenderer;
