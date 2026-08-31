import React from 'react';
import {
  IconButton, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import ExploreIcon from '@mui/icons-material/Explore';
import RedoIcon from '@mui/icons-material/Redo';
import UndoIcon from '@mui/icons-material/Undo';
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom';
import type { GizmoMode } from '../WorldViewport';

/** What a move drag can be quantised to. **ZenGin centimetres** — every
 *  position in this app is in them, so a metre is 100 and the labels say
 *  which is which. */
const GRID_STEPS = [
  { value: 0, label: 'Free' },
  { value: 10, label: '10 cm' },
  { value: 50, label: '50 cm' },
  { value: 100, label: '1 m' },
  { value: 500, label: '5 m' },
];

/** And a turn drag, in degrees — converted to radians on the way to the
 *  gizmo, which is what it turns in. */
const ANGLE_STEPS = [0, 5, 15, 45, 90].map((degrees) => ({
  value: degrees, label: degrees === 0 ? 'Free' : `${degrees}°`,
}));

/**
 * The World bar's "edit" group (level-editor-ui-improvements.md slice 5):
 * the gizmo mode toggle, its snap step, drop/align, duplicate, delete, and
 * undo/redo. Moved verbatim out of `WorldSurface.tsx` — every testid and
 * enablement rule is unchanged, only the state and handlers now arrive as
 * props. The snap step's gizmo-mode branch stays in `WorldSurface`,
 * collapsed into one `onSnapStepChange` callback.
 */
export interface WorldEditControlsProps {
  hasWorld: boolean;
  gizmoMode: GizmoMode;
  onGizmoModeChange: (mode: GizmoMode) => void;
  snapGrid: number;
  snapAngleDegrees: number;
  onSnapStepChange: (step: number) => void;
  selectionCount: number;
  onDropToGround: () => void;
  onAlignToNormal: () => void;
  onDuplicate: () => void;
  onDeleteRequest: () => void;
  historyDepth: { undo: number; redo: number };
  onUndo: () => void;
  onRedo: () => void;
}

const WorldEditControls: React.FC<WorldEditControlsProps> = ({
  hasWorld, gizmoMode, onGizmoModeChange, snapGrid, snapAngleDegrees, onSnapStepChange,
  selectionCount, onDropToGround, onAlignToNormal, onDuplicate, onDeleteRequest,
  historyDepth, onUndo, onRedo,
}) => (
  <>
    {/* Two modes, not three: a VOB has no scale to gizmo. Text labels stay —
        these are the two most-used controls in the bar — and each is also
        wrapped in its own Tooltip rather than sharing one on the group, so
        hovering either button names only the shortcut it stands for. A
        Tooltip directly wrapping a ToggleButton (rather than the whole
        group) is what keeps the group's own value/onChange plumbing
        intact. */}
    {hasWorld && (
      <ToggleButtonGroup
        size="small"
        exclusive
        value={gizmoMode}
        onChange={(_event, next: GizmoMode | null) => next !== null && onGizmoModeChange(next)}
        sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, fontSize: 12 } }}
      >
        <Tooltip title="Move (W)">
          <ToggleButton value="translate" data-testid="world-gizmo-translate">Move (W)</ToggleButton>
        </Tooltip>
        <Tooltip title="Turn (E)">
          <ToggleButton value="rotate" data-testid="world-gizmo-rotate">Turn (E)</ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>
    )}
    {/* The step the gizmo drags in, and it follows the mode rather than
        being two controls: one of them is always meaningless, and the
        steps for a distance and for an angle share nothing but the word.
        Both values are kept, so a detour through the other mode does not
        reset the one you set. */}
    {hasWorld && (
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          select
          size="small"
          value={gizmoMode === 'rotate' ? snapAngleDegrees : snapGrid}
          onChange={(event) => onSnapStepChange(Number(event.target.value))}
          aria-label="Snap step"
          sx={{ width: 88, '& .MuiInputBase-input': { py: 0.5, fontSize: 12 } }}
          data-testid="world-snap"
        >
          {(gizmoMode === 'rotate' ? ANGLE_STEPS : GRID_STEPS).map((step) => (
            <MenuItem key={step.value} value={step.value} sx={{ fontSize: 12 }}>
              {step.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    )}
    {/* Snapping's per-VOB half (level-editor.md §16.5) — unlike the gizmo,
        which drives the whole selection from one shared delta, each of
        these finds its own ground point or its own normal, so they act on
        the selection whatever its size. Secondary actions: icon-only, the
        label moved into the tooltip/aria-label rather than dropped. */}
    {hasWorld && (
      <Stack direction="row" spacing={0.5}>
        <Tooltip title="Drop to ground">
          <span>
            <IconButton
              size="small"
              disabled={selectionCount === 0}
              onClick={onDropToGround}
              data-testid="world-drop-to-ground"
              aria-label="Drop to ground"
            >
              <VerticalAlignBottomIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Align to normal">
          <span>
            <IconButton
              size="small"
              disabled={selectionCount === 0}
              onClick={onAlignToNormal}
              data-testid="world-align-to-normal"
              aria-label="Align to normal"
            >
              <ExploreIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    )}
    {/* The whole selection: an append moves no index path, so the copies
        share one batch and one undo (D4). The count survives the icon
        conversion in the tooltip/aria-label, which is where "how many"
        already had to be said once VOBs became indistinguishable text. */}
    {hasWorld && (
      <Tooltip title={selectionCount > 1 ? `Duplicate ${selectionCount} VOBs` : 'Duplicate VOB'}>
        <span>
          <IconButton
            size="small"
            disabled={selectionCount === 0}
            onClick={onDuplicate}
            data-testid="world-duplicate-vob"
            aria-label={selectionCount > 1 ? `Duplicate ${selectionCount} VOBs` : 'Duplicate VOB'}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    )}
    {/* The one destructive edit in the surface, and the only one behind a
        confirm. Exactly one VOB, never a selection: it renumbers, so each
        would need its own batch, and a button that removed only the
        primary of five is the surprise the dialog exists to prevent. The
        tooltip carries the Delete-key shortcut (slice 1) beside the label. */}
    {hasWorld && (
      <Tooltip title="Delete VOB… (Del)">
        <span>
          <IconButton
            size="small"
            color="error"
            disabled={selectionCount !== 1}
            onClick={onDeleteRequest}
            data-testid="world-delete-vob"
            aria-label="Delete VOB"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    )}
    {/* The main process is the authority on whether there is anything to
        do (§7) — these read `historyDepth`, never a local guess, and a
        click drives the very path Ctrl+Z does. */}
    {hasWorld && (
      <Stack direction="row" spacing={0.5}>
        <Tooltip title="Undo (Ctrl+Z)">
          <span>
            <IconButton
              size="small"
              disabled={historyDepth.undo === 0}
              onClick={onUndo}
              data-testid="world-undo"
              aria-label="Undo"
            >
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Redo (Ctrl+Y)">
          <span>
            <IconButton
              size="small"
              disabled={historyDepth.redo === 0}
              onClick={onRedo}
              data-testid="world-redo"
              aria-label="Redo"
            >
              <RedoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    )}
  </>
);

export default WorldEditControls;
