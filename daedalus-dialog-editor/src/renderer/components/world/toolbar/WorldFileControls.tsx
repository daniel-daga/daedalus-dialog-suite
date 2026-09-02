import React from 'react';
import { Button, CircularProgress } from '@mui/material';
import type { WorldStatus } from '../../../store/worldStore';

/**
 * The World bar's "file" group (level-editor.md §17):
 * choose/open the Gothic install, the path readout, the open spinner, and
 * save. Moved verbatim out of `WorldSurface.tsx` — every testid and
 * enablement rule is unchanged, only the state and handlers now arrive as
 * props.
 */
export interface WorldFileControlsProps {
  onOpenWorld: () => void;
  status: WorldStatus;
  hasWorld: boolean;
  onSave: () => void;
}

const WorldFileControls: React.FC<WorldFileControlsProps> = ({
  onOpenWorld, status, hasWorld, onSave,
}) => (
  <>
    <Button
      size="small"
      variant="contained"
      onClick={onOpenWorld}
      disabled={status === 'opening'}
      data-testid="world-open"
    >
      Open world
    </Button>
    {status === 'opening' && <CircularProgress size={16} />}
    {/* Always rendered — disabled rather than unmounted, so the file group
        does not resize when a world opens or closes. */}
    <Button size="small" variant="outlined" disabled={!hasWorld} onClick={onSave} data-testid="world-save">
      Save world…
    </Button>
  </>
);

export default WorldFileControls;
