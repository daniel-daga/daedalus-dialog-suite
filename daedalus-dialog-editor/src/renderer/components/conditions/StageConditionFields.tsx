import { useCallback, useId, useMemo, useState } from 'react';
import { Box, FormControl, IconButton, InputLabel, MenuItem, Select, TextField, Tooltip } from '@mui/material';
import { Code as CodeIcon } from '@mui/icons-material';
import { useProjectStore } from '../../store/projectStore';
import {
  buildStageRead,
  declaredStages,
  recognizeStageRead,
  stageReadScript,
  type QuestStage,
  type QuestStageRead,
  type QuestStageReadKind
} from '../../quest/domain/questStages';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

export const STAGE_FORM_LABEL: Record<Exclude<QuestStageReadKind, 'at_least'>, string> = {
  reached: 'reached',
  not_reached: 'not reached'
};

const stageOf = (stages: QuestStage[], variable: string) =>
  stages.find((stage) => stage.variable.toUpperCase() === variable.toUpperCase()) ?? null;

/** The card's chip: "Stage Sheep at least 5". */
export function stageReadLabel(read: QuestStageRead, stages: QuestStage[]): string {
  const name = stageOf(stages, read.variable)?.name ?? 'Stage';
  return read.kind === 'at_least'
    ? `Stage ${name} at least ${read.target}`
    : `Stage ${name} ${STAGE_FORM_LABEL[read.kind]}`;
}

/**
 * A stage condition (#325): "Quest X reached stage Y" over one
 * `VariableCondition`. Only a stage the project declares is recognised; the
 * card writes the plain check back (questStages.ts).
 */
export default function StageConditionFields({ condition, handleImmediateUpdate, flushUpdate, mainFieldRef }: ConditionFieldsProps) {
  const variables = useProjectStore((s) => s.mergedSemanticModel.variables);
  const constants = useProjectStore((s) => s.mergedSemanticModel.constants);
  const stages = useMemo(() => declaredStages({ variables, constants }), [variables, constants]);

  const read = useMemo<QuestStageRead>(
    () => recognizeStageRead(condition, stages) ?? { variable: '', kind: 'reached' },
    [condition, stages]
  );
  const [showScript, setShowScript] = useState(false);
  const formLabelId = useId();

  const write = useCallback(
    (next: QuestStageRead) => handleImmediateUpdate(
      { ...condition, ...buildStageRead(next.variable, next.kind, next.target) } as ConditionEditorCondition
    ),
    [condition, handleImmediateUpdate]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }} data-testid="stage-condition">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <TextField
          select
          label="Stage"
          size="small"
          value={stageOf(stages, read.variable)?.variable ?? ''}
          onChange={(e) => write({ ...read, variable: e.target.value })}
          onBlur={flushUpdate}
          inputRef={mainFieldRef}
          SelectProps={{
            displayEmpty: true,
            renderValue: (value) => {
              const stage = stageOf(stages, value as string);
              return stage ? `${stage.questTitle} · ${stage.name}` : 'Pick a stage';
            }
          }}
          sx={{ flex: '1 1 55%', minWidth: 180 }}
        >
          {stages.map((stage) => (
            <MenuItem key={stage.variable} value={stage.variable}>{`${stage.questTitle} · ${stage.name}`}</MenuItem>
          ))}
        </TextField>
        <FormControl size="small" sx={{ flex: '1 1 35%', minWidth: 140 }}>
          <InputLabel id={formLabelId}>Form</InputLabel>
          <Select
            labelId={formLabelId}
            label="Form"
            value={read.kind}
            onChange={(e) => write({ ...read, kind: e.target.value as QuestStageReadKind })}
          >
            <MenuItem value="reached">Reached</MenuItem>
            <MenuItem value="not_reached">Not reached</MenuItem>
            <MenuItem value="at_least">At least</MenuItem>
          </Select>
        </FormControl>
        {read.kind === 'at_least' && (
          <TextField
            label="Count"
            type="number"
            size="small"
            value={read.target ?? 1}
            onChange={(e) => write({ ...read, target: Number(e.target.value) })}
            onBlur={flushUpdate}
            sx={{ width: 100 }}
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
      </Box>
      {showScript && (
        <Box
          component="pre"
          data-testid="stage-condition-script"
          sx={{ m: 0, p: 1, fontFamily: 'monospace', fontSize: '0.8rem', bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap' }}
        >
          {stageReadScript(read)}
        </Box>
      )}
    </Box>
  );
}
