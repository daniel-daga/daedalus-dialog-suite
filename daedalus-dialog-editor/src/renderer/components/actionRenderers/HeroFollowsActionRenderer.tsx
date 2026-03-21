import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { HeroFollowsActionType } from '../../../shared/types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

const HeroFollowsActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as HeroFollowsActionType;

  return (
    <ActionFieldContainer>
      <ActionTextField
        fullWidth
        label="Guide Routine"
        value={typedAction.guideRoutine || ''}
        onChange={(value) => handleUpdate({ ...typedAction, guideRoutine: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        placeholder="e.g. RTN_SZMYK_15_GUIDEMITTE"
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default HeroFollowsActionRenderer;
