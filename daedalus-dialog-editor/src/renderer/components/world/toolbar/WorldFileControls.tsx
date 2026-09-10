import React from 'react';
import { Badge, Button, CircularProgress, IconButton, Tooltip } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import type { WorldStatus } from '../../../store/worldStore';

/**
 * The World bar's "file" group (level-editor.md §17): open a world, save,
 * and the GMBT quick test. Open keeps its text — it is the one thing a new
 * user has to find before anything else works — and carries its own spinner
 * in place of the icon while opening, so the group never changes width. The
 * other two are icon buttons: the label lives in the tooltip and the
 * accessible name. The install picker and its path readout were removed by
 * §16.28 — asset sources are a list in the project file now, not a button
 * here.
 */
export interface WorldFileControlsProps {
  onOpenWorld: () => void;
  status: WorldStatus;
  hasWorld: boolean;
  onSave: () => void;
  /** Whether the world holds an edit the file on disk does not. The Save button
   *  says so with a dot and a colour: nothing else on screen did, and "have I
   *  saved this?" is not a question to leave unanswered over somebody's retail
   *  install. */
  unsavedEdits: boolean;
  /** Whether the project names a GMBT project folder that resolves (§16.29).
   *  Unset is the ordinary case, not an error: the quick test is disabled with
   *  a tooltip naming the field, never an error on click. */
  gmbtConfigured: boolean;
  onQuickTest: () => void;
}

const WorldFileControls: React.FC<WorldFileControlsProps> = ({
  onOpenWorld, status, hasWorld, onSave, unsavedEdits, gmbtConfigured, onQuickTest,
}) => (
  <>
    <Button
      size="small"
      variant="contained"
      onClick={onOpenWorld}
      disabled={status === 'opening'}
      startIcon={status === 'opening'
        ? <CircularProgress size={14} color="inherit" />
        : <FolderOpenIcon fontSize="small" />}
      data-testid="world-open"
      sx={{ whiteSpace: 'nowrap' }}
    >
      Open world
    </Button>
    {/* Always rendered — disabled rather than unmounted, so the file group
        does not resize when a world opens or closes. */}
    <Tooltip title={unsavedEdits ? 'Save world — it has unsaved edits (Ctrl+S)' : 'Save world (Ctrl+S)'}>
      <span>
        <IconButton
          size="small"
          color={unsavedEdits ? 'warning' : 'default'}
          disabled={!hasWorld}
          onClick={onSave}
          data-testid="world-save"
          aria-label={unsavedEdits ? 'Save world — edited' : 'Save world'}
        >
          <Badge variant="dot" color="warning" invisible={!unsavedEdits} overlap="circular">
            <SaveIcon fontSize="small" />
          </Badge>
        </IconButton>
      </span>
    </Tooltip>
    <Tooltip
      title={gmbtConfigured
        ? 'Quick test — start a GMBT test run with this world'
        : 'Quick test — set a GMBT project folder in Asset sources first'}
    >
      {/* A disabled button fires no events, so the tooltip needs a wrapper to
          hang on — which is the whole point here: the unconfigured case has to
          say what to set. */}
      <span>
        <IconButton
          size="small"
          disabled={!hasWorld || !gmbtConfigured}
          onClick={onQuickTest}
          data-testid="world-gmbt-test"
          aria-label="Quick test"
        >
          <PlayArrowIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  </>
);

export default WorldFileControls;
