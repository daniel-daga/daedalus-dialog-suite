import React from 'react';
import { Button, Tooltip, Typography } from '@mui/material';
import AddBoxIcon from '@mui/icons-material/AddBox';
import AddLocationAltIcon from '@mui/icons-material/AddLocationAlt';
import PersonAddIcon from '@mui/icons-material/PersonAdd';

/**
 * The World bar's "add" group (level-editor.md §17, "Adding things"): the
 * three things the surface can author, findable before they are needed.
 * Each opens its dialog straight away; where the result goes is the ground
 * point already chosen, or the next ground click if none has been. Until
 * this group existed every one of them was reachable only from the bar that
 * appears *after* a ground click — and two of them only with the Waynet
 * overlay switched on by hand, a precondition nothing on screen stated.
 *
 * Text labels, not icons alone: these are the actions a first-time user is
 * looking for, and "what does this icon do" is the question the group exists
 * to remove.
 */
export interface WorldAddControlsProps {
  hasWorld: boolean;
  onPlaceVob: () => void;
  onInsertNpc: () => void;
  onAddWaypoint: () => void;
}

const WorldAddControls: React.FC<WorldAddControlsProps> = ({
  hasWorld, onPlaceVob, onInsertNpc, onAddWaypoint,
}) => (
  <>
    <Typography variant="caption" color="text.secondary" sx={{ pr: 0.5 }}>
      Add
    </Typography>
    <Tooltip title="Place a VOB… — a mesh, an item, a light or a sound, at the ground point you choose">
      <span>
        <Button
          size="small"
          disabled={!hasWorld}
          onClick={onPlaceVob}
          startIcon={<AddBoxIcon fontSize="small" />}
          data-testid="world-add-vob"
        >
          VOB
        </Button>
      </span>
    </Tooltip>
    <Tooltip title="Insert an NPC… — a Wld_InsertNpc line in the project's STARTUP function, at an existing or a new waypoint">
      <span>
        <Button
          size="small"
          disabled={!hasWorld}
          onClick={onInsertNpc}
          startIcon={<PersonAddIcon fontSize="small" />}
          data-testid="world-add-npc"
        >
          NPC
        </Button>
      </span>
    </Tooltip>
    <Tooltip title="Add a waypoint… — a free point at the ground point you choose">
      <span>
        <Button
          size="small"
          disabled={!hasWorld}
          onClick={onAddWaypoint}
          startIcon={<AddLocationAltIcon fontSize="small" />}
          data-testid="world-add-waypoint-toolbar"
        >
          Waypoint
        </Button>
      </span>
    </Tooltip>
  </>
);

export default WorldAddControls;
