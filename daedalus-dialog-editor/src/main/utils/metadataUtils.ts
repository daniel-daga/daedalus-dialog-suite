import type { DialogMetadata, GlobalSymbol } from '../../shared/types';

// Regex to match start of INSTANCE declarations
// Matches: INSTANCE <name> (C_INFO) {
export const INSTANCE_START_REGEX = /INSTANCE\s+(\w+)\s*\(([^)]+)\)\s*\{/gi;

// Regex to match npc property inside the body
export const NPC_REGEX = /npc\s*=\s*([^;}\s]+)/gi;

// Regex to detect quest definitions (Legacy, preserved for reference)
export const TOPIC_REGEX = /const\s+string\s+TOPIC_\w+/i;
export const MIS_REGEX = /var\s+int\s+MIS_\w+/i;

// Regex for Constants: const <type> <name> = <value>;
// Capture groups: 1=type, 2=name, 3=value
export const CONST_REGEX = /const\s+(\w+)\s+(\w+)\s*=\s*(.+?);/gi;

// Regex for Variables: var <type> <name>;
// Capture groups: 1=type, 2=name
export const VAR_REGEX = /var\s+(\w+)\s+(\w+)(?:\[\d+\])?;/gi; // Added optional array size support

// Regex for Quest References (Usage of TOPIC_ or MIS_ tokens)
// Matches any word starting with TOPIC_ or MIS_
export const QUEST_REF_REGEX = /\b(TOPIC_\w+|MIS_\w+)\b/g;

/**
 * Result of file metadata extraction
 */
export interface FileMetadata {
  dialogs: DialogMetadata[];
  symbols: GlobalSymbol[];
  referencedQuests: string[];
}

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

/**
 * Extract all metadata from file content including Dialogs, Global Symbols, and Quest References.
 */
export function extractFileMetadata(content: string, filePath: string): FileMetadata {
  const dialogs = extractDialogMetadata(content, filePath);
  const symbols: GlobalSymbol[] = [];
  const referencedQuests = new Set<string>();

  // Extract Constants
  CONST_REGEX.lastIndex = 0;
  let constMatch;
  while ((constMatch = CONST_REGEX.exec(content)) !== null) {
    const type = constMatch[1];
    const name = constMatch[2];
    const valueStr = constMatch[3];
    let value: string | number | boolean = valueStr;

    // Basic value parsing
    if (type.toLowerCase() === 'int') {
      value = parseInt(valueStr, 10);
      if (isNaN(value as number)) value = valueStr; // Fallback if it's a constant ref
    } else if (type.toLowerCase() === 'string') {
      // Remove quotes
      value = valueStr.replace(/^"|"$/g, '');
    }

    symbols.push({
      name,
      type,
      value,
      filePath
    });
  }

  // Extract Variables
  VAR_REGEX.lastIndex = 0;
  let varMatch;
  while ((varMatch = VAR_REGEX.exec(content)) !== null) {
    const type = varMatch[1];
    const name = varMatch[2];

    symbols.push({
      name,
      type,
      value: undefined, // Variables start undefined/zero
      filePath
    });
  }

  // Extract Quest References
  QUEST_REF_REGEX.lastIndex = 0;
  let refMatch;
  while ((refMatch = QUEST_REF_REGEX.exec(content)) !== null) {
    const token = refMatch[1];
    referencedQuests.add(token);
  }

  return {
    dialogs,
    symbols,
    referencedQuests: Array.from(referencedQuests)
  };
}
