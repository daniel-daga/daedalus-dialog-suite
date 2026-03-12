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

    // Use worker pool to process files in parallel
    const pool = new MetadataWorkerPool();

    try {
      const results = await Promise.all(
        allFiles.map(filePath => pool.processFile(filePath))
      );

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
      questFiles
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
