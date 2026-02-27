import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Connection,
  Node,
  NodeTypes,
  useNodesState,
  useEdgesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography
} from '@mui/material';
import { Undo as UndoIcon, Redo as RedoIcon } from '@mui/icons-material';
import type { SemanticModel } from '../types/global';
import type { QuestGraphBuildOptions, QuestGraphEdge, QuestGraphNode } from '../types/questGraph';
import { useNavigation } from '../hooks/useNavigation';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import {
  analyzeQuestGuardrails,
  buildQuestGraph,
  findDialogNameForFunction,
  getQuestGuardrailDeltaWarnings,
  isQuestGuardrailWarningBlocking,
  type QuestGraphCommand
} from '../quest/domain';
import { QuestEditingService } from '../quest/application';
import DialogNode from './QuestEditor/Nodes/DialogNode';
import QuestStateNode from './QuestEditor/Nodes/QuestStateNode';
import ConditionNode from './QuestEditor/Nodes/ConditionNode';
import QuestInspectorPanel from './QuestEditor/Inspector/QuestInspectorPanel';
import QuestDiffPreviewDialog from './QuestEditor/Inspector/QuestDiffPreviewDialog';
import QuestLiteGraphCanvas from './QuestEditor/QuestLiteGraphCanvas';

interface QuestFlowProps {
  semanticModel: SemanticModel;
  questName: string | null;
  writableEnabled?: boolean;
}

interface PendingDiffPreview {
  updates: Array<{
    filePath: string;
    updatedModel: SemanticModel;
  }>;
  fileDiffs: Array<{
    filePath: string;
    beforeCode: string;
    afterCode: string;
  }>;
  beforeCode: string;
  afterCode: string;
  warnings: Array<{
    message: string;
    blocking?: boolean;
  }>;
}

const inferConditionValueFromNode = (node: QuestGraphNode | undefined): { variableName: string; value: string } | null => {
  if (!node) return null;
  const description = String(node.data.description || '');
  const variableName = node.data.variableName;

  const assignmentMatch = description.match(/Set\s+([A-Z0-9_]+)\s*=\s*(.+)$/i);
  if (assignmentMatch?.[1] && assignmentMatch?.[2]) {
    return {
      variableName: assignmentMatch[1],
      value: assignmentMatch[2].trim()
    };
  }

  if (variableName) {
    if (description.includes('LOG_RUNNING')) return { variableName, value: 'LOG_RUNNING' };
    if (description.includes('LOG_SUCCESS')) return { variableName, value: 'LOG_SUCCESS' };
    if (description.includes('LOG_FAILED')) return { variableName, value: 'LOG_FAILED' };
    return { variableName, value: 'LOG_RUNNING' };
  }

  return null;
};

const nodeTypes: NodeTypes = {
  dialog: DialogNode,
  questState: QuestStateNode,
  condition: ConditionNode
};

const formatDiffPreviewSource = (
  entries: Array<{ filePath: string; code: string }>,
  fallbackFilePath: string
): string => {
  if (entries.length === 0) return '';
  if (entries.length === 1) return entries[0].code;

  return entries.map((entry, index) => {
    const headerPath = entry.filePath || fallbackFilePath;
    const separator = index < entries.length - 1 ? '\n\n' : '';
    return `// FILE: ${headerPath}\n${entry.code}${separator}`;
  }).join('');
};

const QuestFlow: React.FC<QuestFlowProps> = ({ semanticModel, questName, writableEnabled = true }) => {
  const { navigateToDialog, navigateToSymbol } = useNavigation();
  const { projectPath, parsedFiles } = useProjectStore((state) => ({
    projectPath: state.projectPath,
    parsedFiles: state.parsedFiles
  }));
  const {
    activeFile,
    getFileState,
    openFile,
    applyQuestModelsWithHistory,
    applyQuestNodePositionWithHistory,
    getQuestNodePositions,
    undoLastQuestBatch,
    redoLastQuestBatch,
    canUndoLastQuestBatch,
    canRedoLastQuestBatch,
    codeSettings
  } = useEditorStore((state) => ({
    activeFile: state.activeFile,
    getFileState: state.getFileState,
    openFile: state.openFile,
    applyQuestModelsWithHistory: state.applyQuestModelsWithHistory,
    applyQuestNodePositionWithHistory: state.applyQuestNodePositionWithHistory,
    getQuestNodePositions: state.getQuestNodePositions,
    undoLastQuestBatch: state.undoLastQuestBatch,
    redoLastQuestBatch: state.redoLastQuestBatch,
    canUndoLastQuestBatch: state.canUndoLastQuestBatch,
    canRedoLastQuestBatch: state.canRedoLastQuestBatch,
    codeSettings: state.codeSettings
  }));

  const [nodes, setNodes, onNodesChange] = useNodesState<QuestGraphNode['data']>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<QuestGraphEdge['data']>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<PendingDiffPreview | null>(null);
  const [graphOptions, setGraphOptions] = useState<QuestGraphBuildOptions>({
    onlySelectedQuest: true,
    hideInferredEdges: false,
    showConditions: true
  });
  const [connectMode, setConnectMode] = useState(false);
  const [connectKind, setConnectKind] = useState<'transition' | 'requires'>('transition');

  const isProjectMode = !!projectPath;
  const nodeFramework = (import.meta.env.VITE_QUEST_NODE_FRAMEWORK || 'litegraph').toLowerCase();
  const useComfyNodeFramework = nodeFramework === 'litegraph';

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) || null,
    [edges, selectedEdgeId]
  );
  const guardrailWarnings = useMemo(
    () => analyzeQuestGuardrails(semanticModel, questName),
    [semanticModel, questName]
  );

  const refreshGraph = useCallback(() => {
    const { nodes: newNodes, edges: newEdges } = buildQuestGraph(semanticModel, questName, graphOptions);
    const nextNodes = [...newNodes];
    if (questName && activeFile) {
      const positionOverrides = getQuestNodePositions(activeFile, questName);
      if (positionOverrides.size > 0) {
        for (const node of nextNodes) {
          const override = positionOverrides.get(node.id);
          if (!override || node.type === 'group') continue;
          node.position = { x: override.x, y: override.y };
        }
      }
    }
    setNodes(nextNodes);
    setEdges(newEdges);
  }, [semanticModel, questName, graphOptions, setNodes, setEdges, activeFile, getQuestNodePositions]);

  useEffect(() => {
    const handler = setTimeout(refreshGraph, 150);
    return () => clearTimeout(handler);
  }, [refreshGraph]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: QuestGraphNode) => {
    if (node.type === 'group') return;
    event.preventDefault();
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setCommandError(null);
  }, []);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: QuestGraphNode) => {
    if (node.type === 'group') return;
    const dialogName = findDialogNameForFunction(semanticModel, node.id);
    if (dialogName) {
      navigateToDialog(dialogName);
    } else {
      navigateToSymbol(node.id);
    }
  }, [semanticModel, navigateToDialog, navigateToSymbol]);

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: QuestGraphEdge) => {
    event.preventDefault();
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setCommandError(null);
  }, []);

  const getOwnerFunctionFromCommand = (command: QuestGraphCommand): string | null => {
    switch (command.type) {
      case 'moveNode':
        return command.nodeId;
      case 'setMisState':
      case 'addTopicStatus':
      case 'addLogEntry':
        return command.functionName;
      case 'connectCondition':
        return (command.mode || 'transition') === 'requires'
          ? command.targetFunctionName
          : command.sourceFunctionName;
      case 'removeTransition':
        return (command.mode || 'transition') === 'requires'
          ? command.targetFunctionName
          : command.sourceFunctionName;
      case 'removeConditionLink':
      case 'updateConditionLink':
      case 'addKnowsInfoRequirement':
      case 'removeKnowsInfoRequirement':
        return command.targetFunctionName;
      case 'updateTransitionText':
        return command.sourceFunctionName;
      default:
        return null;
    }
  };

  const resolveFilePathForFunction = useCallback(async (functionName: string): Promise<string | null> => {
    if (activeFile) {
      const current = getFileState(activeFile);
      if (current?.semanticModel.functions?.[functionName]) {
        return activeFile;
      }
    }

    const matches = Array.from(parsedFiles.entries())
      .filter(([, cache]) => Boolean(cache.semanticModel.functions?.[functionName]))
      .map(([filePath]) => filePath);

    if (matches.length === 1) {
      await openFile(matches[0]);
      return matches[0];
    }

    if (matches.length > 1) {
      const newestMatch = [...matches].sort((left, right) => {
        const leftParsed = parsedFiles.get(left)?.lastParsed?.getTime?.() || 0;
        const rightParsed = parsedFiles.get(right)?.lastParsed?.getTime?.() || 0;
        return rightParsed - leftParsed;
      })[0];

      if (newestMatch) {
        await openFile(newestMatch);
        return newestMatch;
      }
    }

    setCommandError(`Function "${functionName}" was not found in loaded files.`);
    return null;
  }, [activeFile, getFileState, openFile, parsedFiles]);

  const preparePendingPreview = useCallback(async (
    updates: Array<{ filePath: string; updatedModel: SemanticModel }>
  ) => {
    if (!questName || updates.length === 0) return;

    const beforeEntries = await Promise.all(
      updates.map(async (entry) => {
        const stateForFile = useEditorStore.getState().getFileState(entry.filePath);
        const modelForCode = stateForFile?.semanticModel || entry.updatedModel;
        return {
          filePath: entry.filePath,
          code: await window.editorAPI.generateCode(modelForCode, codeSettings)
        };
      })
    );
    const afterEntries = await Promise.all(
      updates.map(async (entry) => ({
        filePath: entry.filePath,
        code: await window.editorAPI.generateCode(entry.updatedModel, codeSettings)
      }))
    );
    const beforeCode = formatDiffPreviewSource(beforeEntries, updates[0].filePath);
    const afterCode = formatDiffPreviewSource(afterEntries, updates[0].filePath);
    const fileDiffs = updates.map((entry) => {
      const beforeEntry = beforeEntries.find((candidate) => candidate.filePath === entry.filePath);
      const afterEntry = afterEntries.find((candidate) => candidate.filePath === entry.filePath);
      return {
        filePath: entry.filePath,
        beforeCode: beforeEntry?.code || '',
        afterCode: afterEntry?.code || ''
      };
    });

    const warningsByKey = new Map<string, string>();
    updates.forEach((entry) => {
      const stateForFile = useEditorStore.getState().getFileState(entry.filePath);
      if (!stateForFile) return;
      getQuestGuardrailDeltaWarnings(stateForFile.semanticModel, entry.updatedModel, questName).forEach((warning) => {
        const functions = warning.provenance?.functionNames || [];
        const suffix = functions.length === 0
          ? ''
          : ` (functions: ${functions.slice(0, 4).join(', ')}${functions.length > 4 ? '...' : ''})`;
        const message = `${warning.message}${suffix}`;
        const isBlocking = isQuestGuardrailWarningBlocking(warning.id);
        warningsByKey.set(warning.id, JSON.stringify({ message, blocking: isBlocking }));
      });
    });

    setPendingPreview({
      updates,
      fileDiffs,
      beforeCode,
      afterCode,
      warnings: Array.from(warningsByKey.values()).map((serialized) => {
        try {
          return JSON.parse(serialized) as { message: string; blocking?: boolean };
        } catch {
          return { message: serialized };
        }
      })
    });
  }, [codeSettings, questName]);

  const runQuestCommandWithPreview = useCallback(async (command: QuestGraphCommand, errorPrefix: string) => {
    if (!writableEnabled) {
      setCommandError('Writable quest editor is disabled by feature flag.');
      return;
    }
    if (!questName) {
      setCommandError('No quest selected.');
      return;
    }

    setCommandBusy(true);
    setCommandError(null);
    try {
      const ownerFunction = getOwnerFunctionFromCommand(command);
      if (!ownerFunction) {
        setCommandError('Command does not specify an owning function.');
        return;
      }
      const filePath = await resolveFilePathForFunction(ownerFunction);
      if (!filePath) return;

      const fileState = useEditorStore.getState().getFileState(filePath);
      if (!fileState) {
        setCommandError(`Unable to load "${filePath}" for command execution.`);
        return;
      }

      const commandResult = QuestEditingService.runCommand(
        {
          questName,
          model: fileState.semanticModel
        },
        command
      );

      if (!commandResult.ok) {
        setCommandError(commandResult.errors.map((error) => error.message).join(' '));
        return;
      }

      if (command.type === 'moveNode') {
        if (filePath && questName) {
          applyQuestNodePositionWithHistory(filePath, questName, command.nodeId, command.position);
        }
        refreshGraph();
        return;
      }

      const updates = [{
        filePath,
        updatedModel: commandResult.updatedModel
      }];
      await preparePendingPreview(updates);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : errorPrefix);
    } finally {
      setCommandBusy(false);
    }
  }, [questName, resolveFilePathForFunction, writableEnabled, refreshGraph, applyQuestNodePositionWithHistory, preparePendingPreview]);

  const runTransitionConnectWithPreview = useCallback(async (
    sourceFunctionName: string,
    targetFunctionName: string,
    choiceText: string
  ) => {
    if (!writableEnabled) {
      setCommandError('Writable quest editor is disabled by feature flag.');
      return;
    }
    if (!questName) {
      setCommandError('No quest selected.');
      return;
    }

    setCommandBusy(true);
    setCommandError(null);
    try {
      const sourceFilePath = await resolveFilePathForFunction(sourceFunctionName);
      const targetFilePath = await resolveFilePathForFunction(targetFunctionName);
      if (!sourceFilePath || !targetFilePath) return;

      const sourceState = useEditorStore.getState().getFileState(sourceFilePath);
      const targetState = useEditorStore.getState().getFileState(targetFilePath);
      if (!sourceState || !targetState) {
        setCommandError('Unable to load source/target files for transition command.');
        return;
      }

      const sourceResult = QuestEditingService.runCommand(
        { questName, model: sourceState.semanticModel },
        {
          type: 'connectCondition',
          mode: 'transition',
          sourceFunctionName,
          targetFunctionName,
          choiceText
        }
      );
      if (!sourceResult.ok) {
        setCommandError(sourceResult.errors.map((error) => error.message).join(' '));
        return;
      }

      const updates = new Map<string, SemanticModel>([[sourceFilePath, sourceResult.updatedModel]]);

      if (sourceFilePath !== targetFilePath) {
        const sourceDialogName = findDialogNameForFunction(semanticModel, sourceFunctionName);
        if (sourceDialogName) {
          const targetResult = QuestEditingService.runCommand(
            { questName, model: targetState.semanticModel },
            {
              type: 'addKnowsInfoRequirement',
              targetFunctionName,
              dialogRef: sourceDialogName,
              npc: 'self'
            }
          );
          if (!targetResult.ok) {
            setCommandError(targetResult.errors.map((error) => error.message).join(' '));
            return;
          }
          updates.set(targetFilePath, targetResult.updatedModel);
        }
      }

      await preparePendingPreview(
        Array.from(updates.entries()).map(([filePath, updatedModel]) => ({ filePath, updatedModel }))
      );
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Failed to connect transition.');
    } finally {
      setCommandBusy(false);
    }
  }, [writableEnabled, questName, resolveFilePathForFunction, preparePendingPreview, semanticModel]);

  const runTransitionRemoveWithPreview = useCallback(async (
    sourceFunctionName: string,
    targetFunctionName: string
  ) => {
    if (!writableEnabled) {
      setCommandError('Writable quest editor is disabled by feature flag.');
      return;
    }
    if (!questName) {
      setCommandError('No quest selected.');
      return;
    }

    setCommandBusy(true);
    setCommandError(null);
    try {
      const sourceFilePath = await resolveFilePathForFunction(sourceFunctionName);
      const targetFilePath = await resolveFilePathForFunction(targetFunctionName);
      if (!sourceFilePath || !targetFilePath) return;

      const sourceState = useEditorStore.getState().getFileState(sourceFilePath);
      const targetState = useEditorStore.getState().getFileState(targetFilePath);
      if (!sourceState || !targetState) {
        setCommandError('Unable to load source/target files for transition removal.');
        return;
      }

      const sourceResult = QuestEditingService.runCommand(
        { questName, model: sourceState.semanticModel },
        {
          type: 'removeTransition',
          mode: 'transition',
          sourceFunctionName,
          targetFunctionName
        }
      );
      if (!sourceResult.ok) {
        setCommandError(sourceResult.errors.map((error) => error.message).join(' '));
        return;
      }

      const updates = new Map<string, SemanticModel>([[sourceFilePath, sourceResult.updatedModel]]);

      if (sourceFilePath !== targetFilePath) {
        const sourceDialogName = findDialogNameForFunction(semanticModel, sourceFunctionName);
        if (sourceDialogName) {
          const targetResult = QuestEditingService.runCommand(
            { questName, model: targetState.semanticModel },
            {
              type: 'removeKnowsInfoRequirement',
              targetFunctionName,
              dialogRef: sourceDialogName,
              npc: 'self'
            }
          );
          if (!targetResult.ok) {
            setCommandError(targetResult.errors.map((error) => error.message).join(' '));
            return;
          }
          updates.set(targetFilePath, targetResult.updatedModel);
        }
      }

      await preparePendingPreview(
        Array.from(updates.entries()).map(([filePath, updatedModel]) => ({ filePath, updatedModel }))
      );
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Failed to remove transition.');
    } finally {
      setCommandBusy(false);
    }
  }, [writableEnabled, questName, resolveFilePathForFunction, preparePendingPreview, semanticModel]);

  const runTransitionTextUpdateWithPreview = useCallback(async (
    sourceFunctionName: string,
    targetFunctionName: string,
    text: string
  ) => {
    if (!writableEnabled) {
      setCommandError('Writable quest editor is disabled by feature flag.');
      return;
    }
    if (!questName) {
      setCommandError('No quest selected.');
      return;
    }

    setCommandBusy(true);
    setCommandError(null);
    try {
      const sourceFilePath = await resolveFilePathForFunction(sourceFunctionName);
      const targetFilePath = await resolveFilePathForFunction(targetFunctionName);
      if (!sourceFilePath || !targetFilePath) return;

      const sourceState = useEditorStore.getState().getFileState(sourceFilePath);
      const targetState = useEditorStore.getState().getFileState(targetFilePath);
      if (!sourceState || !targetState) {
        setCommandError('Unable to load source/target files for transition text update.');
        return;
      }

      const sourceResult = QuestEditingService.runCommand(
        { questName, model: sourceState.semanticModel },
        {
          type: 'updateTransitionText',
          sourceFunctionName,
          targetFunctionName,
          text
        }
      );
      if (!sourceResult.ok) {
        setCommandError(sourceResult.errors.map((error) => error.message).join(' '));
        return;
      }

      const updates = new Map<string, SemanticModel>([[sourceFilePath, sourceResult.updatedModel]]);

      if (sourceFilePath !== targetFilePath) {
        const sourceDialogName = findDialogNameForFunction(semanticModel, sourceFunctionName);
        if (sourceDialogName) {
          const targetResult = QuestEditingService.runCommand(
            { questName, model: targetState.semanticModel },
            {
              type: 'addKnowsInfoRequirement',
              targetFunctionName,
              dialogRef: sourceDialogName,
              npc: 'self'
            }
          );
          if (!targetResult.ok) {
            setCommandError(targetResult.errors.map((error) => error.message).join(' '));
            return;
          }
          updates.set(targetFilePath, targetResult.updatedModel);
        }
      }

      await preparePendingPreview(
        Array.from(updates.entries()).map(([filePath, updatedModel]) => ({ filePath, updatedModel }))
      );
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Failed to update transition text.');
    } finally {
      setCommandBusy(false);
    }
  }, [writableEnabled, questName, resolveFilePathForFunction, preparePendingPreview, semanticModel]);

  const onConnect = useCallback(async (connection: Connection) => {
    if (!connectMode) {
      setCommandError('Enable Connect Mode to create transitions.');
      return;
    }
    if (!writableEnabled) {
      setCommandError('Writable quest editor is disabled by feature flag.');
      return;
    }
    if (!connection.source || !connection.target) {
      setCommandError('Invalid edge: missing source or target.');
      return;
    }
    const sourceNode = nodes.find((node) => node.id === connection.source);
    if (connectKind === 'requires') {
      const condition = inferConditionValueFromNode(sourceNode);
      if (!condition) {
        setCommandError('Unable to infer variable condition from source node.');
        return;
      }

      await runQuestCommandWithPreview({
        type: 'connectCondition',
        mode: 'requires',
        sourceFunctionName: connection.source,
        targetFunctionName: connection.target,
        variableName: condition.variableName,
        value: condition.value
      }, 'Failed to connect condition link.');
      return;
    }

    await runTransitionConnectWithPreview(connection.source, connection.target, 'Continue');
  }, [connectMode, runQuestCommandWithPreview, nodes, connectKind, writableEnabled, runTransitionConnectWithPreview]);

  const persistNodeMove = useCallback(async (nodeId: string, position: { x: number; y: number }, nodeType?: string) => {
    if (
      !writableEnabled ||
      !questName ||
      nodeType === 'group' ||
      nodeId.startsWith('swimlane-') ||
      nodeId.startsWith('external-')
    ) {
      return;
    }

    await runQuestCommandWithPreview({
      type: 'moveNode',
      nodeId,
      position
    }, 'Failed to persist node position.');
  }, [questName, runQuestCommandWithPreview, writableEnabled]);

  const onNodeDragStop = useCallback(async (_: React.MouseEvent, node: Node) => {
    await persistNodeMove(node.id, { x: node.position.x, y: node.position.y }, node.type);
  }, [persistNodeMove]);

  const handleSetMisState = useCallback(async (payload: { functionName: string; variableName: string; value: string }) => {
    await runQuestCommandWithPreview({
      type: 'setMisState',
      functionName: payload.functionName,
      variableName: payload.variableName,
      value: payload.value
    }, 'Failed to execute setMisState command.');
  }, [runQuestCommandWithPreview]);

  const handleAddTopicStatus = useCallback(async (payload: { functionName: string; topic: string; status: string }) => {
    await runQuestCommandWithPreview({
      type: 'addTopicStatus',
      functionName: payload.functionName,
      topic: payload.topic,
      status: payload.status
    }, 'Failed to execute addTopicStatus command.');
  }, [runQuestCommandWithPreview]);

  const handleAddLogEntry = useCallback(async (payload: { functionName: string; topic: string; text: string }) => {
    await runQuestCommandWithPreview({
      type: 'addLogEntry',
      functionName: payload.functionName,
      topic: payload.topic,
      text: payload.text
    }, 'Failed to execute addLogEntry command.');
  }, [runQuestCommandWithPreview]);

  const handleRemoveTransition = useCallback(async (payload: { sourceFunctionName: string; targetFunctionName: string }) => {
    await runTransitionRemoveWithPreview(payload.sourceFunctionName, payload.targetFunctionName);
  }, [runTransitionRemoveWithPreview]);

  const handleUpdateTransitionText = useCallback(async (payload: {
    sourceFunctionName: string;
    targetFunctionName: string;
    text: string;
  }) => {
    await runTransitionTextUpdateWithPreview(payload.sourceFunctionName, payload.targetFunctionName, payload.text);
  }, [runTransitionTextUpdateWithPreview]);

  const handleRemoveConditionLink = useCallback(async (payload: {
    targetFunctionName: string;
    variableName: string;
    value: string;
    operator: '==' | '!=';
  }) => {
    await runQuestCommandWithPreview({
      type: 'removeConditionLink',
      targetFunctionName: payload.targetFunctionName,
      variableName: payload.variableName,
      value: payload.value,
      operator: payload.operator
    }, 'Failed to remove condition link.');
  }, [runQuestCommandWithPreview]);

  const handleUpdateConditionLink = useCallback(async (payload: {
    targetFunctionName: string;
    oldVariableName: string;
    oldValue: string;
    variableName: string;
    value: string;
    operator: '==' | '!=';
  }) => {
    await runQuestCommandWithPreview({
      type: 'updateConditionLink',
      targetFunctionName: payload.targetFunctionName,
      oldVariableName: payload.oldVariableName,
      oldValue: payload.oldValue,
      variableName: payload.variableName,
      value: payload.value,
      operator: payload.operator
    }, 'Failed to update condition link.');
  }, [runQuestCommandWithPreview]);

  const handleApplyDiff = useCallback(() => {
    if (!pendingPreview) return;
    applyQuestModelsWithHistory(
      pendingPreview.updates.map((entry) => ({
        filePath: entry.filePath,
        model: entry.updatedModel
      }))
    );
    setPendingPreview(null);
    refreshGraph();
  }, [pendingPreview, applyQuestModelsWithHistory, refreshGraph]);

  const canUndo = canUndoLastQuestBatch();
  const canRedo = canRedoLastQuestBatch();

  if (!questName) {
    return (
      <Box sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Typography color="text.secondary">Select a quest to view flow</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', width: '100%', display: 'flex' }}>
      <Box sx={{ height: '100%', flexGrow: 1, display: 'flex', flexDirection: 'column', bgcolor: '#1e1e1e' }}>
        <Paper
          square
          elevation={0}
          sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid #333', bgcolor: '#1e1e1e', color: '#ddd' }}
        >
          <Stack direction="row" spacing={1.5} flexWrap="wrap">
            <Button
              size="small"
              startIcon={<UndoIcon fontSize="small" />}
              disabled={!writableEnabled || !canUndo}
              onClick={() => {
                undoLastQuestBatch();
                refreshGraph();
              }}
            >
              Undo
            </Button>
            <Button
              size="small"
              startIcon={<RedoIcon fontSize="small" />}
              disabled={!writableEnabled || !canRedo}
              onClick={() => {
                redoLastQuestBatch();
                refreshGraph();
              }}
            >
              Redo
            </Button>
            <FormControlLabel
              control={(
                <Checkbox
                  checked={connectMode}
                  onChange={(event) => setConnectMode(event.target.checked)}
                  size="small"
                  disabled={!writableEnabled}
                />
              )}
              label="Connect mode"
            />
            {connectMode && (
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="connect-kind-label">Connect As</InputLabel>
                <Select
                  labelId="connect-kind-label"
                  label="Connect As"
                  value={connectKind}
                  onChange={(event) => setConnectKind(event.target.value as 'transition' | 'requires')}
                >
                  <MenuItem value="transition">Transition</MenuItem>
                  <MenuItem value="requires">Condition Link</MenuItem>
                </Select>
              </FormControl>
            )}
            <FormControlLabel
              control={(
                <Checkbox
                  checked={!!graphOptions.onlySelectedQuest}
                  onChange={(event) => setGraphOptions((prev) => ({
                    ...prev,
                    onlySelectedQuest: event.target.checked
                  }))}
                  size="small"
                />
              )}
              label="Only selected quest"
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={!!graphOptions.hideInferredEdges}
                  onChange={(event) => setGraphOptions((prev) => ({
                    ...prev,
                    hideInferredEdges: event.target.checked
                  }))}
                  size="small"
                />
              )}
              label="Hide inferred edges"
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={!!graphOptions.showConditions}
                  onChange={(event) => setGraphOptions((prev) => ({
                    ...prev,
                    showConditions: event.target.checked
                  }))}
                  size="small"
                />
              )}
              label="Show conditions"
            />
            {isProjectMode && (
              <Typography variant="caption" sx={{ alignSelf: 'center', color: '#999' }}>
                Project mode: open a concrete source file to apply edits.
              </Typography>
            )}
            {!writableEnabled && (
              <Typography variant="caption" sx={{ alignSelf: 'center', color: '#ffb74d' }}>
                Writable quest editor is disabled (read-only fallback).
              </Typography>
            )}
            {useComfyNodeFramework && connectMode && (
              <Typography variant="caption" sx={{ alignSelf: 'center', color: '#ffb74d' }}>
                LiteGraph mode mirrors ComfyUI framework. Use inspector actions for edits; drag-connect is available in legacy React Flow mode.
              </Typography>
            )}
          </Stack>
        </Paper>

        {guardrailWarnings.length > 0 && (
          <Box sx={{ px: 1.5, py: 1, bgcolor: '#1e1e1e', borderBottom: '1px solid #333' }}>
            {guardrailWarnings.map((warning) => (
              <Alert key={warning.id} severity="warning" sx={{ mb: 0.75, '&:last-of-type': { mb: 0 } }}>
                {warning.message}
              </Alert>
            ))}
          </Box>
        )}

        <Box sx={{ flexGrow: 1 }}>
          {useComfyNodeFramework ? (
            <QuestLiteGraphCanvas
              nodes={nodes}
              edges={edges}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onEdgeClick={onEdgeClick}
              onNodeMove={(nodeId, position) => {
                const movedNode = nodes.find((node) => node.id === nodeId);
                void persistNodeMove(nodeId, position, movedNode?.type);
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
              }}
            />
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStop={onNodeDragStop}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
              }}
              nodeTypes={nodeTypes}
              fitView
            >
              <Background color="#333" gap={20} />
              <Controls />
              <MiniMap
                nodeStrokeColor={(node) => {
                  if (node.type === 'questState') return '#00ff00';
                  if (node.type === 'group') return '#eee';
                  if (node.type === 'condition') return '#ffc107';
                  return '#0041d0';
                }}
                nodeColor={(node) => (node.type === 'group' ? '#fff' : '#fff')}
                nodeBorderRadius={2}
                maskColor="rgba(0, 0, 0, 0.7)"
                style={{ backgroundColor: '#222' }}
              />
            </ReactFlow>
          )}
        </Box>
      </Box>

      <QuestInspectorPanel
        questName={questName}
        writableEnabled={writableEnabled}
        selectedNode={selectedNode}
        selectedEdge={selectedEdge}
        onSetMisState={handleSetMisState}
        onAddTopicStatus={handleAddTopicStatus}
        onAddLogEntry={handleAddLogEntry}
        onRemoveTransition={handleRemoveTransition}
        onUpdateTransitionText={handleUpdateTransitionText}
        onRemoveConditionLink={handleRemoveConditionLink}
        onUpdateConditionLink={handleUpdateConditionLink}
        commandError={commandError}
        commandBusy={commandBusy || !writableEnabled}
      />

      <QuestDiffPreviewDialog
        open={!!pendingPreview}
        beforeCode={pendingPreview?.beforeCode || ''}
        afterCode={pendingPreview?.afterCode || ''}
        fileDiffs={pendingPreview?.fileDiffs || []}
        warnings={pendingPreview?.warnings || []}
        onClose={() => setPendingPreview(null)}
        onApply={handleApplyDiff}
        isApplying={commandBusy}
      />
    </Box>
  );
};

export default QuestFlow;
