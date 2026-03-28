import { useMemo, useEffect } from 'react';
import type { DialogMetadata } from '../../types/global';
import type { ParsedFileCache } from '../../store/projectStore';

interface UseNpcDialogErrorsProps {
  isProjectMode: boolean;
  selectedNPC: string | null;
  dialogIndex: Map<string, DialogMetadata[]>;
  parsedFiles: Map<string, ParsedFileCache>;
}

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
  parsedFiles,
}: UseNpcDialogErrorsProps): UseNpcDialogErrorsResult {
  const npcDialogErrors = useMemo((): NpcDialogError[] => {
    if (!isProjectMode || !selectedNPC) return [];

    const dialogMetadata = dialogIndex.get(selectedNPC) || [];
    const npcFilePaths = Array.from(new Set(dialogMetadata.map(m => m.filePath)));

    const errors: NpcDialogError[] = [];
    npcFilePaths.forEach((filePath) => {
      const parsed = parsedFiles.get(filePath);
      const fileErrors = parsed?.semanticModel?.errors || [];
      if (parsed?.semanticModel?.hasErrors) {
        fileErrors.forEach((err) => {
          errors.push({ filePath, message: err.message });
        });
      }
    });

    return errors;
  }, [isProjectMode, selectedNPC, dialogIndex, parsedFiles]);

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
