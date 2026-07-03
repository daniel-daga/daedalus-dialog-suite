import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { SwapHoriz as SwapHorizIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';
import type { GiveInventoryItemsAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';
import { displayNumericOrStringField, parseNumericOrStringField } from './numericStringField';

const GiveInventoryItemsRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel
}) => {
  const typedAction = action as GiveInventoryItemsAction;

  // Issue #183 (item 3): keep Tab inside the row (Giver -> Receiver -> Item ->
  // Quantity); only the edges hand off to card-to-card navigation.
  const fieldKeyDown = createRowTabHandlers(handleKeyDown, 4);

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Giver"
        value={typedAction.giver || ''}
        onChange={(value) => handleUpdate({ ...typedAction, giver: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 80 }}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
        semanticModel={semanticModel}
      />
      {/* Issue #183 (item 1): swap Giver <-> Receiver. tabIndex=-1 keeps it a
          mouse-only affordance so the in-row Tab order (item 3) is unaffected. */}
      <Tooltip title="Swap giver and receiver" arrow>
        <IconButton
          size="small"
          tabIndex={-1}
          aria-label="Swap giver and receiver"
          onClick={() => handleUpdate({ ...typedAction, giver: typedAction.receiver, receiver: typedAction.giver })}
          sx={{ flexShrink: 0, alignSelf: 'center' }}
        >
          <SwapHorizIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <VariableAutocomplete
        label="Receiver"
        value={typedAction.receiver || ''}
        onChange={(value) => handleUpdate({ ...typedAction, receiver: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
        sx={{ width: 90 }}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        label="Item"
        value={typedAction.item || ''}
        onChange={(value) => handleUpdate({ ...typedAction, item: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[2]}
        sx={{ flex: 1 }}
        {...AUTOCOMPLETE_POLICIES.actions.item}
        semanticModel={semanticModel}
      />
      <ActionTextField
        label="Quantity"
        value={displayNumericOrStringField(typedAction.quantity)}
        onChange={(value) => handleUpdate({ ...typedAction, quantity: parseNumericOrStringField(value) })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[3]}
        sx={{ width: 90 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default GiveInventoryItemsRenderer;
