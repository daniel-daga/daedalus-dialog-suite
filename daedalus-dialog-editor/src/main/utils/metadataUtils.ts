import type { DialogMetadata } from '../../shared/types';

// Regex to match start of INSTANCE declarations
// Matches: INSTANCE <name> (C_INFO) {
export const INSTANCE_START_REGEX = /INSTANCE\s+(\w+)\s*\(([^)]+)\)\s*\{/gi;

// Regex to match npc property inside the body
export const NPC_REGEX = /npc\s*=\s*([^;}\s]+)/gi;

// Regex to detect quest definitions
export const TOPIC_REGEX = /const\s+string\s+TOPIC_\w+/i;
export const MIS_REGEX = /var\s+int\s+MIS_\w+/i;

/**
 * Extract dialog metadata from file content using regex (lightweight, no full parse)
 *
 * Looks for INSTANCE declarations with C_INFO parent and npc property:
 * INSTANCE DIA_Name (C_INFO) { npc = SLD_12345_Name; ... };
 */
export function extractDialogMetadata(content: string, filePath: string): DialogMetadata[] {
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
