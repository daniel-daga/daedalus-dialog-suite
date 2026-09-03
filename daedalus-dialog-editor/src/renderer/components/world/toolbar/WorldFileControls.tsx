import React from 'react';
import { Button, CircularProgress, Tooltip } from '@mui/material';
import type { WorldStatus } from '../../../store/worldStore';

/**
 * The World bar's "file" group (level-editor.md §17): open a world, the open
 * spinner, save, and the GMBT quick test. The install picker and its path
 * readout were removed by §16.28 — asset sources are a list in the project
 * file now, not a button here.
 */
export interface WorldFileControlsProps {
  onOpenWorld: () => void;
  status: WorldStatus;
  hasWorld: boolean;
  onSave: () => void;
  /** Whether the project names a GMBT project folder that resolves (§16.29).
   *  Unset is the ordinary case, not an error: the quick test is disabled with
   *  a tooltip naming the field, never an error on click. */
  gmbtConfigured: boolean;
  onQuickTest: () => void;
}

const WorldFileControls: React.FC<WorldFileControlsProps> = ({
  onOpenWorld, status, hasWorld, onSave, gmbtConfigured, onQuickTest,
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
    <Tooltip
      title={gmbtConfigured
        ? 'Start a GMBT test run with this world'
        : 'Set a GMBT project folder in Asset sources to run a quick test'}
    >
      {/* A disabled button fires no events, so the tooltip needs a wrapper to
          hang on — which is the whole point here: the unconfigured case has to
          say what to set. */}
      <span>
        <Button
          size="small"
          variant="outlined"
          disabled={!hasWorld || !gmbtConfigured}
          onClick={onQuickTest}
          data-testid="world-gmbt-test"
        >
          Quick test
        </Button>
      </span>
    </Tooltip>
  </>
);

export default WorldFileControls;
