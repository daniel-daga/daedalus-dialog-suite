import React from 'react';
import {
  Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, TextField, Typography,
} from '@mui/material';
import type { SpawnSite } from '../../../shared/types';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { InsertNpcDraft } from './hooks/useInsertNpc';

/** The file name a banner shows for a script path — the whole path is noise
 *  next to a reason. */
const baseName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

export interface InsertNpcDialogProps {
  /** The draft being edited, or null when the dialog is closed. */
  draft: InsertNpcDraft | null;
  /** The world's own waypoint names, as the field's options. */
  waypointNames: readonly string[];
  /** The function the appended line goes in, for the caption to name. */
  startupFunctionName: string;
  /** The typed waypoint is already in the world — see `useInsertNpc`. */
  targetExists: boolean;
  /** The typed instance is in no parsed file — a warning, never a refusal. */
  unknownInstance: boolean;
  /** A spawn the index already holds for this pair, if any. */
  duplicateSpawn: SpawnSite | null;
  /**
   * The ground point a new waypoint would go at, or null when none has been
   * clicked yet — which is what turns the confirm into "Insert on next click".
   */
  terrainPoint: [number, number, number] | null;
  onChange: (fields: Partial<InsertNpcDraft>) => void;
  onCancel: () => void;
  /** Confirmed. `point` is null for a spawn on a waypoint that already exists,
   *  and for one armed against the next terrain click. */
  onConfirm: (
    instance: string, waypoint: string,
    target: { existing: true } | { existing: false; point: [number, number, number] | null },
  ) => void;
}

/**
 * The Insert-NPC dialog (level-editor.md §16.19, slice 16 D), lifted out of
 * `WorldSurface.tsx` with the rest of its concern
 * (`docs/plans/level-editor-review-2026-09-04.md` §4).
 *
 * Presentational: every refusal and warning it draws is decided in
 * `useInsertNpc` and handed in, so the same booleans drive the disabled confirm,
 * the helper text and the warning lines and cannot drift apart.
 */
const InsertNpcDialog: React.FC<InsertNpcDialogProps> = ({
  draft, waypointNames, startupFunctionName, targetExists, unknownInstance,
  duplicateSpawn, terrainPoint, onChange, onCancel, onConfirm,
}) => (
  <Dialog
    open={draft !== null}
    onClose={onCancel}
    maxWidth="xs"
    fullWidth
    data-testid="world-insert-npc-dialog"
  >
    <DialogTitle>Insert NPC</DialogTitle>
    <DialogContent>
      <DialogContentText variant="caption" sx={{ display: 'block', mb: 1.5 }}>
        {/* The one thing this dialog does that no other here does: it
            writes a script. Said up front, with where. */}
        {draft?.existing || targetExists
          ? `A Wld_InsertNpc line is appended to ${startupFunctionName} in the open project.`
          : `The waypoint is appended as a free point ${terrainPoint === null
            ? 'where you next click the ground'
            : `at ${terrainPoint.map((v) => Math.round(v)).join(', ')}`}, `
            + `then a Wld_InsertNpc line is appended to ${startupFunctionName} in the open project.`}
      </DialogContentText>
      <Box data-testid="world-insert-npc-instance" sx={{ mb: 1.5 }}>
        <VariableAutocomplete
          label="NPC instance"
          value={draft?.instance ?? ''}
          onChange={(instance) => onChange({ instance })}
          fullWidth
          allowCreation={false}
          showNavigation={false}
          {...AUTOCOMPLETE_POLICIES.actions.npc}
        />
        {unknownInstance && draft !== null && (
          <Typography
            variant="caption"
            color="warning.main"
            data-testid="world-insert-npc-instance-warning"
            sx={{ display: 'block', mt: 0.25 }}
          >
            {`${draft.instance.trim()} is not an NPC instance this project declares.`}
          </Typography>
        )}
      </Box>
      {/* The world's own names are the options: an existing one means
          "spawn there", a new one means "author it". Opened from a
          waypoint's panel the field is that waypoint and locked. */}
      <Autocomplete
        freeSolo
        fullWidth
        size="small"
        disabled={draft?.existing ?? false}
        options={waypointNames as string[]}
        inputValue={draft?.waypoint ?? ''}
        onInputChange={(_event, waypoint) => onChange({ waypoint })}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Waypoint"
            helperText={draft?.existing
              ? ' '
              : targetExists
                ? 'Already in this world — the NPC spawns there.'
                : 'Not in this world yet — a free point is added for it.'}
            inputProps={{ ...params.inputProps, 'data-testid': 'world-insert-npc-waypoint', spellCheck: false }}
          />
        )}
      />
      {duplicateSpawn !== null && (
        <Typography
          variant="caption"
          color="warning.main"
          data-testid="world-insert-npc-duplicate-warning"
          sx={{ display: 'block' }}
        >
          {`${duplicateSpawn.instance} already spawns at ${duplicateSpawn.spawnPoint} `
            + `(${baseName(duplicateSpawn.filePath)}:${duplicateSpawn.line}).`}
        </Typography>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel}>Cancel</Button>
      <Button
        variant="contained"
        disabled={draft === null || draft.instance.trim() === ''
          || draft.waypoint.trim() === ''}
        onClick={() => {
          if (draft === null) return;
          const instance = draft.instance.trim();
          const waypoint = draft.waypoint.trim();
          onConfirm(instance, waypoint, draft.existing || targetExists
            ? { existing: true }
            : { existing: false, point: terrainPoint });
        }}
        data-testid="world-insert-npc-confirm"
      >
        {duplicateSpawn === null
          ? (draft?.existing || targetExists || terrainPoint !== null ? 'Insert' : 'Insert on next click')
          : 'Insert anyway'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default InsertNpcDialog;
