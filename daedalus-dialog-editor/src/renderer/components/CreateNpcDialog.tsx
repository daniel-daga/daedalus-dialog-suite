import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useProjectStore } from '../store/projectStore';
import { handleFileAdded } from '../hooks/useFileWatcher';
import {
  copyEdits,
  defaultNpcFilePath,
  proposeNpcId,
  renameNpcInstance,
  validateNewNpc,
} from '../npc/npcTemplate';

// Create NPC (docs/plans/npc-editor.md §3, #285): a copy of an NPC the project
// already has, written to a new file, then handed to the NPC editor. Copying
// rather than a template of our own is what keeps #141 closed: the copy uses
// only constants, meshes and helpers the mod defines.

interface CreateNpcDialogProps {
  /** Preselected as the NPC to copy, when it can be. */
  initialTemplate: string | null;
  onClose: () => void;
  onCreated: (npc: string) => void;
}

async function readTemplate(npc: string, filePath: string): Promise<string> {
  const model = await useProjectStore.getState().getSemanticModel(filePath);
  const upper = npc.toUpperCase();
  const key = Object.keys(model.instances ?? {}).find((name) => name.toUpperCase() === upper);
  const sourceText = key ? model.instances![key].sourceText : undefined;
  if (!sourceText) throw new Error(`${npc} is not declared in ${filePath}`);
  return sourceText;
}

const CreateNpcDialog: React.FC<CreateNpcDialogProps> = ({ initialTemplate, onClose, onCreated }) => {
  const npcList = useProjectStore((s) => s.npcList);
  const npcFileIndex = useProjectStore((s) => s.npcFileIndex);
  const projectPath = useProjectStore((s) => s.projectPath);
  const addNpcToIndex = useProjectStore((s) => s.addNpcToIndex);

  // Only an NPC with a declaring file can be copied.
  const templates = useMemo(
    () => npcList.filter((npc) => npcFileIndex[npc.toUpperCase()]),
    [npcList, npcFileIndex],
  );
  const [template, setTemplate] = useState(
    initialTemplate && templates.includes(initialTemplate) ? initialTemplate : templates[0] ?? '',
  );
  const [instance, setInstance] = useState('');
  const [name, setName] = useState('');
  const [guild, setGuild] = useState('');
  const [id, setId] = useState(() => String(proposeNpcId(npcList)));
  const [filePath, setFilePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // The guild is offered from the NPC being copied.
  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    (async () => {
      try {
        const source = await readTemplate(template, npcFileIndex[template.toUpperCase()]);
        const npc = await window.editorAPI.extractNpc(source);
        const guildField = npc.statements.find((s) => s.kind === 'field' && s.field.toLowerCase() === 'guild');
        if (!cancelled && guildField?.kind === 'field') setGuild(guildField.value);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [template, npcFileIndex]);

  // Follows the instance name until the user types a path of their own.
  const shownFilePath = filePath ?? defaultNpcFilePath(npcFileIndex, instance || 'NewNpc', projectPath ?? '');

  const handleCreate = async () => {
    const invalid = validateNewNpc({ template, instance, name, guild, id, filePath: shownFilePath }, npcList);
    if (invalid) {
      setError(invalid);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const exists = await window.editorAPI.readFile(shownFilePath).then(() => true, () => false);
      if (exists) throw new Error(`${shownFilePath} already exists.`);
      const source = await readTemplate(template, npcFileIndex[template.toUpperCase()]);
      const copy = await window.editorAPI.applyNpcEdits(
        renameNpcInstance(source, instance),
        copyEdits({ name, guild, id: Number(id) }),
      );
      await window.editorAPI.writeFile(shownFilePath, `${copy}\n`);
      addNpcToIndex(instance, shownFilePath);
      // The watcher suppresses the editor's own writes, so index the file the
      // way it would a dropped-in one — which also writes its EXIT dialog (#141).
      await handleFileAdded(shownFilePath, useProjectStore.getState());
      onCreated(instance);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="create-npc-title">
      <DialogTitle id="create-npc-title">New NPC</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            A copy of an existing NPC, so it uses only what your scripts already define. Its routine is not
            copied; everything else can be edited next.
          </Typography>
          <Autocomplete
            options={templates}
            value={template || null}
            onChange={(_e, value) => setTemplate(value ?? '')}
            disabled={creating}
            renderInput={(params) => <TextField {...params} label="Copy of" size="small" />}
          />
          <TextField
            label="Instance"
            size="small"
            value={instance}
            onChange={(e) => setInstance(e.target.value)}
            disabled={creating}
            helperText="e.g. BAU_950_Harald"
            autoFocus
          />
          <TextField label="Name" size="small" value={name} onChange={(e) => setName(e.target.value)} disabled={creating} />
          <Stack direction="row" spacing={2}>
            <TextField label="Guild" size="small" value={guild} onChange={(e) => setGuild(e.target.value)} disabled={creating} />
            <TextField label="Id" size="small" value={id} onChange={(e) => setId(e.target.value)} disabled={creating} />
          </Stack>
          <TextField
            label="File"
            size="small"
            value={shownFilePath}
            onChange={(e) => setFilePath(e.target.value)}
            disabled={creating}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={creating}>Cancel</Button>
        <Button variant="contained" onClick={() => void handleCreate()} disabled={creating}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateNpcDialog;
