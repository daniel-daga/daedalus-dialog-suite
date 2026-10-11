import { useMemo, useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import type { DialogMetadata } from '../../types/global';
import type { ParsedFileCache } from '../../store/projectStore';
import { useProjectStore } from '../../store/projectStore';

interface UseNpcDialogErrorsProps {
  isProjectMode: boolean;
  selectedNPC: string | null;
  dialogIndex: Map<string, DialogMetadata[]>;
}

const EMPTY_PATHS: string[] = [];

export interface NpcDialogError {
  filePath: string;
  message: string;
}

export interface UseNpcDialogErrorsResult {
  npcDialogErrors: NpcDialogError[];
  hasNpcDialogErrors: boolean;
}

/**
 * Computes parse errors for the currently selected NPC's dialog files and
 * logs them to the console whenever they change (for easy debugging).
 */
export function useNpcDialogErrors({
  isProjectMode,
  selectedNPC,
  dialogIndex,
}: UseNpcDialogErrorsProps): UseNpcDialogErrorsResult {
  const npcFilePaths = useMemo((): string[] => {
    if (!isProjectMode || !selectedNPC) return EMPTY_PATHS;
    const dialogMetadata = dialogIndex.get(selectedNPC) || [];
    return Array.from(new Set(dialogMetadata.map(m => m.filePath)));
  }, [isProjectMode, selectedNPC, dialogIndex]);

  // Narrow subscription: only the selected NPC's parsed file entries, compared
  // with shallow so ingestion flushes touching other NPCs' files (which replace
  // the whole parsedFiles Map) do not re-render this NPC's dialog column.
  const npcParsedEntries = useProjectStore(
    (s) => npcFilePaths.map((fp) => s.parsedFiles.get(fp)),
    shallow
  ) as Array<ParsedFileCache | undefined>;

  const npcDialogErrors = useMemo((): NpcDialogError[] => {
    const errors: NpcDialogError[] = [];
    npcFilePaths.forEach((filePath, i) => {
      const parsed = npcParsedEntries[i];
      const fileErrors = parsed?.semanticModel?.errors || [];
      if (parsed?.semanticModel?.hasErrors) {
        fileErrors.forEach((err) => {
          errors.push({ filePath, message: err.message });
        });
      }
    });
    return errors;
  }, [npcFilePaths, npcParsedEntries]);

  const hasNpcDialogErrors = npcDialogErrors.length > 0;

  // Log parse errors for the selected NPC to the console (for easy debugging)
  useEffect(() => {
    if (!isProjectMode) return;
    if (!selectedNPC) return;
    if (!hasNpcDialogErrors) return;

    console.error(
      `[Dialog Parse Errors] NPC=${selectedNPC} count=${npcDialogErrors.length}`,
      npcDialogErrors
    );
  }, [isProjectMode, selectedNPC, hasNpcDialogErrors, npcDialogErrors]);

  return { npcDialogErrors, hasNpcDialogErrors };
}
