import { useCallback, useMemo, useState } from 'react';
import { addWaypoint, type WorldOp } from 'zen-world';
import type { SpawnSite } from '../../../../shared/types';
import type { WaynetPayload } from '../../../../shared/worldTypes';
import { useWorldStore } from '../../../store/worldStore';
import { useProjectStore } from '../../../store/projectStore';
import { hasUnsavedChanges, useFileStore } from '../../../store/fileStore';
import { appendInsertNpc, findFunctionFile, startupFunctionFor } from '../insertNpcScript';

/** The file name a banner shows for a script path — the whole path is noise
 *  next to a reason. */
const baseName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

/**
 * The Insert-NPC dialog's draft: the instance being typed and the waypoint the
 * spawn names. `existing` is the waypoint panel's variant — the point is already
 * in the world, so the name is fixed and no `AddWaypoint` precedes the script
 * write.
 */
export interface InsertNpcDraft {
  instance: string;
  waypoint: string;
  existing: boolean;
}

export interface InsertNpcInput {
  /** The drawn waynet, or null while the overlay has never been switched on. */
  waynet: WaynetPayload | null;
  commitOps: (ops: WorldOp[]) => Promise<boolean>;
}

export interface InsertNpc {
  /** The open dialog's draft, or null when it is closed. */
  draft: InsertNpcDraft | null;
  /** Open on a point the world already has — the waypoint panel's variant. */
  openAtWaypoint: (waypoint: string) => void;
  /** Open on a waypoint to be authored, with `waypoint` as the suggested name. */
  openForNewWaypoint: (suggested: string) => void;
  /** Type into the open draft. A no-op once it is closed. */
  editDraft: (fields: Partial<InsertNpcDraft>) => void;
  closeDraft: () => void;
  /**
   * Spawn `instance` at `spawnPoint`, authoring the waypoint first unless
   * `existing`. `point` is where a new waypoint goes and is null for an
   * existing one.
   */
  insertNpcAt: (
    instance: string, spawnPoint: string, existing: boolean,
    point: [number, number, number] | null,
  ) => Promise<void>;
  /** The function a spawn in the open world belongs in, and `''` with no world. */
  startupFunctionName: string;
  /**
   * Whether the typed waypoint is one the world already has — then the NPC
   * spawns there and no waypoint is authored. Not a clash: the name field
   * offers the world's own names for exactly this.
   */
  targetExists: boolean;
  /**
   * The typed instance is not one the project index declares — a warning, not
   * a refusal: an empty index means "nothing is known", never "nothing is
   * legal", and an instance declared in a file the index has not parsed is
   * legal too. Case-insensitive, since Daedalus is.
   */
  unknownInstance: boolean;
  /**
   * The site the index already holds for this instance on this point, if any —
   * keyed uppercase, the index's own casing. A warning that wants an explicit
   * confirm, not a refusal: retail spawns the same NPC on a point more than
   * once (chapter re-entry).
   */
  duplicateSpawn: SpawnSite | null;
}

/**
 * Spawn an NPC at a waypoint by writing `Wld_InsertNpc` into the open project's
 * `STARTUP_<world>` (level-editor.md §16.19, slice 16 D and E) — the one edit
 * in this surface that reaches a file the surface is not editing, and therefore
 * the one with a refusal ladder rather than a single `commitOps`.
 *
 * Lifted out of `WorldSurface.tsx` — `docs/plans/level-editor-review-2026-09-04.md`
 * §4 names "Insert-NPC and its dialog" as one of the nine concerns. The dialog
 * itself is `InsertNpcDialog.tsx`; what is here is the draft it edits, the four
 * things derived from that draft, and the write.
 */
export function useInsertNpc({ waynet, commitOps }: InsertNpcInput): InsertNpc {
  const [draft, setDraft] = useState<InsertNpcDraft | null>(null);
  /**
   * The two project-index reads this concern makes. Subscribed here rather than
   * handed in, because nothing else in the surface reads `npcList` and the
   * spawn index is read here for a different question than the spawn overlay
   * asks it.
   */
  const npcList = useProjectStore((state) => state.npcList);
  const spawnSiteIndex = useProjectStore((state) => state.spawnSiteIndex);
  /** The path, not the summary: the function name is derived from the file name,
   *  so a refreshed index after a structural op must not recompute it. */
  const worldPath = useWorldStore((state) => state.summary?.worldPath ?? null);

  const openAtWaypoint = useCallback((waypoint: string) => {
    setDraft({ instance: '', waypoint, existing: true });
  }, []);

  const openForNewWaypoint = useCallback((suggested: string) => {
    setDraft({ instance: '', waypoint: suggested, existing: false });
  }, []);

  const editDraft = useCallback((fields: Partial<InsertNpcDraft>) => {
    setDraft((was) => (was === null ? was : { ...was, ...fields }));
  }, []);

  const closeDraft = useCallback(() => setDraft(null), []);

  /**
   * Waypoint op first, script second: a spawn naming a point the world has
   * not got is the worse half-state. The op goes through `commitOps`, so a
   * refusal there is already on the banner and the script is left alone; a
   * refusal *after* it says the waypoint stands.
   *
   * The refusals before anything is written are the renderer's, because main
   * holds no picture of the project (slice A's resolver) and none of which
   * files the dialog editor has open (E). A `Startup.d` open and dirty is
   * refused rather than merged: the flow's mtime guard compares against its
   * own read, so the editor's stale model would save straight over the spawn.
   * Open and clean, it is reloaded the way an external change is. The cached
   * model in `parsedFiles` gets slice A's edit — the renderer's picture of the
   * one line C spliced — so a reader of the function's actions is not one
   * spawn behind and no parse round trip is spent on it.
   */
  const insertNpcAt = useCallback(async (
    instance: string, spawnPoint: string, existing: boolean, point: [number, number, number] | null,
  ) => {
    const { editFailed, summary: current } = useWorldStore.getState();
    if (current === null) return;
    const functionName = startupFunctionFor(current.worldPath);
    const found = findFunctionFile(useProjectStore.getState().parsedFiles, functionName);
    if (!found.ok) {
      const { refusal } = found;
      editFailed(refusal.kind === 'no-project'
        ? 'No script project is open — Wld_InsertNpc needs a STARTUP_<world> function to go in.'
        : refusal.kind === 'no-startup-function'
          ? `No file in the project declares ${refusal.functionName}.`
          : `${baseName(refusal.filePath)} has syntax errors; fix them before a spawn is appended.`);
      return;
    }
    const { filePath } = found;
    const open = useFileStore.getState().openFiles.get(filePath);
    if (open !== undefined && hasUnsavedChanges(open)) {
      editFailed(`${baseName(filePath)} is open in the dialog editor with unsaved changes — save or discard them first.`);
      return;
    }

    if (!existing) {
      if (waynet === null || point === null) return;
      if (!await commitOps([addWaypoint(waynet.names, spawnPoint, point)])) return;
    }

    const half = existing ? '' : `Waypoint ${spawnPoint} was added, but `;
    let result;
    try {
      result = await window.editorAPI.appendInsertNpc(filePath, found.functionName, instance, spawnPoint);
    } catch (failure) {
      editFailed(half + (failure instanceof Error ? failure.message : String(failure)));
      return;
    }
    if (!result.ok) {
      const { reason } = result;
      editFailed(half + (reason.kind === 'parse-errors'
        ? `${baseName(filePath)} has syntax errors on disk: ${reason.errors.join('; ')}`
        : reason.kind === 'function-not-found'
          ? `${reason.functionName} is not in ${baseName(filePath)} on disk.`
          : `${baseName(filePath)} changed on disk while the spawn was being appended — nothing was written.`));
      return;
    }

    const project = useProjectStore.getState();
    project.addSpawnSite({
      instance: instance.toUpperCase(), spawnPoint: spawnPoint.toUpperCase(),
      filePath, functionName: found.functionName, line: result.line,
    });
    project.updateFileModel(filePath, appendInsertNpc(found.model, found.functionName, instance, spawnPoint));
    if (open !== undefined) await useFileStore.getState().reloadFile(filePath);
  }, [commitOps, waynet]);

  const duplicateSpawn = useMemo(() => {
    if (draft === null) return null;
    const instance = draft.instance.trim().toUpperCase();
    const spawnPoint = draft.waypoint.trim().toUpperCase();
    if (instance === '' || spawnPoint === '') return null;
    return spawnSiteIndex.find((site) => site.instance === instance && site.spawnPoint === spawnPoint) ?? null;
  }, [draft, spawnSiteIndex]);

  return {
    draft,
    openAtWaypoint,
    openForNewWaypoint,
    editDraft,
    closeDraft,
    insertNpcAt,
    startupFunctionName: worldPath === null ? '' : startupFunctionFor(worldPath),
    targetExists: draft !== null && !draft.existing
      && (waynet?.names.includes(draft.waypoint.trim()) ?? false),
    unknownInstance: draft !== null && npcList.length > 0
      && draft.instance.trim() !== ''
      && !npcList.some((npc) => npc.toUpperCase() === draft.instance.trim().toUpperCase()),
    duplicateSpawn,
  };
}
