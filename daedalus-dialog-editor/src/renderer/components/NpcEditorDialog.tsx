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
  MenuItem,
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
  type NpcItemCategoryLookup,
} from '../npc/npcForm';
import { itemCategoriesOf, itemNamesForCategory } from '../npc/npcItemCategories';
import { npcRoutines, formatMinute, type NpcRoutine } from '../npc/npcRoutines';
import { useWorldStore } from '../store/worldStore';
import { useUISelectionStore } from '../store/uiSelectionStore';
import { waypointJumpReason } from './npcWorldJump';
import NpcVisualPreview from './NpcVisualPreview';
import { npcAssetSuggestions, type NpcAssetSuggestions } from '../npc/npcAssets';
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

function findInstanceKey(model: SemanticModel, npcName: string): string | undefined {
  const upper = npcName.toUpperCase();
  return Object.keys(model.instances ?? {}).find((name) => name.toUpperCase() === upper);
}

function optionsFor(field: NpcFormField): string[] {
  const { options } = field;
  if (!options) return [];
  if ('assets' in options) return [];
  if ('values' in options && !('constantPrefix' in options)) return options.values;
  if ('itemCategory' in options) {
    const names = itemNamesForCategory(parsedModels(), options.itemCategory, projectConstantLookup());
    return options.itemCategory === 'armor' ? ['NO_ARMOR', ...names] : names;
  }
  const project = useProjectStore.getState();
  if ('routines' in options) return project.routineList;
  if ('npcField' in options) return npcFieldValues(options.npcField);
  const names = 'constantPrefix' in options
    ? parsedModels().flatMap((model) => Object.keys(model.constants ?? {}))
    : parsedModels().flatMap((model) => Object.keys(model.items ?? {}));
  const prefix = ('constantPrefix' in options ? options.constantPrefix : options.itemPrefix).toUpperCase();
  const matched = names.filter((name) => name.toUpperCase().startsWith(prefix));
  const additional = 'constantPrefix' in options ? options.values ?? [] : [];
  return [...new Set([...matched, ...additional])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Values used by project NPCs, such as their numeric voice bank IDs. */
function npcFieldValues(field: string): string[] {
  const values = new Set<string>();
  for (const model of parsedModels()) {
    for (const npc of Object.values(model.npcs ?? {})) {
      const expression = new RegExp(`\\b${field}\\s*=\\s*([^;\\r\\n]+)`, 'i').exec(npc.sourceText ?? '')?.[1]?.trim();
      if (expression) values.add(expression);
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Every ingested file's semantic model — the whole project, where
 *  `mergedSemanticModel` holds only the globals and the selected NPC's files. */
function parsedModels(): SemanticModel[] {
  return [...useProjectStore.getState().parsedFiles.values()].map((file) => file.semanticModel);
}

/** An integer constant's value in the project, by case-insensitive name. */
function projectConstantLookup(): (name: string) => number | undefined {
  const values = new Map<string, number>();
  for (const model of parsedModels()) {
    for (const [name, constant] of Object.entries(model.constants ?? {})) {
      const value = Number(constant.value);
      if (typeof constant.value !== 'boolean' && Number.isInteger(value)) values.set(name.toUpperCase(), value);
    }
  }
  return (name) => values.get(name.toUpperCase());
}

/** A project item instance name to its parsed mainflag category. */
function projectItemCategoryLookup(): NpcItemCategoryLookup {
  const categories = itemCategoriesOf(parsedModels(), projectConstantLookup());
  return (instance) => categories.get(instance.toUpperCase());
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

/** Read-only: the project index's routines for the NPC, as of the last
 *  project load or reindex. */
interface NpcRoutinesSectionProps {
  routines: NpcRoutine[];
  /** Go to a TA entry's waypoint in the World surface (#285). */
  onShowWaypoint?: (waypoint: string) => void;
  /** Read the routine source file at an indexed TA call (#285). */
  onShowSource?: (routine: string, filePath: string, line: number) => void;
  /** Why a waypoint cannot be shown — the insert-NPC jump's answers. */
  waypointReason?: (waypoint: string) => string | null;
  /** Why neither jump may leave the editor now, e.g. unsaved changes. */
  blockedReason?: string | null;
  /** Open the routine editor on this routine (npc-editor.md §6). */
  onEditRoutine?: (routine: string) => void;
  /** Open the routine editor to create the NPC's first routine (#316). */
  onCreateRoutine?: () => void;
  /** Open this routine in the World surface's routine mode instead. */
  onEditRoutineInWorld?: (routine: string) => void;
  /** Why routine mode cannot be opened now, e.g. no world is open. */
  worldReason?: string | null;
}

/** A jump button that says why it is off, rather than just being off. */
const JumpButton: React.FC<{ label: string; reason: string | null; onClick: () => void; children: React.ReactNode }> = (
  { label, reason, onClick, children },
) => (
  <span title={reason ?? label}>
    <Button size="small" sx={{ minWidth: 0, py: 0, fontSize: 11 }} aria-label={label} disabled={reason !== null} onClick={onClick}>
      {children}
    </Button>
  </span>
);

export const NpcRoutinesSection: React.FC<NpcRoutinesSectionProps> = (
  {
    routines, onShowWaypoint, onShowSource, waypointReason, blockedReason = null, onEditRoutine,
    onEditRoutineInWorld, worldReason = null, onCreateRoutine,
  },
) => (
  <Box sx={{ mb: 2 }}>
    <Typography variant="subtitle2">Routines</Typography>
    {routines.length === 0 && (
      <Typography variant="caption" color="text.secondary">
        No routine in the project index.
        {onCreateRoutine && (
          <Button size="small" sx={{ py: 0, ml: 1, fontSize: 11 }} onClick={onCreateRoutine}>Create routine</Button>
        )}
      </Typography>
    )}
    {routines.map(({ label, routine, entries }) => (
      <Box key={routine} component="ul" aria-label={`${label}: ${routine}`} sx={{ m: 0, mt: 0.5, pl: 0, listStyle: 'none' }}>
        <Typography component="li" variant="body2" sx={{ fontWeight: 500 }}>
          {`${label}: ${routine}`}
          {onEditRoutine && (
            <Button
              size="small"
              sx={{ minWidth: 0, py: 0, ml: 1, fontSize: 11 }}
              aria-label={`Edit routine ${routine}`}
              onClick={() => onEditRoutine(routine)}
            >
              Edit
            </Button>
          )}
          {onEditRoutineInWorld && (
            <JumpButton
              label={`Edit routine ${routine} in the world`}
              reason={blockedReason ?? worldReason}
              onClick={() => onEditRoutineInWorld(routine)}
            >
              In world
            </JumpButton>
          )}
        </Typography>
        {entries.length === 0 && (
          <Typography component="li" variant="caption" color="text.secondary">No TA entries indexed</Typography>
        )}
        {entries.map((entry) => (
          <Box component="li" key={`${entry.startMinute}-${entry.waypoint}`} sx={{ display: 'flex', gap: 2, fontSize: 12 }}>
            {entry.stateName && <span>{entry.stateName}</span>}
            <span>{`${formatMinute(entry.startMinute)}–${formatMinute(entry.endMinute)}`}</span>
            <span>{entry.waypoint}</span>
            {onShowWaypoint && (
              <JumpButton
                label={`Show ${entry.waypoint} in the world`}
                reason={blockedReason ?? waypointReason?.(entry.waypoint) ?? null}
                onClick={() => onShowWaypoint(entry.waypoint)}
              >
                World
              </JumpButton>
            )}
            {onShowSource && (
              <Button
                size="small"
                sx={{ minWidth: 0, py: 0, fontSize: 11 }}
                aria-label={`Show source for ${routine} at line ${entry.line}`}
                onClick={() => onShowSource(routine, entry.filePath, entry.line)}
              >
                Source
              </Button>
            )}
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
  const [routineSource, setRoutineSource] = useState<NpcRoutineSourceTarget | null>(null);
  const [editingRoutine, setEditingRoutine] = useState<string | null>(null);
  const [assetSuggestions, setAssetSuggestions] = useState<NpcAssetSuggestions>({ headMeshes: [], walkOverlays: [] });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parseGeneration invalidates optionsFor's project-store snapshot.
    [parseGeneration],
  );
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
        if (current) setAssetSuggestions(npcAssetSuggestions(heads.matches, overlays.matches));
      } catch {
        if (current) setAssetSuggestions({ headMeshes: [], walkOverlays: [] });
      }
    })();
    return () => { current = false; };
  }, []);
  const uncovered = useMemo(
    () => (definition ? uncoveredStatements(definition, categoryOfItem) : []),
    [definition, categoryOfItem],
  );
  // Subscribed, so a routine saved from the routine editor — which re-indexes
  // its file — shows here without reopening.
  const routineSites = useProjectStore((s) => s.routineSiteIndex);
  const routines = useMemo(() => {
    const project = useProjectStore.getState();
    return npcRoutines({
      sites: routineSites,
      routinesByNpc: project.routineNpcIndex,
      statesByNpc: project.routineStateIndex,
    }, npcName);
  }, [npcName, routineSites]);
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
  // npc-editor.md §6: the routine in the World surface's routine mode, which
  // needs a world open to draw on and pick waypoints from.
  const worldOpen = useWorldStore((s) => s.status === 'ready');
  const editRoutineInWorld = (routine: string) => {
    useWorldStore.getState().requestRoutine({ npc: npcName, routine });
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
                    {NPC_FORM_FIELDS.filter((field) => field.group === group.id).map(renderField)}
                  </Box>
                </Box>
              ))}
              <NpcRoutinesSection
                routines={routines}
                onShowWaypoint={showWaypoint}
                onShowSource={(routine, sourceFilePath, line) => setRoutineSource({ routine, filePath: sourceFilePath, line })}
                waypointReason={(waypoint) => waypointJumpReason(waypoint, world)}
                blockedReason={pendingEdits.length > 0
                  ? 'Save or cancel your changes first'
                  : null}
                onEditRoutine={setEditingRoutine}
                onCreateRoutine={() => setEditingRoutine('')}
                onEditRoutineInWorld={editRoutineInWorld}
                worldReason={worldOpen ? null : 'Open a world in the World view first'}
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
          onClose={() => setEditingRoutine(null)}
        />
      )}
    </Dialog>
  );
};

export default NpcEditorDialog;
