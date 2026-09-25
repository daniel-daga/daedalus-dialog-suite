import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { NpcDefinition, SemanticModel } from '../types/global';
import {
  NPC_FORM_FIELDS,
  editsBetween,
  formValuesFrom,
  uncoveredStatements,
  validateNpcForm,
  type NpcFormField,
  type NpcFormValues,
} from '../npc/npcForm';
import { npcRoutines, formatMinute, type NpcRoutine } from '../npc/npcRoutines';

// The NPC editor (docs/plans/npc-editor.md, Phase 2): a form over one NPC
// instance's body. It opens the declaring file through the file store — so
// the save is the ordinary save, with its conflict and validation handling —
// and changes only the instance's `sourceText`, which the parser's writer
// patches statement by statement.

interface NpcEditorDialogProps {
  npcName: string;
  filePath: string;
  onClose: () => void;
}

const GROUPS: Array<{ id: NpcFormField['group']; title: string }> = [
  { id: 'main', title: 'Main' },
  { id: 'attributes', title: 'Attributes' },
  { id: 'hitChance', title: 'Hit chance' },
  { id: 'protection', title: 'Protection' },
  { id: 'visual', title: 'Visual (B_SetNpcVisual)' },
  { id: 'equipment', title: 'Equipment (EquipItem)' },
];

function findInstanceKey(model: SemanticModel, npcName: string): string | undefined {
  const upper = npcName.toUpperCase();
  return Object.keys(model.instances ?? {}).find((name) => name.toUpperCase() === upper);
}

function optionsFor(field: NpcFormField): string[] {
  const { options } = field;
  if (!options) return [];
  if ('values' in options) return options.values;
  const project = useProjectStore.getState();
  if ('routines' in options) return project.routineList;
  const names = 'constantPrefix' in options
    ? Object.keys(project.mergedSemanticModel.constants ?? {})
    : Object.keys(project.mergedSemanticModel.items ?? {});
  const prefix = ('constantPrefix' in options ? options.constantPrefix : options.itemPrefix).toUpperCase();
  return names.filter((name) => name.toUpperCase().startsWith(prefix)).sort();
}

/** Read-only: the project index's routines for the NPC, as of the last
 *  project load or reindex. */
export const NpcRoutinesSection: React.FC<{ routines: NpcRoutine[] }> = ({ routines }) => (
  <Box sx={{ mb: 2 }}>
    <Typography variant="subtitle2">Routines</Typography>
    {routines.length === 0 && (
      <Typography variant="caption" color="text.secondary">No routine in the project index.</Typography>
    )}
    {routines.map(({ label, routine, entries }) => (
      <Box key={routine} component="ul" aria-label={`${label}: ${routine}`} sx={{ m: 0, mt: 0.5, pl: 0, listStyle: 'none' }}>
        <Typography component="li" variant="body2" sx={{ fontWeight: 500 }}>{`${label}: ${routine}`}</Typography>
        {entries.length === 0 && (
          <Typography component="li" variant="caption" color="text.secondary">No TA entries indexed</Typography>
        )}
        {entries.map((entry) => (
          <Box component="li" key={`${entry.startMinute}-${entry.waypoint}`} sx={{ display: 'flex', gap: 2, fontSize: 12 }}>
            <span>{`${formatMinute(entry.startMinute)}–${formatMinute(entry.endMinute)}`}</span>
            <span>{entry.waypoint}</span>
          </Box>
        ))}
      </Box>
    ))}
  </Box>
);

const NpcEditorDialog: React.FC<NpcEditorDialogProps> = ({ npcName, filePath, onClose }) => {
  const [definition, setDefinition] = useState<NpcDefinition | null>(null);
  const [initial, setInitial] = useState<NpcFormValues>({});
  const [values, setValues] = useState<NpcFormValues>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = useEditorStore.getState();
        if (!store.getFileState(filePath)) {
          // Opening makes the file active; the NPC editor is a dialog over
          // whatever the main view shows, so that stays active.
          const previouslyActive = store.activeFile;
          await store.openFile(filePath);
          if (previouslyActive) useEditorStore.getState().setActiveFile(previouslyActive);
        }
        const model = useEditorStore.getState().getFileState(filePath)?.semanticModel;
        const key = model ? findInstanceKey(model, npcName) : undefined;
        const sourceText = key ? model!.instances![key].sourceText : undefined;
        if (!sourceText) {
          throw new Error(`${npcName} is not declared in ${filePath}`);
        }
        const npc = await window.editorAPI.extractNpc(sourceText);
        if (cancelled) return;
        const read = formValuesFrom(npc);
        setDefinition(npc);
        setInitial(read);
        setValues(read);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [npcName, filePath]);

  const options = useMemo(
    () => Object.fromEntries(NPC_FORM_FIELDS.map((field) => [field.key, optionsFor(field)])),
    [],
  );
  const uncovered = useMemo(() => (definition ? uncoveredStatements(definition) : []), [definition]);
  const routines = useMemo(() => {
    const project = useProjectStore.getState();
    return npcRoutines({
      sites: project.routineSiteIndex,
      routinesByNpc: project.routineNpcIndex,
      statesByNpc: project.routineStateIndex,
    }, npcName);
  }, [npcName]);
  const invalid = definition ? validateNpcForm(values) : null;

  const handleSave = async () => {
    if (!definition) return;
    const edits = editsBetween(definition, initial, values);
    if (edits.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const store = useEditorStore.getState();
      const model = store.getFileState(filePath)?.semanticModel;
      const key = model ? findInstanceKey(model, npcName) : undefined;
      if (!model || !key) throw new Error(`${npcName} is no longer in ${filePath}`);
      const instance = model.instances![key];
      const sourceText = await window.editorAPI.applyNpcEdits(instance.sourceText!, edits);
      const updated = { ...instance, sourceText };
      store.updateModel(filePath, {
        ...model,
        instances: { ...model.instances, [key]: updated },
        ...(model.npcs?.[key] ? { npcs: { ...model.npcs, [key]: updated } } : {}),
      });
      const result = await useEditorStore.getState().saveFile(filePath);
      if (!result.success) {
        const firstError = result.validationResult?.errors?.[0]?.message;
        throw new Error(firstError ? `Save refused: ${firstError}` : 'Save failed');
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: NpcFormField) => {
    const value = values[field.key] ?? '';
    const onChange = (next: string) => setValues((current) => ({ ...current, [field.key]: next }));
    const fieldOptions = options[field.key];
    if (fieldOptions.length === 0) {
      return (
        <TextField
          key={field.key}
          label={field.label}
          size="small"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    return (
      <Autocomplete
        key={field.key}
        freeSolo
        size="small"
        options={fieldOptions}
        inputValue={value}
        onInputChange={(_e, next) => onChange(next)}
        renderInput={(params) => <TextField {...params} label={field.label} />}
      />
    );
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="npc-editor-title">
      <DialogTitle id="npc-editor-title">{`NPC ${npcName}`}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!definition && !error && <CircularProgress size={24} />}
        {definition && (
          <>
            {GROUPS.map((group) => (
              <Box key={group.id} sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>{group.title}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1.5 }}>
                  {NPC_FORM_FIELDS.filter((field) => field.group === group.id).map(renderField)}
                </Box>
              </Box>
            ))}
            <NpcRoutinesSection routines={routines} />
            {uncovered.length > 0 && (
              <Box>
                <Typography variant="subtitle2">Other statements</Typography>
                <Typography variant="caption" color="text.secondary">
                  Kept exactly as written; edit them in the script.
                </Typography>
                <Box component="pre" sx={{ m: 0, mt: 0.5, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {uncovered.map((statement) => statement.text).join('\n')}
                </Box>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {invalid && <Typography variant="caption" color="error" sx={{ mr: 'auto', ml: 1 }}>{invalid}</Typography>}
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!definition || !!invalid || saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NpcEditorDialog;
