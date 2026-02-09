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
    setSelectedNPC,
    setSelectedDialog, 
    setSelectedFunctionName,
    setActiveView,
    openFile, 
    openFiles,
    activeFile
  } = useEditorStore();

  const isProjectMode = !!projectPath;

  const navigateToDialog = useCallback(async (dialogName: string, functionName?: string) => {
    let foundNpc: string | null = null;
    let foundFilePath: string | null = null;
    let exactDialogName: string | null = null;

    const lowerDialogName = dialogName.toLowerCase();

    // 1. Find the dialog in the project index
    for (const [npcId, dialogs] of dialogIndex.entries()) {
      const match = dialogs.find(d => d.dialogName.toLowerCase() === lowerDialogName);
      if (match) {
        foundNpc = npcId;
        foundFilePath = match.filePath;
        exactDialogName = match.dialogName;
        break;
      }
    }

    if (foundNpc && exactDialogName) {
      // 2. Select the NPC and load models
      selectNpc(foundNpc);
      setSelectedNPC(foundNpc);
      
      let semanticModel: any = null;

      if (isProjectMode) {
        // Load semantic models for all files of this NPC
        const dialogMetadata = dialogIndex.get(foundNpc) || [];
        const uniqueFilePaths = [...new Set(dialogMetadata.map(m => m.filePath))];
        
        await Promise.all(
          uniqueFilePaths.map(filePath => getSemanticModel(filePath))
        );
        
        loadAndMergeNpcModels(foundNpc);
        
        // In project mode, we also need to open the specific file to enable editing
        if (foundFilePath && activeFile !== foundFilePath) {
          await openFile(foundFilePath);
        }

        // Find the merged model or the specific model for the dialog
        semanticModel = useProjectStore.getState().mergedSemanticModel;
      } else if (foundFilePath) {
        // In single file mode, if it's a different file, we might want to open it
        if (activeFile !== foundFilePath) {
          await openFile(foundFilePath);
        }
        semanticModel = useEditorStore.getState().openFiles.get(foundFilePath)?.semanticModel;
      }

      // 3. Set the selected dialog (using exact name from index)
      setSelectedDialog(exactDialogName);

      // 4. Set function name if provided or found in model
      if (functionName) {
        setSelectedFunctionName(functionName);
      } else if (semanticModel && semanticModel.dialogs?.[exactDialogName]) {
        const dialog = semanticModel.dialogs[exactDialogName];
        const infoFunc = dialog.properties?.information;
        const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;
        if (infoFuncName) {
          setSelectedFunctionName(infoFuncName);
        }
      }

      // 5. Switch to dialog view
      setActiveView('dialog');

      return true;
    }
    
    return false;
  }, [dialogIndex, selectNpc, getSemanticModel, loadAndMergeNpcModels, isProjectMode, activeFile, openFile, setSelectedNPC, setSelectedDialog, setSelectedFunctionName, setActiveView]);

  const navigateToSymbol = useCallback(async (symbolName: string, options?: { preferSource?: boolean }) => {
    const lowerSymbolName = symbolName.toLowerCase();

    // 1. Try to navigate as a quest/topic (switch to quest view)
    if (!options?.preferSource && symbolName.toUpperCase().startsWith('TOPIC_')) {
      setActiveView('quest');
      // QuestEditor should react to this if we had a selectedQuest in store,
      // but QuestEditor currently uses local state for selectedQuest.
      // For now, we just switch view.
      return true;
    }

    // 2. Try to navigate as a dialog
    if (await navigateToDialog(symbolName)) return true;

    // 3. Try to find as a variable, constant, or function in the current merged model
    const semanticModel = isProjectMode ? mergedSemanticModel : (activeFile ? openFiles.get(activeFile)?.semanticModel : null);
    
    if (semanticModel) {
      // Case-insensitive lookup in objects
      const findCaseInsensitive = (obj: Record<string, any> | undefined) => {
        if (!obj) return null;
        const exactKey = Object.keys(obj).find(k => k.toLowerCase() === lowerSymbolName);
        return exactKey ? obj[exactKey] : null;
      };

      const constant = findCaseInsensitive(semanticModel.constants);
      const variable = findCaseInsensitive(semanticModel.variables);
      const instance = findCaseInsensitive(semanticModel.instances);
      const func = findCaseInsensitive(semanticModel.functions);
      
      const symbol = constant || variable || instance || func;
      
      if (symbol && symbol.filePath) {
        await openFile(symbol.filePath);
        setActiveView('dialog');

        // If it's a function, try to select it
        if (func && func.name) {
          setSelectedFunctionName(func.name);
        }

        return true;
      }
    }

    return false;
  }, [navigateToDialog, isProjectMode, mergedSemanticModel, activeFile, openFiles, openFile, setActiveView, setSelectedFunctionName]);

  return {
    navigateToDialog,
    navigateToSymbol
  };
};
