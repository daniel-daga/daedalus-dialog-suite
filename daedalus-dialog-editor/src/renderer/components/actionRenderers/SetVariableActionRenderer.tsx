import React, { useCallback, useMemo } from 'react';
import type { BaseActionRendererProps } from './types';
import type { SetVariableAction } from '../../../shared/types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import { TextField, MenuItem } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';
import { useProjectStore } from '../../store/projectStore';
import { declaredStages, recognizeStageWrite, STAGE_PLACEHOLDER, type QuestStage } from '../../quest/domain/questStages';
import StageWriteRenderer from './StageWriteRenderer';

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const VARIABLE_FIELD_SX = { minWidth: 200 };

const stageOf = (stages: QuestStage[], variableName: string | undefined) =>
  variableName ? stages.find((s) => s.variable.toUpperCase() === variableName.toUpperCase()) ?? null : null;

const SetVariableActionRenderer: React.FC<BaseActionRendererProps> = (props) => {
  const { action, handleUpdate, handleDelete, flushUpdate, handleKeyDown, mainFieldRef } = props;
  const typedAction = action as SetVariableAction;

  // #325: a write to a declared stage is a Stage card; the inventory is the
  // project's declared STAGE_ globals, so no index is kept here.
  const variables = useProjectStore((s) => s.mergedSemanticModel.variables);
  const constants = useProjectStore((s) => s.mergedSemanticModel.constants);
  const stages = useMemo(() => declaredStages({ variables, constants }), [variables, constants]);
  const write = recognizeStageWrite(action);
  const stage = stageOf(stages, typedAction.variableName);

  // #183 follow-up: Tab walks Variable -> Op -> Value; only the row edges hand
  // off to card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 3), [handleKeyDown]);

  const handleVariableNameChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, variableName: value }),
    [handleUpdate, typedAction]
  );

  const variableNameMissing = !typedAction.variableName?.trim();
  // A stage-shaped name nothing declares reads as a plain Set Variable, the way
  // an undeclared quest on a step card does.
  const notDeclared = /^stage_./i.test(typedAction.variableName?.trim() ?? '');
  const variableTextFieldProps = useMemo(() => ({
    error: variableNameMissing,
    helperText: variableNameMissing
      ? 'Variable name required'
      : notDeclared
        ? 'Not declared'
        : undefined
  }), [variableNameMissing, notDeclared]);

  // A placeholder name is the Set Stage entry's card before a stage is picked.
  if (write && (stage || STAGE_PLACEHOLDER.test(write.variable))) {
    return <StageWriteRenderer {...props} stages={stages} />;
  }

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Variable"
        value={typedAction.variableName || ''}
        onChange={handleVariableNameChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={VARIABLE_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.setVariableName}
        textFieldProps={variableTextFieldProps}
      />
      <TextField
        select
        label="Op"
        value={typedAction.operator || '='}
        onChange={(e) => {
            handleUpdate({ ...typedAction, operator: e.target.value });
            flushUpdate();
        }}
        onKeyDown={fieldKeyDown[1]}
        sx={{ width: 80, mx: 1 }}
        size="small"
        variant="outlined"
      >
        <MenuItem value="=">=</MenuItem>
        <MenuItem value="+=">+=</MenuItem>
        <MenuItem value="-=">-=</MenuItem>
      </TextField>
      <TextField
        fullWidth
        label="Value"
        value={String(typedAction.value !== undefined ? typedAction.value : '')}
        onChange={(e) => {
          const value = e.target.value;
          // Try to preserve number type if it looks like a number
          const num = Number(value);
          const isNum = !isNaN(num) && value.trim() !== '';
          handleUpdate({ ...typedAction, value: isNum ? num : value });
        }}
        onBlur={flushUpdate}
        onKeyDown={fieldKeyDown[2]}
        size="small"
        variant="outlined"
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default SetVariableActionRenderer;
