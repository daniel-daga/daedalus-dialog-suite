import { useCallback, useId, useMemo, useState } from 'react';
import { Box, FormControl, IconButton, InputLabel, MenuItem, Select, Tooltip } from '@mui/material';
import { Code as CodeIcon } from '@mui/icons-material';
import QuestPicker from '../common/QuestPicker';
import { getQuestMisVariableName } from '../../utils/questIdentity';
import {
  QUEST_CONDITION_STATES,
  buildQuestCondition,
  questConditionScript,
  recognizeQuestCondition,
  type QuestCondition,
  type QuestConditionState
} from '../../quest/domain/questConditions';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

export const QUEST_STATE_LABEL: Record<QuestConditionState, string> = {
  running: 'is running',
  success: 'is completed',
  failed: 'is failed',
  obsolete: 'is cancelled',
  not_started: 'is not started',
  not_running: 'is not running'
};

const MIS_PREFIX = /^mis_/i;
const QUEST_FIELD_SX = { flex: '1 1 55%', minWidth: 180 };

/**
 * A quest condition (#323): "Quest X is running" over the vanilla `MIS_`
 * check. The quest is picked by diary title; edits write the check back as a
 * plain VariableCondition (questConditions.ts).
 */
export default function QuestStateFields({ condition, handleImmediateUpdate, flushUpdate, mainFieldRef }: ConditionFieldsProps) {
  const quest = useMemo<QuestCondition>(
    () => recognizeQuestCondition(condition) ?? { misVariable: '', state: 'success' },
    [condition]
  );
  const [showScript, setShowScript] = useState(false);
  const stateLabelId = useId();

  const write = useCallback(
    (next: QuestCondition) => handleImmediateUpdate(
      { ...condition, ...buildQuestCondition(next.misVariable, next.state) } as ConditionEditorCondition
    ),
    [condition, handleImmediateUpdate]
  );
  const handleQuestChange = useCallback(
    (topic: string) => write({ ...quest, misVariable: getQuestMisVariableName(topic) }),
    [write, quest]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }} data-testid="quest-condition">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <QuestPicker
          label="Quest"
          kind="quest"
          value={quest.misVariable.replace(MIS_PREFIX, 'TOPIC_')}
          onChange={handleQuestChange}
          onFlush={flushUpdate}
          mainFieldRef={mainFieldRef}
          sx={QUEST_FIELD_SX}
        />
        <FormControl size="small" sx={{ flex: '1 1 35%', minWidth: 140 }}>
          <InputLabel id={stateLabelId}>State</InputLabel>
          <Select
            labelId={stateLabelId}
            label="State"
            value={quest.state}
            onChange={(e) => write({ ...quest, state: e.target.value as QuestConditionState })}
          >
            {QUEST_CONDITION_STATES.map((state) => (
              <MenuItem key={state} value={state}>{QUEST_STATE_LABEL[state]}</MenuItem>
            ))}
          </Select>
        </FormControl>
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
      </Box>
      {showScript && (
        <Box
          component="pre"
          data-testid="quest-condition-script"
          sx={{ m: 0, p: 1, fontFamily: 'monospace', fontSize: '0.8rem', bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap' }}
        >
          {questConditionScript(quest)}
        </Box>
      )}
    </Box>
  );
}
