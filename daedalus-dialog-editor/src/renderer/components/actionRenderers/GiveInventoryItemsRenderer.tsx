import React, { useCallback, useMemo } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { SwapHoriz as SwapHorizIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';
import type { GiveInventoryItemsAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';
import { displayNumericOrStringField, parseNumericOrStringField } from './numericStringField';

// Hoisted so VariableAutocomplete's memo sees stable sx identities (slice 4).
const GIVER_FIELD_SX = { width: 80 };
const RECEIVER_FIELD_SX = { width: 90 };
const ITEM_FIELD_SX = { flex: 1 };

const GiveInventoryItemsRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as GiveInventoryItemsAction;

  // Issue #183 (item 3): keep Tab inside the row (Giver -> Receiver -> Item ->
  // Quantity); only the edges hand off to card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 4), [handleKeyDown]);

  const handleGiverChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, giver: value }),
    [handleUpdate, typedAction]
  );

  const handleReceiverChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, receiver: value }),
    [handleUpdate, typedAction]
  );

  const handleItemChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, item: value }),
    [handleUpdate, typedAction]
  );

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Giver"
        value={typedAction.giver || ''}
        onChange={handleGiverChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={GIVER_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
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
        onChange={handleReceiverChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
        sx={RECEIVER_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <VariableAutocomplete
        label="Item"
        value={typedAction.item || ''}
        onChange={handleItemChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[2]}
        sx={ITEM_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.item}
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
