/**
 * ProjectService - Gothic mod project scanning and indexing
 *
 * Provides functionality to:
 * - Scan directories recursively for .d files
 * - Extract lightweight metadata from dialog files without full parsing
 * - Build project index with NPCs and their dialogs
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DialogMetadata {
  dialogName: string;
  npc: string;
  filePath: string;
}

export interface ProjectIndex {
  npcs: string[];                                    // Sorted list of NPC identifiers
  dialogsByNpc: Map<string, DialogMetadata[]>;      // Dialogs grouped by NPC
  allFiles: string[];                                // All .d files in project
}

class ProjectService {
  /**
   * Recursively scan directory for .d files
   */
  async scanDirectory(rootPath: string): Promise<string[]> {
    const files: string[] = [];

    const scanRecursive = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            scanRecursive(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.d')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.error(`Error scanning directory ${dir}:`, error);
      }
    };

    scanRecursive(rootPath);
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
   * Build complete project index from directory
   */
  async buildProjectIndex(rootPath: string): Promise<ProjectIndex> {
    // Scan for all .d files
    const allFiles = await this.scanDirectory(rootPath);

    // Map to store dialogs by NPC
    const dialogsByNpc = new Map<string, DialogMetadata[]>();

    // Process each file
    for (const filePath of allFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const dialogs = this.extractDialogMetadata(content, filePath);

        // Group dialogs by NPC
        for (const dialog of dialogs) {
          if (!dialogsByNpc.has(dialog.npc)) {
            dialogsByNpc.set(dialog.npc, []);
          }
          dialogsByNpc.get(dialog.npc)!.push(dialog);
        }
      } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
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
