import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import * as historyActions from '../store/historyActions';
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
import { fieldOptions, parsedModels, projectConstantLookup, projectItemCategoryLookup } from '../npc/npcFieldOptions';
import { npcRoutines, variantSwitches } from '../npc/npcRoutines';
import NpcRoutinesSection from './NpcRoutinesSection';
import { useWorldStore } from '../store/worldStore';
import { useUISelectionStore } from '../store/uiSelectionStore';
import {
  waypointJumpReason, resolveNpcSpawnSite, expectedWorldNameFor, worldToOpenFor,
} from './npcWorldJump';
import NpcVisualPreview from './NpcVisualPreview';
import { npcAssetSuggestions } from '../npc/npcAssets';
import type { VfsEntry } from '../../shared/worldTypes';
import NpcRoutineSourceDialog, { type NpcRoutineSourceTarget } from './NpcRoutineSourceDialog';
import RoutineEditorDialog from './RoutineEditor';

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

// #429: the start routine is chosen in the Routines section — create first,
// then pick — because a routine is what makes an NPC spawn. A card marks it
// and offers the others; this field is the fallback for one no card lists.
const DAILY_ROUTINE_FIELD = NPC_FORM_FIELDS.find((field) => field.key === 'dailyRoutine')!;

function findInstanceKey(model: SemanticModel, npcName: string): string | undefined {
  const upper = npcName.toUpperCase();
  return Object.keys(model.instances ?? {}).find((name) => name.toUpperCase() === upper);
}

/** An item instance's source text in the project, by case-insensitive name. */
function projectItemSource(): (instance: string) => string | undefined {
  const sources = new Map<string, string>();
  for (const model of parsedModels()) {
    for (const [name, item] of Object.entries(model.items ?? {})) {
      if (item.sourceText) sources.set(name.toUpperCase(), item.sourceText);
    }
  }
  return (instance) => sources.get(instance.toUpperCase());
}

const NpcEditorDialog: React.FC<NpcEditorDialogProps> = ({ npcName, filePath, onClose }) => {
  const [definition, setDefinition] = useState<NpcDefinition | null>(null);
  /** The body the form was read from. The equipment and overlay edits name a
   *  call by its occurrence in it, and the visual edit rewrites the call whole,
   *  so a body that moved would take them onto other statements. */
  const [readBody, setReadBody] = useState('');
  const [initial, setInitial] = useState<NpcFormValues>({});
  const [values, setValues] = useState<NpcFormValues>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [routineSource, setRoutineSource] = useState<NpcRoutineSourceTarget | null>(null);
  /** The routine the routine editor is open on; '' opens it on its "New routine" form. */
  const [editingRoutine, setEditingRoutine] = useState<string | null>(null);
  const [assetEntries, setAssetEntries] = useState<{ heads: readonly VfsEntry[]; overlays: readonly VfsEntry[] }>({
    heads: [], overlays: [],
  });
  const [previewAssetsReady, setPreviewAssetsReady] = useState(false);
  const [previewAssetsError, setPreviewAssetsError] = useState<string | null>(null);
  const parseGeneration = useProjectStore((s) => s.parseGeneration);
  const categoryOfItem = useMemo(projectItemCategoryLookup, [parseGeneration]);

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
        const read = formValuesFrom(npc, projectItemCategoryLookup());
        setDefinition(npc);
        setReadBody(sourceText);
        setInitial(read);
        setValues(read);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [npcName, filePath]);

  useEffect(() => {
    let current = true;
    setPreviewAssetsReady(false);
    setPreviewAssetsError(null);
    void (async () => {
      try {
        await window.editorAPI.ensureNpcPreviewAssets();
      } catch (failure) {
        if (!current) return;
        setPreviewAssetsError(failure instanceof Error ? failure.message : String(failure));
        return;
      }
      if (!current) return;
      setPreviewAssetsReady(true);
      try {
        const [heads, overlays] = await Promise.all([
          window.editorAPI.searchWorldAssets('HUM_HEAD_'),
          window.editorAPI.searchWorldAssets('HUMANS_'),
        ]);
        if (current) setAssetEntries({ heads: heads.matches, overlays: overlays.matches });
      } catch {
        if (current) setAssetEntries({ heads: [], overlays: [] });
      }
    })();
    return () => { current = false; };
  }, []);
  // #442: male NPCs are not offered the female head meshes — derived rather
  // than refetched, so flipping the gender updates the list at once.
  const assetSuggestions = useMemo(
    () => npcAssetSuggestions(assetEntries.heads, assetEntries.overlays, values.gender),
    [assetEntries, values.gender],
  );
  const uncovered = useMemo(
    () => (definition ? uncoveredStatements(definition, categoryOfItem) : []),
    [definition, categoryOfItem],
  );
  // Subscribed, so a routine saved from the routine editor — which re-indexes
  // its file — shows here without reopening.
  const routineSites = useProjectStore((s) => s.routineSiteIndex);
  const exchangeSites = useProjectStore((s) => s.exchangeSiteIndex);
  const routineLayouts = useProjectStore((s) => s.routineLayoutIndex);
  // The index uppercases a TA name; the wrapper's declaration has its words.
  const activityName = useMemo(() => {
    const spelled = new Map(Object.entries(routineLayouts ?? {}).map(([key, layout]) => [key.toUpperCase(), layout.name ?? key]));
    return (state: string) => spelled.get(state.toUpperCase()) ?? state;
  }, [routineLayouts]);
  const routines = useMemo(() => {
    const project = useProjectStore.getState();
    return npcRoutines({
      sites: routineSites,
      routinesByNpc: project.routineNpcIndex,
      statesByNpc: project.routineStateIndex,
    }, npcName);
  }, [npcName, routineSites]);
  const options = useMemo(() => {
    const byKey: Record<string, string[]> = Object.fromEntries(
      NPC_FORM_FIELDS.map((field) => [field.key, fieldOptions(field)]),
    );
    // #429: a routine created in this dialog is not in the project's
    // routineList until the next index load, and it is the one to pick.
    byKey.dailyRoutine = [...new Set([...byKey.dailyRoutine, ...routines.map((r) => r.routine)])];
    return byKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parseGeneration invalidates fieldOptions' project-store snapshot.
  }, [parseGeneration, routines]);
  // #429: the first routine is the start routine, so it fills the field once
  // it exists — an NPC without one cannot spawn. A value the user cleared
  // stays cleared, which is why this happens once per routine name.
  const autoFilledRoutine = useRef<string | null>(null);
  useEffect(() => {
    const first = routines[0]?.routine;
    if (!first || initial.dailyRoutine || values.dailyRoutine || autoFilledRoutine.current === first) return;
    autoFilledRoutine.current = first;
    setValues((current) => ({ ...current, dailyRoutine: first }));
  }, [routines, initial.dailyRoutine, values.dailyRoutine]);
  const invalid = definition ? validateNpcForm(values) : null;
  // Rebuilt as background ingestion parses more of the project.
  const lookupConstant = useMemo(projectConstantLookup, [parseGeneration]);
  const itemSource = useMemo(projectItemSource, [parseGeneration]);
  const pendingEdits = useMemo(
    () => (definition ? editsBetween(definition, initial, values, categoryOfItem) : []),
    [definition, initial, values, categoryOfItem],
  );

  // #285: a TA entry's waypoint, shown in the World surface. The jump leaves
  // this dialog, which is why an unsaved form blocks it rather than being
  // thrown away. The source jump stays inside the editor and opens the routine
  // file at the indexed TA line in a read-only view.
  const world = useWorldStore((s) => (s.status === 'ready' ? (s.waynetNames ?? null) : null));
  const showWaypoint = (waypoint: string) => {
    useWorldStore.getState().requestFocus({ kind: 'waypoint', name: waypoint });
    useUISelectionStore.getState().setActiveView('world');
    onClose();
  };
  // npc-editor.md §6: the routine in the World surface's routine mode. It
  // needs a world, and never dead-ends for want of one (maintainer, 2026-09-29):
  // the world the NPC's STARTUP_ spawn names is opened, or the picker offered.
  const spawnSites = useProjectStore((s) => s.spawnSiteIndex);
  const openWorldPath = useWorldStore((s) => s.summary?.worldPath ?? null);
  const editRoutineInWorld = (routine: string) => {
    const site = resolveNpcSpawnSite(spawnSites, npcName);
    const inWorld = worldToOpenFor(site ? expectedWorldNameFor(site.functionName) : null, openWorldPath);
    useWorldStore.getState().requestRoutine(inWorld === null ? { npc: npcName, routine } : { npc: npcName, routine, inWorld });
    useUISelectionStore.getState().setActiveView('world');
    onClose();
  };

  const handleSave = async () => {
    if (!definition) return;
    const edits = editsBetween(definition, initial, values, categoryOfItem);
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
      if (instance.sourceText !== readBody) {
        throw new Error(`${npcName} in ${filePath} has changed since the NPC editor read it; reopen it to save these edits`);
      }
      const sourceText = await window.editorAPI.applyNpcEdits(instance.sourceText!, edits);
      const updated = { ...instance, sourceText };
      historyActions.updateModel(filePath, {
        ...model,
        instances: { ...model.instances, [key]: updated },
        ...(model.npcs?.[key] ? { npcs: { ...model.npcs, [key]: updated } } : {}),
      });
      const result = await useEditorStore.getState().saveFile(filePath);
      if (!result.success) {
        const firstError = result.validationResult?.errors?.[0]?.message;
        throw new Error(firstError ? `Save refused: ${firstError}` : 'Save failed');
      }
      // The watcher suppresses the editor's own write, and the routine facts
      // the form changed (`daily_routine`, `id`) come from the index.
      await useProjectStore.getState().reindexFiles([filePath]);
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
    const fieldOptions = field.options && 'assets' in field.options
      ? (field.options.assets === 'headMesh' ? assetSuggestions.headMeshes : assetSuggestions.walkOverlays)
      : options[field.key];
    if (field.options && 'values' in field.options && !('constantPrefix' in field.options)) {
      const choices = [...new Set([...fieldOptions, ...(value && !fieldOptions.includes(value) ? [value] : [])])];
      return (
        <TextField
          key={field.key}
          select
          label={field.label}
          size="small"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <MenuItem value=""><em>Unset</em></MenuItem>
          {choices.map((choice) => <MenuItem key={choice} value={choice}>{choice}</MenuItem>)}
        </TextField>
      );
    }
    if (field.options) {
      const choices = value && !fieldOptions.some((option) => option.toUpperCase() === value.toUpperCase())
        ? [...fieldOptions, value]
        : fieldOptions;
      return (
        <Autocomplete
          key={field.key}
          openOnFocus
          autoHighlight
          size="small"
          options={choices}
          value={value || null}
          onChange={(_e, next) => onChange(next ?? '')}
          renderInput={(params) => <TextField {...params} label={field.label} />}
        />
      );
    }
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
    return <TextField key={field.key} label={field.label} size="small" value={value} onChange={(e) => onChange(e.target.value)} />;
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="xl" fullWidth aria-labelledby="npc-editor-title">
      <DialogTitle id="npc-editor-title" sx={{ py: 1.25 }}>{`NPC ${npcName}`}</DialogTitle>
      <DialogContent dividers sx={{ p: 1.5 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!definition && !error && <CircularProgress size={24} />}
        {definition && (
          // The preview beside the form rather than above it, and sticky, so
          // it stays in view while the visual fields near the bottom change.
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 260px' }, gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              {GROUPS.map((group) => (
                <Box key={group.id} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{group.title}</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1 }}>
                    {NPC_FORM_FIELDS.filter((field) => field.group === group.id && field !== DAILY_ROUTINE_FIELD).map(renderField)}
                  </Box>
                </Box>
              ))}
              <NpcRoutinesSection
                routines={routines}
                startRoutine={values.dailyRoutine ?? ''}
                onSetStart={(routine) => setValues((current) => ({ ...current, dailyRoutine: routine }))}
                startField={renderField(DAILY_ROUTINE_FIELD)}
                switchesOf={(state) => variantSwitches(exchangeSites ?? [], npcName, state)}
                activityName={activityName}
                onShowWaypoint={showWaypoint}
                onShowSource={(routine, sourceFilePath, line) => setRoutineSource({ routine, filePath: sourceFilePath, line })}
                waypointReason={(waypoint) => waypointJumpReason(waypoint, world)}
                blockedReason={pendingEdits.length > 0
                  ? 'Save or cancel your changes first'
                  : null}
                onEditRoutine={setEditingRoutine}
                onCreateRoutine={() => setEditingRoutine('')}
                onEditRoutineInWorld={editRoutineInWorld}
              />
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
            </Box>
            <Box sx={{ position: { md: 'sticky' }, top: 0, alignSelf: 'start', order: { xs: -1, md: 0 } }}>
              <NpcVisualPreview
                definition={definition}
                edits={pendingEdits}
                lookupConstant={lookupConstant}
                itemSource={itemSource}
                weapon={values.meleeWeapon ?? ''}
                assetsReady={previewAssetsReady}
                assetsError={previewAssetsError}
              />
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {invalid && <Typography variant="caption" color="error" sx={{ mr: 'auto', ml: 1 }}>{invalid}</Typography>}
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!definition || !!invalid || saving}>
          Save
        </Button>
      </DialogActions>
      {routineSource && (
        <NpcRoutineSourceDialog target={routineSource} onClose={() => setRoutineSource(null)} />
      )}
      {editingRoutine !== null && (
        <RoutineEditorDialog
          npc={npcName}
          initialRoutine={editingRoutine || undefined}
          startCreating={editingRoutine === ''}
          onClose={() => setEditingRoutine(null)}
        />
      )}
    </Dialog>
  );
};

export default NpcEditorDialog;
