import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, List, ListItem, ListItemText, Stack, Tooltip, Typography,
} from '@mui/material';
import {
  Add as AddIcon, ArrowDownward as ArrowDownwardIcon, ArrowUpward as ArrowUpwardIcon,
  Delete as DeleteIcon, WarningAmber as WarningAmberIcon,
} from '@mui/icons-material';
import type { ProjectConfigWarning } from '../../shared/projectConfigTypes';

export interface AssetSourcesDialogProps {
  open: boolean;
  assetSources: string[];
  projectRoot?: string | null;
  warnings?: ProjectConfigWarning[];
  worldLoaded?: boolean;
  onClose: () => void;
  onSave: (assetSources: string[]) => Promise<void>;
}

export const AssetSourcesDialog: React.FC<AssetSourcesDialogProps> = ({
  open, assetSources, projectRoot, warnings = [], worldLoaded = false, onClose, onSave,
}) => {
  const [draft, setDraft] = useState<string[]>(assetSources);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(assetSources);
      setError(null);
      setSaving(false);
    }
    wasOpen.current = open;
  }, [open, assetSources]);

  const changed = useMemo(
    () => draft.length !== assetSources.length || draft.some((source, index) => source !== assetSources[index]),
    [draft, assetSources],
  );

  const warningFor = (source: string) => warnings.find((warning) => warning.source === source);

  const addSource = async () => {
    try {
      const selected = await window.editorAPI.selectAssetSourceFolder(projectRoot ?? undefined);
      if (selected && !draft.includes(selected)) setDraft((current) => [...current, selected]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not choose an asset source');
    }
  };

  const removeAt = (index: number) => setDraft((current) => current.filter((_, i) => i !== index));
  const move = (index: number, offset: -1 | 1) => setDraft((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save asset sources');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      fullWidth
      maxWidth="sm"
      aria-labelledby="asset-sources-title"
    >
      <DialogTitle id="asset-sources-title">Asset sources</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Sources are applied in order; later sources override earlier sources.
        </Typography>
        {worldLoaded && (
          <Alert severity="info" sx={{ mb: 1 }}>
            Reopen the world to apply changes to its asset sources.
          </Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        <List aria-label="Configured asset sources">
          {draft.map((source, index) => {
            const warning = warningFor(source);
            const isRoot = source === '.';
            return (
              <ListItem
                key={`${source}-${index}`}
                divider
                secondaryAction={(
                  <Stack direction="row" spacing={0.25}>
                    <Tooltip title="Move up">
                      <span><IconButton aria-label={`Move ${source} up`} onClick={() => move(index, -1)} disabled={index === 0 || saving} size="small"><ArrowUpwardIcon /></IconButton></span>
                    </Tooltip>
                    <Tooltip title="Move down">
                      <span><IconButton aria-label={`Move ${source} down`} onClick={() => move(index, 1)} disabled={index === draft.length - 1 || saving} size="small"><ArrowDownwardIcon /></IconButton></span>
                    </Tooltip>
                    <Tooltip title={isRoot ? 'The project root is required' : 'Remove source'}>
                      <span><IconButton aria-label={`Remove source ${source}`} onClick={() => removeAt(index)} disabled={isRoot || saving} size="small"><DeleteIcon /></IconButton></span>
                    </Tooltip>
                  </Stack>
                )}
              >
                <ListItemText
                  primary={<span>{index + 1}. {source}</span>}
                  secondary={warning ? <span><WarningAmberIcon fontSize="inherit" sx={{ verticalAlign: 'middle', mr: 0.5 }} />{warning.message}</span> : undefined}
                />
              </ListItem>
            );
          })}
        </List>
        <Box sx={{ mt: 1 }}>
          <Button startIcon={<AddIcon />} onClick={() => void addSource()} disabled={saving} aria-label="Add asset source">
            Add source
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={() => void save()} disabled={!changed || saving} aria-label="Save asset sources">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AssetSourcesDialog;
