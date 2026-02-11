import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  IconButton,
  Tooltip,
  Chip
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon
} from '@mui/icons-material';
import VariableAutocomplete from './common/VariableAutocomplete';
import type { Dialog, SemanticModel } from '../types/global';

interface DialogPropertiesSectionProps {
  dialog: Dialog;
  semanticModel?: SemanticModel;
  propertiesExpanded: boolean;
  onToggleExpanded: () => void;
  onDialogPropertyChange: (updater: (dialog: Dialog) => Dialog) => void;
}

const DialogPropertiesSection: React.FC<DialogPropertiesSectionProps> = ({
  dialog,
  semanticModel,
  propertiesExpanded,
  onToggleExpanded,
  onDialogPropertyChange
}) => {
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
          <IconButton size="small" aria-label={propertiesExpanded ? 'Collapse properties' : 'Expand properties'}>
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
            onChange={(value) => onDialogPropertyChange((existingDialog) => ({
              ...existingDialog,
              properties: { ...existingDialog.properties, npc: value }
            }))}
            showInstances
            typeFilter="C_NPC"
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
          <VariableAutocomplete
            fullWidth
            label="Description"
            value={dialog.properties?.description || ''}
            onChange={(value) => onDialogPropertyChange((existingDialog) => ({
              ...existingDialog,
              properties: { ...existingDialog.properties, description: value }
            }))}
            typeFilter="string"
            namePrefix="DIALOG_"
            textFieldProps={{
              multiline: true,
              rows: 2
            }}
            semanticModel={semanticModel}
          />
        </Stack>
      )}
    </Paper>
  );
};

export default DialogPropertiesSection;
