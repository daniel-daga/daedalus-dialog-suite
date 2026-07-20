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
import type { DialogMetadata, ProjectIndex } from '../../shared/types';

// Re-export types for consumers of this service
export type { DialogMetadata, ProjectIndex } from '../../shared/types';

import { extractFileMetadataFromSource } from '../utils/semanticMetadataUtils';
import { MetadataWorkerPool } from './MetadataWorkerPool';
import type { MetadataResult } from './MetadataWorkerPool';

function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase();
}

class ProjectService {
  /**
   * Recursively scan directory for .d files (async)
   */
  async scanDirectory(rootPath: string): Promise<string[]> {
    const files: string[] = [];

    const scanRecursive = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        const promises: Promise<void>[] = [];

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            promises.push(scanRecursive(fullPath));
          } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.d') {
            files.push(fullPath);
          }
        }

        await Promise.all(promises);
      } catch {
        // Silently skip directories that can't be read (permissions, etc.)
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
    // Scan for all .d files
    const allFiles = await this.scanDirectory(rootPath);

    // Map to store dialogs by NPC
    const dialogsByNpc = new Map<string, DialogMetadata[]>();
    const allNpcs = new Set<string>();
    const questFiles: string[] = [];
    const allRoutines = new Set<string>();
    const voiceIds: Record<string, Array<{ filePath: string; functionName: string }>> = {};
    const metadataFailures: Array<{ filePath: string; error: string }> = [];
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
      pool.terminate();
    }

    // Extract and sort NPC list
    const npcs = Array.from(allNpcs).sort();

    return {
      npcs,
      dialogsByNpc,
      allFiles,
      questFiles,
      routines: Array.from(allRoutines).sort(),
      npcPrototypes,
      voiceIds,
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
