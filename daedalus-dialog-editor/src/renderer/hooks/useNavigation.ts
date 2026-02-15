import { useCallback } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useEditorStore } from '../store/editorStore';

export interface NavigationOptions {
  functionName?: string;
  variableName?: string;
  preferSource?: boolean;
  kind?: 'quest' | 'dialog' | 'npc' | 'variable' | 'constant' | 'instance' | 'function';
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

  const findCaseInsensitiveKey = useCallback((values: string[], target: string): string | null => {
    const lowerTarget = target.toLowerCase();
    const match = values.find((value) => value.toLowerCase() === lowerTarget);
    return match || null;
  }, []);

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

  const navigateToSymbol = useCallback(async (symbolName: string, options?: NavigationOptions) => {
    const lowerSymbolName = symbolName.toLowerCase();
    const requestedKind = options?.kind;
    const currentSemanticModel = isProjectMode ? mergedSemanticModel : (activeFile ? openFiles.get(activeFile)?.semanticModel : null);

    // 1. Try to navigate as a quest/topic (switch to quest view)
    if ((requestedKind === 'quest' || (!requestedKind && symbolName.toUpperCase().startsWith('TOPIC_'))) && !options?.preferSource) {
      setActiveView('quest');
      // QuestEditor should react to this if we had a selectedQuest in store,
      // but QuestEditor currently uses local state for selectedQuest.
      // For now, we just switch view.
      return true;
    }

    const navigateToNpc = async () => {
      const npcName = findCaseInsensitiveKey(Array.from(dialogIndex.keys()), symbolName);
      if (!npcName) {
        return false;
      }

      selectNpc(npcName);
      setSelectedNPC(npcName);
      setActiveView('dialog');

      if (isProjectMode) {
        const dialogMetadata = dialogIndex.get(npcName) || [];
        const uniqueFilePaths = [...new Set(dialogMetadata.map((entry) => entry.filePath))];
        await Promise.all(uniqueFilePaths.map((filePath) => getSemanticModel(filePath)));
        loadAndMergeNpcModels(npcName);
      }

      const dialogs = dialogIndex.get(npcName) || [];
      if (dialogs.length > 0) {
        await navigateToDialog(dialogs[0].dialogName);
      }

      return true;
    };

    // 2. Explicit type navigation
    if (requestedKind === 'dialog' && await navigateToDialog(symbolName)) return true;
    if (requestedKind === 'npc' && await navigateToNpc()) return true;

    // 3. Try to navigate as a dialog
    if (!requestedKind && await navigateToDialog(symbolName)) return true;

    // 4. Try to navigate as an NPC
    if ((!requestedKind || requestedKind === 'npc') && await navigateToNpc()) return true;
    
    // 5. Try to find as a variable, constant, function, or instance in the current model
    if (currentSemanticModel) {
      // Case-insensitive lookup in objects
      const findCaseInsensitive = (obj: Record<string, any> | undefined) => {
        if (!obj) return null;
        const exactKey = Object.keys(obj).find(k => k.toLowerCase() === lowerSymbolName);
        return exactKey ? obj[exactKey] : null;
      };

      const constant = findCaseInsensitive(currentSemanticModel.constants);
      const variable = findCaseInsensitive(currentSemanticModel.variables);
      const instance = findCaseInsensitive(currentSemanticModel.instances);
      const func = findCaseInsensitive(currentSemanticModel.functions);

      if (
        (requestedKind === 'variable' && !variable) ||
        (requestedKind === 'constant' && !constant) ||
        (requestedKind === 'function' && !func) ||
        (requestedKind === 'instance' && !instance)
      ) {
        return false;
      }

      if (requestedKind === 'variable' || requestedKind === 'constant' || variable || constant) {
        const symbol = requestedKind === 'constant' ? constant : (requestedKind === 'variable' ? variable : (variable || constant));
        if (symbol?.filePath) {
          await openFile(symbol.filePath);
        }
        setActiveView('variable');
        return true;
      }

      if (func) {
        if (func.filePath) {
          await openFile(func.filePath);
        }
        setActiveView('dialog');
        if (func.name) {
          setSelectedFunctionName(func.name);
        }
        return true;
      }

      if (instance?.filePath) {
        await openFile(instance.filePath);
        setActiveView('dialog');
        return true;
      }
    }

    return false;
  }, [activeFile, dialogIndex, findCaseInsensitiveKey, getSemanticModel, isProjectMode, loadAndMergeNpcModels, mergedSemanticModel, navigateToDialog, openFile, openFiles, selectNpc, setActiveView, setSelectedFunctionName, setSelectedNPC]);

  return {
    navigateToDialog,
    navigateToSymbol
  };
};
