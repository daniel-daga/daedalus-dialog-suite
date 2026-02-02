/**
 * ProjectService - Gothic mod project scanning and indexing
 *
 * Provides functionality to:
 * - Scan directories recursively for .d files
 * - Extract lightweight metadata from dialog files without full parsing
 * - Build project index with NPCs and their dialogs
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { DialogMetadata, ProjectIndex } from '../../shared/types';

// Re-export types for consumers of this service
export type { DialogMetadata, ProjectIndex } from '../../shared/types';

import { extractDialogMetadata } from '../utils/metadataUtils';
import { MetadataWorkerPool } from './MetadataWorkerPool';
// Regex to match start of INSTANCE declarations
// Matches: INSTANCE <name> (C_INFO) {
const INSTANCE_START_REGEX = /INSTANCE\s+(\w+)\s*\(([^)]+)\)\s*\{/gi;

// Regex to match npc property inside the body
const NPC_REGEX = /npc\s*=\s*([^;}\s]+)/gi;

// Regex to detect quest definitions
const TOPIC_REGEX = /const\s+string\s+TOPIC_\w+/i;
const MIS_REGEX = /var\s+int\s+MIS_\w+/i;
const BRACE_REGEX = /[{}]/g;

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
          } else if (entry.isFile() && entry.name.endsWith('.d')) {
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
   * Extract dialog metadata from file content using regex (lightweight, no full parse)
   *
   * Looks for INSTANCE declarations with C_INFO parent and npc property:
   * INSTANCE DIA_Name (C_INFO) { npc = SLD_12345_Name; ... };
   */
  extractDialogMetadata(content: string, filePath: string): DialogMetadata[] {
    return extractDialogMetadata(content, filePath);
  }

  /**
   * Build complete project index from directory (async)
   */
  async buildProjectIndex(rootPath: string): Promise<ProjectIndex> {
    // Scan for all .d files
    const allFiles = await this.scanDirectory(rootPath);

    // Map to store dialogs by NPC
    const dialogsByNpc = new Map<string, DialogMetadata[]>();
    const questFiles: string[] = [];

    // Use worker pool to process files in parallel
    const pool = new MetadataWorkerPool();

    try {
      const results = await Promise.all(
        allFiles.map(filePath => pool.processFile(filePath))
      );

      // Process results
      for (let i = 0; i < allFiles.length; i++) {
        const result = results[i];
        const filePath = allFiles[i];

        // Group dialogs by NPC
        for (const dialog of result.dialogs) {
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
    const npcs = Array.from(dialogsByNpc.keys()).sort();

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
