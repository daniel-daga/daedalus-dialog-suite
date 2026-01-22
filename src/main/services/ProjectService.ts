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
    const metadata: DialogMetadata[] = [];

    // Regex to match INSTANCE declarations
    // Matches: INSTANCE <name> (C_INFO) { ... npc = <npcId>; ... };
    const instanceRegex = /INSTANCE\s+(\w+)\s*\(([^)]+)\)\s*\{([^}]+)\}/gi;

    let match;
    while ((match = instanceRegex.exec(content)) !== null) {
      const instanceName = match[1];
      const parentType = match[2].trim();
      const body = match[3];

      // Only process C_INFO instances (dialogs)
      if (parentType.toUpperCase() === 'C_INFO') {
        // Extract npc property
        const npcMatch = body.match(/npc\s*=\s*([^;}\s]+)/i);

        if (npcMatch) {
          const npcId = npcMatch[1].trim();

          metadata.push({
            dialogName: instanceName,
            npc: npcId,
            filePath
          });
        }
      }
    }

    return metadata;
  }

  /**
   * Build complete project index from directory (async)
   */
  async buildProjectIndex(rootPath: string): Promise<ProjectIndex> {
    // Scan for all .d files
    const allFiles = await this.scanDirectory(rootPath);

    // Map to store dialogs by NPC
    const dialogsByNpc = new Map<string, DialogMetadata[]>();

    // Process files in parallel batches for better performance
    const BATCH_SIZE = 50;
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            return this.extractDialogMetadata(content, filePath);
          } catch {
            // Silently skip files that can't be read
            return [];
          }
        })
      );

      // Group dialogs by NPC
      for (const dialogs of results) {
        for (const dialog of dialogs) {
          if (!dialogsByNpc.has(dialog.npc)) {
            dialogsByNpc.set(dialog.npc, []);
          }
          dialogsByNpc.get(dialog.npc)!.push(dialog);
        }
      }
    }

    // Extract and sort NPC list
    const npcs = Array.from(dialogsByNpc.keys()).sort();

    return {
      npcs,
      dialogsByNpc,
      allFiles
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
