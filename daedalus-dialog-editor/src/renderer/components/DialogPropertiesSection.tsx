import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  IconButton,
  Tooltip,
  Chip,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  Link as LinkIcon,
  LinkOff as LinkOffIcon
} from '@mui/icons-material';
import VariableAutocomplete from './common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from './common/autocompletePolicies';
import type { Dialog, SemanticModel } from '../types/global';
import { dialogFlagKey, readDialogFlag } from '../utils/dialogFlags';
import { isDescriptionConstant, isDescriptionInSync, withDescription } from './descriptionSync';

interface DialogPropertiesSectionProps {
  dialog: Dialog;
  semanticModel?: SemanticModel;
  propertiesExpanded: boolean;
  onToggleExpanded: () => void;
  onDialogPropertyChange: (updater: (dialog: Dialog) => Dialog) => void;
  /** Text of the information function's first dialog line, which the description follows (#277). */
  firstLineText?: string;
}

const DialogPropertiesSection: React.FC<DialogPropertiesSectionProps> = ({
  dialog,
  semanticModel,
  propertiesExpanded,
  onToggleExpanded,
  onDialogPropertyChange,
  firstLineText = ''
}) => {
  const storedDescription = dialog.properties?.description || '';
  const storedIsConstant = isDescriptionConstant(dialog);
  const [localDescription, setLocalDescription] = useState(storedDescription);
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  // The mode only says which editor shows; the kind is written with a value.
  const [constantMode, setConstantMode] = useState(storedIsConstant);

  useEffect(() => {
    setLocalDescription(storedDescription);
    setDescriptionEdited(false);
  }, [storedDescription]);

  useEffect(() => {
    setConstantMode(storedIsConstant);
  }, [dialog.name, storedIsConstant]);

  const handleNpcChange = useCallback((value: string) => onDialogPropertyChange((existingDialog) => ({
    ...existingDialog,
    properties: { ...existingDialog.properties, npc: value }
  })), [onDialogPropertyChange]);

  const descriptionInSync = isDescriptionInSync(dialog, firstLineText);

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          mb: propertiesExpanded ? 2 : 0
        }}
        onClick={onToggleExpanded}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6">Properties</Typography>
          {!propertiesExpanded && (
            <>
              {dialog.properties?.npc && (
                <Chip
                  label={`NPC: ${dialog.properties.npc}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{ fontSize: '0.75rem' }}
                />
              )}
              {dialog.properties?.description && (
                <Chip
                  label={dialog.properties.description}
                  size="small"
                  color="default"
                  sx={{ fontSize: '0.75rem', maxWidth: '400px' }}
                />
              )}
            </>
          )}
        </Box>
        <Tooltip title={propertiesExpanded ? 'Collapse properties' : 'Expand properties'}>
          <IconButton
            size="small"
            aria-label={propertiesExpanded ? 'Collapse properties' : 'Expand properties'}
            aria-expanded={propertiesExpanded}
          >
            {propertiesExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      {propertiesExpanded && (
        <Stack spacing={2}>
          <VariableAutocomplete
            fullWidth
            label="NPC"
            value={dialog.properties?.npc || ''}
            onChange={handleNpcChange}
            {...AUTOCOMPLETE_POLICIES.dialogProperties.npc}
            semanticModel={semanticModel}
          />
          <TextField
            fullWidth
            label="Number (Priority)"
            type="number"
            value={dialog.properties?.nr || ''}
            onChange={(event) => onDialogPropertyChange((existingDialog) => ({
              ...existingDialog,
              properties: { ...existingDialog.properties, nr: parseInt(event.target.value, 10) || 0 }
            }))}
            size="small"
          />
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Description kind"
              value={constantMode ? 'constant' : 'text'}
              onChange={(_event, mode: 'text' | 'constant' | null) => {
                if (mode) setConstantMode(mode === 'constant');
              }}
            >
              <ToggleButton value="text">Text</ToggleButton>
              <ToggleButton value="constant">Constant</ToggleButton>
            </ToggleButtonGroup>
            {constantMode ? (
              <VariableAutocomplete
                fullWidth
                label="Description constant"
                value={storedIsConstant ? storedDescription : ''}
                onChange={(value) => {
                  // An empty constant would write `description = ;`.
                  if (value) onDialogPropertyChange((existingDialog) => withDescription(existingDialog, value, true));
                }}
                {...AUTOCOMPLETE_POLICIES.dialogProperties.description}
                semanticModel={semanticModel}
              />
            ) : (
              <TextField
                fullWidth
                label="Description"
                value={localDescription}
                onChange={(event) => {
                  setLocalDescription(event.target.value);
                  setDescriptionEdited(true);
                }}
                onBlur={() => {
                  if (descriptionEdited) {
                    onDialogPropertyChange((existingDialog) => withDescription(existingDialog, localDescription, false));
                  }
                }}
                multiline
                rows={2}
                size="small"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      {descriptionInSync ? (
                        <Tooltip title="Follows the first line of the dialog">
                          <LinkIcon fontSize="small" color="action" aria-label="In sync with the first line" />
                        </Tooltip>
                      ) : (
                        <Tooltip title="Differs from the first line of the dialog — click to sync it again">
                          <IconButton
                            size="small"
                            aria-label="Sync with the first line"
                            onClick={() => onDialogPropertyChange((existingDialog) => withDescription(existingDialog, firstLineText, false))}
                          >
                            <LinkOffIcon fontSize="small" color="warning" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </InputAdornment>
                  )
                }}
              />
            )}
          </Stack>
          <Stack direction="row" spacing={2}>
            <FormControlLabel
              control={(
                <Checkbox
                  size="small"
                  checked={readDialogFlag(dialog.properties ?? {}, 'important')}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    onDialogPropertyChange((existingDialog) => ({
                      ...existingDialog,
                      properties: { ...existingDialog.properties, [dialogFlagKey(existingDialog.properties, 'important')]: checked }
                    }));
                  }}
                />
              )}
              label="Important"
            />
            <FormControlLabel
              control={(
                <Checkbox
                  size="small"
                  checked={readDialogFlag(dialog.properties ?? {}, 'permanent')}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    onDialogPropertyChange((existingDialog) => ({
                      ...existingDialog,
                      properties: { ...existingDialog.properties, [dialogFlagKey(existingDialog.properties, 'permanent')]: checked }
                    }));
                  }}
                />
              )}
              label="Permanent"
            />
          </Stack>
        </Stack>
      )}
    </Paper>
  );
};

export default DialogPropertiesSection;
