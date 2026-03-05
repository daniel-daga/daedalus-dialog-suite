import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { InsertNpcActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const InsertNpcActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel
}) => {
  const typedAction = action as InsertNpcActionType;

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="NPC Instance"
        value={typedAction.npcInstance || ''}
        onChange={(value) => handleUpdate({ ...typedAction, npcInstance: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 220 }}
        semanticModel={semanticModel}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <ActionTextField
        fullWidth
        label="Spawn Point"
        value={typedAction.spawnPoint || ''}
        onChange={(value) => handleUpdate({ ...typedAction, spawnPoint: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default InsertNpcActionRenderer;
