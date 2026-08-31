import React from 'react';
import { Button, CircularProgress, Typography } from '@mui/material';
import type { WorldStatus } from '../../../store/worldStore';

/**
 * The World bar's "file" group (level-editor-ui-improvements.md slice 5):
 * choose/open the Gothic install, the path readout, the open spinner, and
 * save. Moved verbatim out of `WorldSurface.tsx` — every testid and
 * enablement rule is unchanged, only the state and handlers now arrive as
 * props.
 */
export interface WorldFileControlsProps {
  gothicInstall: string | null;
  onChooseInstall: () => void;
  onOpenWorld: () => void;
  status: WorldStatus;
  hasWorld: boolean;
  onSave: () => void;
}

const WorldFileControls: React.FC<WorldFileControlsProps> = ({
  gothicInstall, onChooseInstall, onOpenWorld, status, hasWorld, onSave,
}) => (
  <>
    <Button size="small" variant="outlined" onClick={onChooseInstall} data-testid="world-choose-install">
      {gothicInstall ? 'Change Gothic install' : 'Select Gothic install'}
    </Button>
    <Button
      size="small"
      variant="contained"
      onClick={onOpenWorld}
      disabled={status === 'opening'}
      data-testid="world-open"
    >
      Open world
    </Button>
    {gothicInstall && (
      <Typography variant="caption" color="text.secondary" data-testid="world-install-path">
        {gothicInstall}
      </Typography>
    )}
    {status === 'opening' && <CircularProgress size={16} />}
    {hasWorld && (
      <Button size="small" variant="outlined" onClick={onSave} data-testid="world-save">
        Save world…
      </Button>
    )}
  </>
);

export default WorldFileControls;
