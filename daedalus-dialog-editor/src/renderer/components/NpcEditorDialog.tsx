import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
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
  Tab,
  Tabs,
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

// #564, #580: the dialog reads in the order an NPC is worked on — who they
// are, when they are where, how they fight. The form is two tabs: Character
// (identity, combat, and the appearance fields beside the preview they change)
// and Routines, which gets the whole left area for its cards. The preview stays
// beside both, so a switch never costs the view the user framed.
const fieldsOf = (group: NpcFormField['group'], except: readonly string[] = []) =>
  NPC_FORM_FIELDS.filter((field) => field.group === group && !except.includes(field.key));
const IDENTITY_FIELDS = fieldsOf('main', ['dailyRoutine', 'fightTactic']);
const APPEARANCE_FIELDS = [...fieldsOf('visual'), ...fieldsOf('equipment')];
// Gender and the overlay name are short; every other appearance value is an
// asset or item name that needs the column's full width to stay readable.
const SHORT_APPEARANCE = ['gender', 'walkOverlay'];
const APPEARANCE_ROWS: NpcFormField[][] = [
  APPEARANCE_FIELDS.filter((field) => SHORT_APPEARANCE.includes(field.key)),
  ...APPEARANCE_FIELDS.filter((field) => !SHORT_APPEARANCE.includes(field.key)).map((field) => [field]),
];
const COMBAT_ROWS: Array<{ title: string; fields: NpcFormField[]; wide?: boolean }> = [
  { title: 'Tactic', fields: NPC_FORM_FIELDS.filter((field) => field.key === 'fightTactic'), wide: true },
  { title: 'Attributes', fields: fieldsOf('attributes') },
  { title: 'Hit chance', fields: fieldsOf('hitChance') },
  { title: 'Protection', fields: fieldsOf('protection') },
];

const isChanged = (before: NpcFormValues, after: NpcFormValues, key: string) =>
  (before[key] ?? '').trim() !== (after[key] ?? '').trim();

/** An edited field's outline, in the warning colour: it is not saved yet. */
const CHANGED_SX = {
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'warning.main', borderWidth: 2 },
} as const;

/** The declaring file as the project names it, not as the disk does. */
function projectRelative(filePath: string, projectPath: string | null): string {
  const file = filePath.replace(/\\/g, '/');
  const root = projectPath?.replace(/\\/g, '/').replace(/\/$/, '');
  return root && file.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? file.slice(root.length + 1) : file;
}

/** One of the dialog's sections: a heading that names it as a region. */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const id = useId();
  return (
    <Box component="section" aria-labelledby={id} sx={{ mb: 2.5 }}>
      <Typography id={id} variant="subtitle2" sx={{ mb: 0.75 }}>{title}</Typography>
      {children}
    </Box>
  );
};

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
  const [showOther, setShowOther] = useState(false);
  /** Which of the dialog's two tabs is shown. A form value like any other:
   *  it never touches the NPC, so switching cannot lose an edit. */
  const [tab, setTab] = useState<'character' | 'routines'>('character');
  const tabId = useId();
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

  const changedCount = NPC_FORM_FIELDS.filter((field) => isChanged(initial, values, field.key)).length;
  const canSave = !!definition && !invalid && !saving;
  const projectPath = useProjectStore((s) => s.projectPath);
  const subtitle = [
    npcName, values.guild, values.level ? `Level ${values.level}` : '', projectRelative(filePath, projectPath),
  ].filter(Boolean).join(' · ');

  const renderField = (field: NpcFormField) => {
    const value = values[field.key] ?? '';
    const changed = isChanged(initial, values, field.key);
    const mark = { 'data-changed': changed ? 'true' : undefined, sx: changed ? CHANGED_SX : undefined };
    const onChange = (next: string) => setValues((current) => ({ ...current, [field.key]: next }));
    const fieldOptions = field.options && 'assets' in field.options
      ? (field.options.assets === 'headMesh' ? assetSuggestions.headMeshes : assetSuggestions.walkOverlays)
      : options[field.key];
    if (field.options && 'values' in field.options && !('constantPrefix' in field.options)) {
      const choices = [...new Set([...fieldOptions, ...(value && !fieldOptions.includes(value) ? [value] : [])])];
      return (
        <TextField
          key={field.key}
          {...mark}
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
          renderInput={(params) => <TextField {...params} {...mark} label={field.label} />}
        />
      );
    }
    return <TextField key={field.key} {...mark} label={field.label} size="small" value={value} onChange={(e) => onChange(e.target.value)} />;
  };

  const grid = (min: number) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 1 });

  return (
    <Dialog
      open
      onClose={saving ? undefined : onClose}
      maxWidth="xl"
      fullWidth
      aria-labelledby="npc-editor-title"
      onKeyDown={(event) => {
        // Ctrl+S saves the NPC, not the file behind the dialog — the global
        // shortcut listens on window, so the key stops here. A dialog over
        // this one (the routine editor) bubbles through React, not the DOM.
        const isSave = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's';
        if (!isSave || !event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        if (canSave) void handleSave();
      }}
    >
      <DialogTitle id="npc-editor-title" component="div" data-testid="npc-editor-header" sx={{ py: 1.25 }}>
        <Typography component="h2" variant="h6" sx={{ lineHeight: 1.3 }}>{values.name?.trim() || npcName}</Typography>
        <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!definition && !error && <CircularProgress size={24} />}
        {definition && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 340px' }, gap: 3 }}>
            <Box sx={{ minWidth: 0 }}>
              <Tabs
                value={tab}
                onChange={(_event, next: 'character' | 'routines') => setTab(next)}
                aria-label="NPC sections"
                sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, fontSize: 13 } }}
              >
                <Tab value="character" label="Character" id={`${tabId}-character-tab`} aria-controls={`${tabId}-character-panel`} />
                <Tab value="routines" label="Routines" id={`${tabId}-routines-tab`} aria-controls={`${tabId}-routines-panel`} />
              </Tabs>
              <Box
                role="tabpanel"
                id={`${tabId}-character-panel`}
                aria-labelledby={`${tabId}-character-tab`}
                sx={{ pt: 2, display: tab === 'character' ? 'grid' : 'none', gap: 2.5,
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr)' } }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Section title="Identity">
                    <Box sx={grid(170)}>{IDENTITY_FIELDS.map(renderField)}</Box>
                  </Section>
                  <Section title="Combat">
                    <Box sx={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', columnGap: 1.5, rowGap: 1, alignItems: 'center' }}>
                      {COMBAT_ROWS.map((row) => (
                        <React.Fragment key={row.title}>
                          <Typography variant="caption" color="text.secondary">{row.title}</Typography>
                          <Box sx={row.wide ? { display: 'grid', maxWidth: 320 } : grid(96)}>{row.fields.map(renderField)}</Box>
                        </React.Fragment>
                      ))}
                    </Box>
                  </Section>
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Section title="Appearance">
                    <Box sx={{ display: 'grid', gap: 1 }}>
                      {APPEARANCE_ROWS.map((row) => (
                        <Box
                          key={row.map((field) => field.key).join('-')}
                          sx={{ display: 'grid', gap: 1, gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
                        >
                          {row.map(renderField)}
                        </Box>
                      ))}
                    </Box>
                  </Section>
                </Box>
                {uncovered.length > 0 && (
                  <Box sx={{ gridColumn: '1 / -1' }}>
                    <Button
                      size="small"
                      sx={{ px: 0.5, textTransform: 'none' }}
                      aria-expanded={showOther}
                      onClick={() => setShowOther((open) => !open)}
                    >
                      {`${showOther ? '▾' : '▸'} Other statements (${uncovered.length})`}
                    </Button>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      Kept exactly as written; edit them in the script.
                    </Typography>
                    {showOther && (
                      <Box component="pre" sx={{ m: 0, mt: 0.5, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                        {uncovered.map((statement) => statement.text).join('\n')}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
              <Box
                role="tabpanel"
                id={`${tabId}-routines-panel`}
                aria-labelledby={`${tabId}-routines-tab`}
                sx={{ pt: 2, display: tab === 'routines' ? 'block' : 'none' }}
              >
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
              </Box>
            </Box>
            {/* Sticky, so the preview stays in view while the form scrolls. It
                has no scroll of its own: one scrollbar for the dialog body. */}
            <Box
              sx={{
                position: { md: 'sticky' }, top: 0, alignSelf: 'start', order: { xs: -1, md: 0 },
                p: 1.5, borderRadius: 1, bgcolor: 'action.hover',
              }}
            >
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
      <DialogActions sx={{ px: 2 }}>
        <Box sx={{ mr: 'auto', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="caption" color={changedCount > 0 ? 'warning.main' : 'text.secondary'} data-testid="npc-editor-changes">
            {changedCount === 0 ? 'No unsaved changes' : `${changedCount} unsaved change${changedCount === 1 ? '' : 's'}`}
          </Typography>
          {invalid && <Typography variant="caption" color="error">{invalid}</Typography>}
        </Box>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave} title="Save (Ctrl+S)">
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
