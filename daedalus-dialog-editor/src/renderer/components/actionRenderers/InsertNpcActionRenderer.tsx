import React, { useCallback, useMemo } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { Place as PlaceIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';
import type { InsertNpcActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';
import { useWorldStore } from '../../store/worldStore';
import { useUISelectionStore } from '../../store/uiSelectionStore';
import { worldHasPoint } from '../../problems/domain/types';
import type { WorldWaynetView } from '../../problems/domain/types';

/**
 * Why the jump lives here (level-editor.md §16.23, W4 of §16.8): this is the
 * only place the editor shows a script-side waypoint name, and `Wld_InsertNpc`
 * is where the corpus keeps most of them.
 *
 * The lookup has the three answers §16.8 measured, and only two are ours to
 * give: the point is in the open world, or it is not in *this* one. "No such
 * waypoint anywhere" stays reserved — the editor holds one world and has no
 * index of the others — so the disabled reason never says missing.
 */
const jumpReason = (spawnPoint: string, world: WorldWaynetView | null): string | null => {
  if (!spawnPoint) return 'This action names no spawn point';
  if (world === null) return 'No world is open';
  // `worldHasPoint` and not a set lookup here: a spawn point is a waypoint
  // **or a free point**, 704 of the retail scripts' 3,722 `Wld_InsertNpc`
  // literals are the latter, and matching exactly against the waynet called
  // every one of them missing while the Problems rule beside it stayed quiet.
  // The name comes out of a script, where Daedalus is case-insensitive; the
  // store uppercased the world's own spelling once, on load.
  if (!worldHasPoint(world, spawnPoint)) return `${spawnPoint} is not in the open world`;
  return null;
};

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const NPC_INSTANCE_FIELD_SX = { minWidth: 220 };

const InsertNpcActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as InsertNpcActionType;

  // #183 follow-up: Tab walks NPC Instance -> Spawn Point; only the row edges
  // hand off to card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  // `null` while no world is open, which is what separates the two answers.
  // A world open whose waynet read failed leaves the names null too, and that
  // reads as "not in this world" — the jump would land nowhere either way.
  const world = useWorldStore(
    (s) => (s.status === 'ready' ? (s.waynetNames ?? null) : null),
  );
  const spawnPoint = typedAction.spawnPoint || '';
  const disabledReason = jumpReason(spawnPoint, world);

  // The renderer cannot call the viewport — it is another view, and while this
  // one is on screen the World surface is not mounted. So the jump is a request
  // the surface consumes, exactly as the Problems panel leaves one (§16.20).
  const handleJump = useCallback(() => {
    useWorldStore.getState().requestFocus({ kind: 'waypoint', name: spawnPoint });
    useUISelectionStore.getState().setActiveView('world');
  }, [spawnPoint]);

  const handleNpcInstanceChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, npcInstance: value }),
    [handleUpdate, typedAction]
  );

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="NPC Instance"
        value={typedAction.npcInstance || ''}
        onChange={handleNpcInstanceChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={NPC_INSTANCE_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <ActionTextField
        fullWidth
        label="Spawn Point"
        value={typedAction.spawnPoint || ''}
        onChange={(value) => handleUpdate({ ...typedAction, spawnPoint: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
      />
      <Tooltip title={disabledReason ?? `Show ${spawnPoint} in the world`}>
        <span>
          <IconButton
            size="small"
            aria-label="Show spawn point in world"
            tabIndex={-1}
            disabled={disabledReason !== null}
            onClick={handleJump}
          >
            <PlaceIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default InsertNpcActionRenderer;
