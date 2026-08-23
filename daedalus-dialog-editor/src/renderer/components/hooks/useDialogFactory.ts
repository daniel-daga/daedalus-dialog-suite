import { useCallback } from 'react';
import { createDialogLineId } from '../actionFactory';
import {
  normalizeIdentifier,
  makeUniqueName,
  normalizePath,
  getDirectoryName,
  joinPath
} from '../../utils/pathAndIdentifierUtils';
import type {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogMetadata
} from '../../types/global';

export interface DialogFactoryConfig {
  projectPath: string | null;
  activeFile: string | null;
  filePath: string | null;
  allDialogFiles: string[];
  isProjectMode: boolean;
  semanticModel: SemanticModel;
  dialogIndex: Map<string, DialogMetadata[]>;
  selectedNPC: string | null;
  openFile: (filePath: string) => Promise<void>;
  getFileState: (filePath: string) => { semanticModel: SemanticModel; hasErrors?: boolean } | null | undefined;
  updateModel: (filePath: string, model: SemanticModel) => void;
  addDialogToIndex: (metadata: DialogMetadata) => void;
  selectNpc: (npcId: string) => void;
  loadAndMergeNpcModels: (npcId: string) => void;
  setSelectedNPC: (npc: string) => void;
  onDialogCreated: (dialogName: string, infoFunctionName: string) => void;
}

export function useDialogFactory(config: DialogFactoryConfig) {
  const {
    projectPath,
    activeFile,
    filePath,
    allDialogFiles,
    isProjectMode,
    semanticModel,
    dialogIndex,
    selectedNPC,
    openFile,
    getFileState,
    updateModel,
    addDialogToIndex,
    selectNpc,
    loadAndMergeNpcModels,
    setSelectedNPC,
    onDialogCreated
  } = config;

  /**
   * Determine which file a new dialog for `npcName` should be written to.
   * Falls back progressively from existing NPC metadata → default generated
   * path → currently-active file.
   */
  const resolveTargetFilePath = useCallback(
    (npcName: string): string | null => {
      const npcDialogMetadata = dialogIndex.get(npcName) || [];
      if (npcDialogMetadata.length > 0) {
        return npcDialogMetadata[0].filePath;
      }

      if (isProjectMode) {
        const npcToken = normalizeIdentifier(npcName, 'NEW_NPC');
        const defaultFileName = `DIA_${npcToken}.d`;
        const baseDirectory = projectPath
          ? normalizePath(projectPath)
          : getDirectoryName(activeFile || filePath || allDialogFiles[0] || '');

        if (!baseDirectory) return null;
        return joinPath(baseDirectory, defaultFileName);
      }

      if (selectedNPC) {
        const selectedNpcMetadata = dialogIndex.get(selectedNPC) || [];
        if (selectedNpcMetadata.length > 0) {
          return selectedNpcMetadata[0].filePath;
        }
      }

      return activeFile || filePath || null;
    },
    [dialogIndex, isProjectMode, projectPath, activeFile, filePath, allDialogFiles, selectedNPC]
  );

  /**
   * Create a new dialog (and associated info/condition functions) for
   * `rawNpcName`. NPC instances are never generated here: the removed
   * "Add NPC" flow (issue #141) produced instances with incorrect
   * parameters, so instance files are authored manually and picked up by
   * the file watcher.
   */
  const createDialogForNpc = useCallback(
    async (rawNpcName: string, requestedDialogName?: string) => {
      const npcName = normalizeIdentifier(rawNpcName, 'NEW_NPC');
      const targetFilePath = resolveTargetFilePath(npcName);

      if (!targetFilePath) {
        throw new Error('No target file available. Open a dialog file first.');
      }

      const knownDialogPaths = new Set(allDialogFiles.map((p) => normalizePath(p)));
      const normalizedTargetPath = normalizePath(targetFilePath);
      if (isProjectMode && !knownDialogPaths.has(normalizedTargetPath)) {
        const writeResult = await window.editorAPI.writeFile(targetFilePath, '');
        if (!writeResult?.success) {
          throw new Error(`Could not create NPC dialog file: ${targetFilePath}`);
        }
      }

      // Live store lookup (§3 P1): checking a render-captured `openFiles` Map
      // would require subscribing the layout to every open file's changes.
      if (!getFileState(targetFilePath)) {
        await openFile(targetFilePath);
      }

      const latestModel = getFileState(targetFilePath)?.semanticModel;
      if (!latestModel || latestModel.hasErrors) {
        throw new Error('Target file contains syntax errors and cannot be edited.');
      }

      const uniquenessModel = (isProjectMode ? semanticModel : latestModel) as SemanticModel;

      const npcToken = normalizeIdentifier(npcName, 'NEW_NPC');
      const dialogBaseName = requestedDialogName?.trim()
        ? normalizeIdentifier(requestedDialogName, `DIA_${npcToken}_Start`)
        : `DIA_${npcToken}_Start`;
      const prefixedDialogBase = dialogBaseName.startsWith('DIA_')
        ? dialogBaseName
        : `DIA_${dialogBaseName}`;

      const existingDialogNames = new Set<string>([
        ...Object.keys(uniquenessModel.dialogs || {}),
        ...Object.keys(latestModel.dialogs || {})
      ]);
      const dialogName = makeUniqueName(prefixedDialogBase, existingDialogNames);

      const existingFunctionNames = new Set<string>([
        ...Object.keys(uniquenessModel.functions || {}),
        ...Object.keys(latestModel.functions || {})
      ]);
      const infoFunctionName = makeUniqueName(`${dialogName}_Info`, existingFunctionNames);
      existingFunctionNames.add(infoFunctionName);
      const conditionFunctionName = makeUniqueName(`${dialogName}_Condition`, existingFunctionNames);

      const nextNr =
        Object.values(latestModel.dialogs || {}).reduce((maxNr, dialog) => {
          if (dialog?.properties?.npc !== npcName) return maxNr;
          const nr = typeof dialog.properties?.nr === 'number' ? dialog.properties.nr : 0;
          return Math.max(maxNr, nr);
        }, 0) + 1;

      const newDialog: Dialog = {
        name: dialogName,
        parent: 'C_INFO',
        properties: {
          npc: npcName,
          nr: nextNr,
          condition: conditionFunctionName,
          information: infoFunctionName,
          description: '',
          permanent: false,
          important: false
        }
      };

      const conditionFunction: DialogFunction = {
        name: conditionFunctionName,
        returnType: 'INT',
        actions: [],
        conditions: [],
        calls: []
      };

      const informationFunction: DialogFunction = {
        name: infoFunctionName,
        returnType: 'VOID',
        actions: [
          {
            type: 'DialogLine',
            speaker: 'other',
            text: '',
            id: createDialogLineId({ dialogName, speaker: 'other', actions: [] })
          }
        ],
        conditions: [],
        calls: []
      };

      const updatedModel: SemanticModel = {
        ...latestModel,
        dialogs: { ...(latestModel.dialogs || {}), [dialogName]: newDialog },
        functions: {
          ...(latestModel.functions || {}),
          [conditionFunctionName]: conditionFunction,
          [infoFunctionName]: informationFunction
        },
        hasErrors: false,
        errors: latestModel.errors || []
      };

      updateModel(targetFilePath, updatedModel);

      if (isProjectMode) {
        addDialogToIndex({ dialogName, npc: npcName, filePath: targetFilePath });
        selectNpc(npcName);
        loadAndMergeNpcModels(npcName);
      }

      setSelectedNPC(npcName);
      onDialogCreated(dialogName, infoFunctionName);
    },
    [
      resolveTargetFilePath,
      allDialogFiles,
      isProjectMode,
      semanticModel,
      openFile,
      getFileState,
      updateModel,
      addDialogToIndex,
      selectNpc,
      loadAndMergeNpcModels,
      setSelectedNPC,
      onDialogCreated
    ]
  );

  return { createDialogForNpc };
}
