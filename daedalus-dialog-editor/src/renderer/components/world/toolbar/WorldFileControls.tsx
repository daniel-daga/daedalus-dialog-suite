import React from 'react';
import { Button, CircularProgress } from '@mui/material';
import type { WorldStatus } from '../../../store/worldStore';

/**
 * The World bar's "file" group (level-editor.md §17): open a world, the open
 * spinner, and save. The install picker and its path readout were removed by
 * §16.28 — asset sources are a list in the project file now, not a button
 * here.
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
