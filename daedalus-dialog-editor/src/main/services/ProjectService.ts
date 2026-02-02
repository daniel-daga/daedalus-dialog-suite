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

// Regex to match start of INSTANCE declarations
// Matches: INSTANCE <name> (C_INFO) {
const INSTANCE_START_REGEX = /INSTANCE\s+(\w+)\s*\(([^)]+)\)\s*\{/gi;

// Regex to match npc property inside the body
const NPC_REGEX = /npc\s*=\s*([^;}\s]+)/gi;

// Regex to detect quest definitions
const TOPIC_REGEX = /const\s+string\s+TOPIC_\w+/i;
const MIS_REGEX = /var\s+int\s+MIS_\w+/i;

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

    // Reset regex state
    INSTANCE_START_REGEX.lastIndex = 0;

    let match;
    while ((match = INSTANCE_START_REGEX.exec(content)) !== null) {
      const instanceName = match[1];
      const parentType = match[2].trim();

      // Only process C_INFO instances (dialogs)
      if (parentType.toUpperCase() === 'C_INFO') {
        let braceCount = 1;
        let currentIndex = INSTANCE_START_REGEX.lastIndex;
        const startIndex = currentIndex;

        // Scan for matching closing brace, handling nested braces
        while (braceCount > 0 && currentIndex < content.length) {
          const char = content[currentIndex];
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
          }
          currentIndex++;
        }

        if (braceCount === 0) {
          // Search for NPC property within the body boundaries
          // We set the regex search position to the start of the body
          NPC_REGEX.lastIndex = startIndex;
          const npcMatch = NPC_REGEX.exec(content);

          // Ensure we found a match AND it is strictly within the body
          // The body ends at (currentIndex - 1), which is the position of '}'
          if (npcMatch && npcMatch.index < currentIndex - 1) {
            const npcId = npcMatch[1].trim();

            metadata.push({
              dialogName: instanceName,
              npc: npcId,
              filePath
            });
          }

          // Update regex search position to resume after this instance
          INSTANCE_START_REGEX.lastIndex = currentIndex;
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
    const questFiles: string[] = [];

    // Process files in parallel batches for better performance
    const BATCH_SIZE = 50;
    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);

      // Serialize CPU-intensive parsing to avoid blocking the event loop
      // We read files in parallel (I/O bound), but parse sequentially (CPU bound) with yields
      let parsingChain = Promise.resolve();

      const results = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const content = await fs.readFile(filePath, 'utf-8');

            // Queue parsing task
            return new Promise<{ dialogs: DialogMetadata[]; isQuestFile: boolean }>((resolve) => {
              const task = async () => {
                // Yield to event loop to allow UI updates/interactivity
                await new Promise<void>((r) => setImmediate(r));
                try {
                  const dialogs = this.extractDialogMetadata(content, filePath);
                  const isQuestFile = TOPIC_REGEX.test(content) || MIS_REGEX.test(content);
                  resolve({ dialogs, isQuestFile });
                } catch {
                  resolve({ dialogs: [], isQuestFile: false });
                }
              };

              // Append to chain, running regardless of previous task success
              parsingChain = parsingChain.then(task, task);
            });
          } catch {
            // Silently skip files that can't be read
            return { dialogs: [], isQuestFile: false };
          }
        })
      );

      // Process results
      for (let j = 0; j < batch.length; j++) {
        const result = results[j];
        const filePath = batch[j];

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
