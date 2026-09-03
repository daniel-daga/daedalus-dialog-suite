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
  /** The project file's configured `gmbtProjectDir` — the GMBT project folder
   *  a quick test runs from (level-editor.md §16.29). Not an asset source: it
   *  is one path, edited here because this is where the project's paths are
   *  edited, and it never joins the mount list. */
  gmbtProjectDir?: string | null;
  /** Asset folders the detected GMBT project declares that the list does not
   *  have yet (§16.31). Offered by a button, never applied on its own: the
   *  order of this list is the user's, and a mount order is a decision. */
  gmbtAssetSources?: string[];
  projectRoot?: string | null;
  warnings?: ProjectConfigWarning[];
  worldLoaded?: boolean;
  onClose: () => void;
  onSave: (assetSources: string[], gmbtProjectDir: string | null) => Promise<void>;
}

export const AssetSourcesDialog: React.FC<AssetSourcesDialogProps> = ({
  open, assetSources, gmbtProjectDir = null, gmbtAssetSources = [], projectRoot,
  warnings = [], worldLoaded = false, onClose, onSave,
}) => {
  const [draft, setDraft] = useState<string[]>(assetSources);
  const [gmbtDraft, setGmbtDraft] = useState<string | null>(gmbtProjectDir);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(assetSources);
      setGmbtDraft(gmbtProjectDir);
      setError(null);
      setSaving(false);
    }
    wasOpen.current = open;
  }, [open, assetSources, gmbtProjectDir]);

  const changed = useMemo(
    () => draft.length !== assetSources.length
      || draft.some((source, index) => source !== assetSources[index])
      || gmbtDraft !== gmbtProjectDir,
    [draft, assetSources, gmbtDraft, gmbtProjectDir],
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

  const missingFromGmbt = gmbtAssetSources.filter((source) => !draft.includes(source));
  const addFromGmbt = () => setDraft((current) => [
    ...current, ...gmbtAssetSources.filter((source) => !current.includes(source)),
  ]);

  const removeAt = (index: number) => setDraft((current) => current.filter((_, i) => i !== index));
  const move = (index: number, offset: -1 | 1) => setDraft((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const chooseGmbt = async () => {
    try {
      const selected = await window.editorAPI.selectAssetSourceFolder(gmbtDraft ?? projectRoot ?? undefined);
      if (selected) setGmbtDraft(selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not choose a GMBT project folder');
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft, gmbtDraft);
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
          {missingFromGmbt.length > 0 && (
            <Button
              startIcon={<AddIcon />}
              onClick={addFromGmbt}
              disabled={saving}
              aria-label={`Add ${missingFromGmbt.length} folders from GMBT`}
            >
              Add {missingFromGmbt.length} from GMBT
            </Button>
          )}
        </Box>

        {/* The GMBT project folder is not a mount and is deliberately below the
            list, outside it: one path, chosen or cleared, that only the
            quick-test button reads. */}
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2">GMBT project folder</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            The folder holding the <code>.gmbt.yml</code> a quick test runs from. Not an asset
            source — it is never mounted.
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" data-testid="gmbt-project-dir" sx={{ wordBreak: 'break-all', flexGrow: 1 }}>
              {gmbtDraft ?? 'Not set'}
            </Typography>
            <Button size="small" onClick={() => void chooseGmbt()} disabled={saving} aria-label="Choose GMBT project folder">
              Choose…
            </Button>
            <Button size="small" onClick={() => setGmbtDraft(null)} disabled={saving || gmbtDraft === null} aria-label="Clear GMBT project folder">
              Clear
            </Button>
          </Stack>
          {gmbtDraft !== null && warningFor(gmbtDraft) && (
            <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
              <WarningAmberIcon fontSize="inherit" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
              {warningFor(gmbtDraft)?.message}
            </Typography>
          )}
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
