/**
 * ProjectService - Gothic mod project scanning and indexing
 *
 * Provides functionality to:
 * - Scan directories recursively for .d files
 * - Extract semantic metadata from dialog files
 * - Build project index with NPCs and their dialogs
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { DialogMetadata, ProjectIndex, SemanticModel } from '../../shared/types';

// Re-export types for consumers of this service
export type { DialogMetadata, ProjectIndex } from '../../shared/types';

import {
  extractFileMetadataFromSource,
  extractExchangeSites,
  extractRoutineSites,
  extractRoutineStatesByNpc,
  extractRoutinesByNpc,
  extractSpawnSites,
  extractWaypointSites
} from '../utils/semanticMetadataUtils';
import { MetadataWorkerPool } from './MetadataWorkerPool';
import type { MetadataResult } from './MetadataWorkerPool';
import { LruMap } from '../utils/lruMap';

function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase();
}

// Upper bound on models held between the index pass and the renderer's
// background ingestion. Beyond it the oldest primed entries are dropped and
// those files simply re-parse on demand (bounded memory beats a second parse
// for every file, which is what the cap trades against).
const MAX_PRIMED_MODELS = 512;

class ProjectService {
  /**
   * Hand-off cache for the P0 double-parse fix: the index pass's metadata
   * workers already build a full semantic model per file, so buildProjectIndex
   * primes it here keyed on path+mtime and the project:parseDialogFile IPC
   * handler serves it via takeParsedModel instead of parsing a second time.
   * Entries are served at most once (take semantics) so the main process does
   * not duplicate the renderer's model cache at steady state.
   */
  private primedModels = new LruMap<string, { mtimeMs: number; model: SemanticModel }>(MAX_PRIMED_MODELS);

  primeParsedModel(filePath: string, mtimeMs: number, model: SemanticModel): void {
    if (!model || model.hasErrors) return;
    this.primedModels.set(filePath, { mtimeMs, model });
  }

  /**
   * Remove and return the primed model for a file, but only when the on-disk
   * mtime still matches the one captured at parse time; any external change
   * since the index pass makes this return undefined (fall back to a parse).
   */
  async takeParsedModel(filePath: string): Promise<SemanticModel | undefined> {
    const entry = this.primedModels.get(filePath);
    if (!entry) return undefined;
    this.primedModels.delete(filePath);
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs !== entry.mtimeMs) return undefined;
    } catch {
      return undefined;
    }
    return entry.model;
  }
  /**
   * Recursively scan directory for .d files (async).
   *
   * Junctions and symlinks are followed (a mod's script tree is often a
   * junction into the game install); a link back into an ancestor is cut by
   * the visited set. A subdirectory that cannot be read is logged and skipped
   * so one bad folder does not hide the rest of the project; the root itself
   * failing is the caller's error.
   */
  async scanDirectory(rootPath: string): Promise<string[]> {
    const files: string[] = [];
    const visited = new Set<string>();

    const isDotD = (name: string) => path.extname(name).toLowerCase() === '.d';

    const scanRecursive = async (dir: string): Promise<void> => {
      const realDir = await fs.realpath(dir);
      if (visited.has(realDir)) return;
      visited.add(realDir);

      const entries = await fs.readdir(dir, { withFileTypes: true });
      const promises: Promise<void>[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isSymbolicLink()) {
          promises.push(scanLink(fullPath));
        } else if (entry.isDirectory()) {
          promises.push(scanSubdirectory(fullPath));
        } else if (entry.isFile() && isDotD(entry.name)) {
          files.push(fullPath);
        }
      }

      await Promise.all(promises);
    };

    const scanSubdirectory = async (dir: string): Promise<void> => {
      try {
        await scanRecursive(dir);
      } catch (error) {
        console.warn(`[ProjectService] skipping unreadable directory ${dir}:`, error);
      }
    };

    const scanLink = async (linkPath: string): Promise<void> => {
      let stat;
      try {
        stat = await fs.stat(linkPath);
      } catch {
        return; // dangling link
      }
      if (stat.isDirectory()) {
        await scanSubdirectory(linkPath);
      } else if (stat.isFile() && isDotD(linkPath)) {
        files.push(linkPath);
      }
    };

    await scanRecursive(rootPath);
    return files;
  }

  /**
   * Extract dialog metadata from file content using semantic parser output.
   */
  extractDialogMetadata(content: string, filePath: string): DialogMetadata[] {
    return extractFileMetadataFromSource(content, filePath).dialogs;
  }

  /**
   * Build complete project index from directory (async)
   */
  async buildProjectIndex(rootPath: string): Promise<ProjectIndex> {
    // A reindex invalidates every previously primed model.
    this.primedModels.clear();

    // Scan for all .d files
    const allFiles = await this.scanDirectory(rootPath);

    // Map to store dialogs by NPC
    const dialogsByNpc = new Map<string, DialogMetadata[]>();
    const allNpcs = new Set<string>();
    const questFiles: string[] = [];
    const allRoutines = new Set<string>();
    const voiceIds: Record<string, Array<{ filePath: string; functionName: string }>> = {};
    const metadataFailures: Array<{ filePath: string; error: string }> = [];
    const fileModelsForSiteIndexes: Array<{ filePath: string; semanticModel: SemanticModel }> = [];
    let npcPrototypes: string[] = [];

    // Use worker pool to process files in parallel
    const pool = new MetadataWorkerPool();

    try {
      // Per-file failures resolve (they do not abort the index build); collect
      // them into metadataFailures and treat the file as empty metadata so the
      // NPC/dialog groupings continue past the failure.
      const results: MetadataResult[] = (await Promise.all(
        allFiles.map(filePath => pool.processFile(filePath))
      )).map((result) => {
        if ('ok' in result) {
          metadataFailures.push({ filePath: result.filePath, error: result.error });
          return { dialogs: [], instances: [], prototypes: [], isQuestFile: false, routines: [], voiceIds: [] };
        }
        return result;
      });

      const parentByType = new Map<string, string>();
      results.forEach((result) => {
        result.prototypes.forEach((prototype) => {
          parentByType.set(normalizeIdentifier(prototype.name), prototype.parent);
        });
      });

      const isNpcParent = (parentName: string): boolean => {
        const visited = new Set<string>();
        let currentParent = parentName;

        while (currentParent) {
          const normalizedParent = normalizeIdentifier(currentParent);
          if (normalizedParent === 'C_NPC') {
            return true;
          }
          if (visited.has(normalizedParent)) {
            return false;
          }

          visited.add(normalizedParent);
          currentParent = parentByType.get(normalizedParent) || '';
        }

        return false;
      };

      npcPrototypes = Array.from(parentByType.keys())
        .filter((prototypeName) => isNpcParent(prototypeName))
        .sort();

      // Process results
      for (let i = 0; i < allFiles.length; i++) {
        const result = results[i];
        const filePath = allFiles[i];

        // Persist the model the metadata pass already built so background
        // ingestion is a cache read instead of a second parse.
        if (result.semanticModel && result.mtimeMs !== undefined) {
          this.primeParsedModel(filePath, result.mtimeMs, result.semanticModel);
        }
        if (result.semanticModel) {
          fileModelsForSiteIndexes.push({ filePath, semanticModel: result.semanticModel });
        }

        // Track NPC instances from dialogs and prototype inheritance chains.
        result.instances.forEach((instance) => {
          if (!isNpcParent(instance.parent)) {
            return;
          }

          allNpcs.add(instance.name);
          if (!dialogsByNpc.has(instance.name)) {
            dialogsByNpc.set(instance.name, []);
          }
        });

        // Group dialogs by NPC
        for (const dialog of result.dialogs) {
          allNpcs.add(dialog.npc);
          if (!dialogsByNpc.has(dialog.npc)) {
            dialogsByNpc.set(dialog.npc, []);
          }
          dialogsByNpc.get(dialog.npc)!.push(dialog);
        }

        // Collect quest files
        if (result.isQuestFile) {
          questFiles.push(filePath);
        }

        // Collect routine names
        for (const routine of result.routines || []) {
          allRoutines.add(routine);
        }

        // Aggregate AI_Output voice ids, keyed case-insensitively (Daedalus is
        // case-insensitive); entries keep the original casing.
        for (const voiceId of result.voiceIds || []) {
          const key = voiceId.id.toUpperCase();
          if (!voiceIds[key]) {
            voiceIds[key] = [];
          }
          voiceIds[key].push({ filePath, functionName: voiceId.functionName });
        }
      }
    } finally {
      await pool.terminate();
    }

    // Extract and sort NPC list
    const npcs = Array.from(allNpcs).sort();
    const routineSites = extractRoutineSites(fileModelsForSiteIndexes);

    return {
      npcs,
      dialogsByNpc,
      allFiles,
      questFiles,
      routines: Array.from(allRoutines).sort(),
      npcPrototypes,
      voiceIds,
      waypointSites: extractWaypointSites(fileModelsForSiteIndexes),
      spawnSites: extractSpawnSites(fileModelsForSiteIndexes),
      routineSites,
      routinesByNpc: extractRoutinesByNpc(fileModelsForSiteIndexes),
      // The state index reuses the sites above rather than recomputing them:
      // extractRoutineSites runs the wrapper fixed-point sweep over every
      // function of every file, and once a load is enough.
      routineStatesByNpc: extractRoutineStatesByNpc(fileModelsForSiteIndexes, routineSites),
      exchangeSites: extractExchangeSites(fileModelsForSiteIndexes),
      metadataFailures
    };
  }

  /**
   * Get all dialogs for a specific NPC
   */
  getDialogsForNpc(index: ProjectIndex, npcId: string): DialogMetadata[] {
    return index.dialogsByNpc.get(npcId) || [];
  }
}

export default ProjectService;
