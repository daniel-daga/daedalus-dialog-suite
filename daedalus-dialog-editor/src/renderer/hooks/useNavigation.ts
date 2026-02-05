import { useCallback } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useEditorStore } from '../store/editorStore';

export interface NavigationOptions {
  functionName?: string;
  variableName?: string;
}

export const useNavigation = () => {
  const { 
    dialogIndex, 
    selectNpc, 
    getSemanticModel, 
    loadAndMergeNpcModels,
    projectPath,
    mergedSemanticModel
  } = useProjectStore();
  
  const { 
    setSelectedDialog, 
    openFile, 
    openFiles,
    activeFile
  } = useEditorStore();

  const isProjectMode = !!projectPath;

  const navigateToDialog = useCallback(async (dialogName: string, functionName?: string) => {
    let foundNpc: string | null = null;
    let foundFilePath: string | null = null;

    // 1. Find the dialog in the project index
    for (const [npcId, dialogs] of dialogIndex.entries()) {
      const match = dialogs.find(d => d.dialogName === dialogName);
      if (match) {
        foundNpc = npcId;
        foundFilePath = match.filePath;
        break;
      }
    }

    if (foundNpc) {
      // 2. Select the NPC and load models
      selectNpc(foundNpc);
      
      if (isProjectMode) {
        // Load semantic models for all files of this NPC
        const dialogMetadata = dialogIndex.get(foundNpc) || [];
        const uniqueFilePaths = [...new Set(dialogMetadata.map(m => m.filePath))];
        
        await Promise.all(
          uniqueFilePaths.map(filePath => getSemanticModel(filePath))
        );
        
        loadAndMergeNpcModels(foundNpc);
      } else if (foundFilePath) {
        // In single file mode, if it's a different file, we might want to open it
        if (activeFile !== foundFilePath) {
          await openFile(foundFilePath);
        }
      }

      // 3. Set the selected dialog
      setSelectedDialog(dialogName);
      return true;
    }
    
    return false;
  }, [dialogIndex, selectNpc, getSemanticModel, loadAndMergeNpcModels, isProjectMode, activeFile, openFile, setSelectedDialog]);

  const navigateToSymbol = useCallback(async (symbolName: string) => {
    // 1. Try to navigate as a dialog
    if (await navigateToDialog(symbolName)) return true;

    // 2. Try to find as a variable or constant in the current merged model
    const semanticModel = isProjectMode ? mergedSemanticModel : (activeFile ? openFiles.get(activeFile)?.semanticModel : null);
    
    if (semanticModel) {
      const constant = semanticModel.constants?.[symbolName];
      const variable = semanticModel.variables?.[symbolName];
      const instance = semanticModel.instances?.[symbolName] as any;
      
      const symbol = constant || variable || instance;
      
      if (symbol && symbol.filePath) {
        await openFile(symbol.filePath);
        // TODO: Navigation to specific line/position could be added here
        // would require store support to set a "pending scroll" target
        return true;
      }
    }

    return false;
  }, [navigateToDialog, isProjectMode, mergedSemanticModel, activeFile, openFiles, openFile]);

  return {
    navigateToDialog,
    navigateToSymbol
  };
};
