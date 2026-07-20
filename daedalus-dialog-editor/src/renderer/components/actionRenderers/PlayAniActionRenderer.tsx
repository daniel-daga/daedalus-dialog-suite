import React, { useCallback, useMemo } from 'react';
import type { BaseActionRendererProps } from './types';
import type { PlayAniAction } from '../../../shared/types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';

// Hoisted so VariableAutocomplete's memo sees stable sx identities (slice 4).
const TARGET_FIELD_SX = { minWidth: 150 };
const ANIMATION_FIELD_SX = { ml: 1 };

const PlayAniActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as PlayAniAction;

  // #183 follow-up: Tab walks Target -> Animation; only the row edges hand off
  // to card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  const handleTargetChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, target: value }),
    [handleUpdate, typedAction]
  );

  const handleAnimationChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, animationName: value }),
    [handleUpdate, typedAction]
  );

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target"
        value={typedAction.target || 'self'}
        onChange={handleTargetChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={TARGET_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.npcNoInstances}
      />
      <VariableAutocomplete
        fullWidth
        label="Animation"
        value={typedAction.animationName || ''}
        onChange={handleAnimationChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
        placeholder="e.g. T_SEARCH"
        sx={ANIMATION_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.animation}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default PlayAniActionRenderer;
