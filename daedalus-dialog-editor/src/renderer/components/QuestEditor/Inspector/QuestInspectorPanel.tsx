import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import VariableAutocomplete from '../../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../../common/autocompletePolicies';
import type { DialogCondition } from '../../../types/global';
import type { QuestGraphEdge, QuestGraphNode } from '../../../types/questGraph';

interface QuestInspectorPanelProps {
  questName: string;
  semanticModel?: import('../../../types/global').SemanticModel;
  writableEnabled?: boolean;
  selectedNode: QuestGraphNode | null;
  selectedEdge: QuestGraphEdge | null;
  entrySurfaceNodes: QuestGraphNode[];
  onSelectEntrySurfaceNode: (nodeId: string) => void;
  onSetMisState: (payload: { functionName: string; variableName: string; value: string }) => void;
  onAddTopicStatus: (payload: { functionName: string; topic: string; status: string }) => void;
  onAddLogEntry: (payload: { functionName: string; topic: string; text: string }) => void;
  onRemoveTransition: (payload: { sourceFunctionName: string; targetFunctionName: string }) => void;
  onUpdateTransitionText: (payload: { sourceFunctionName: string; targetFunctionName: string; text: string }) => void;
  onRemoveConditionLink: (payload: {
    targetFunctionName: string;
    variableName: string;
    value: string;
    operator: '==' | '!=';
  }) => void;
  onUpdateConditionLink: (payload: {
    targetFunctionName: string;
    conditionIndex?: number;
    oldVariableName: string;
    oldValue: string;
    variableName: string;
    value: string;
    operator: '==' | '!=';
    negated?: boolean;
  }) => void;
  commandError: string | null;
  commandBusy: boolean;
}

const QuestInspectorPanel: React.FC<QuestInspectorPanelProps> = ({
  questName,
  semanticModel,
  writableEnabled = true,
  selectedNode,
  selectedEdge,
  entrySurfaceNodes = [],
  onSelectEntrySurfaceNode = () => undefined,
  onSetMisState,
  onAddTopicStatus,
  onAddLogEntry,
  onRemoveTransition,
  onUpdateTransitionText,
  onRemoveConditionLink,
  onUpdateConditionLink,
  commandError,
  commandBusy
}) => {
  const [misValue, setMisValue] = useState('');
  const [topicStatus, setTopicStatus] = useState('LOG_RUNNING');
  const [logEntryText, setLogEntryText] = useState('');
  const [edgeVariable, setEdgeVariable] = useState('');
  const [edgeOperator, setEdgeOperator] = useState<'==' | '!='>('==');
  const [edgeValue, setEdgeValue] = useState('');
  const [originalEdgeVariable, setOriginalEdgeVariable] = useState('');
  const [originalEdgeValue, setOriginalEdgeValue] = useState('');
  const [transitionText, setTransitionText] = useState('');
  const [conditionDraft, setConditionDraft] = useState<{
    variableName: string;
    value: string;
    operator: '==' | '!=';
    negated: boolean;
  } | null>(null);
  const sourceKindOrder = ['item', 'event', 'dialog', 'startup', 'script', 'external'] as const;
  const groupedEntrySurfaces = useMemo(() => {
    const grouped = new Map<string, QuestGraphNode[]>();
    for (const node of entrySurfaceNodes) {
      const sourceKey = node.data.sourceKind || 'unknown';
      if (!grouped.has(sourceKey)) {
        grouped.set(sourceKey, []);
      }
      grouped.get(sourceKey)!.push(node);
    }

    const orderedGroups: Array<{ source: string; nodes: QuestGraphNode[] }> = [];
    for (const source of sourceKindOrder) {
      const nodesForSource = grouped.get(source);
      if (!nodesForSource?.length) continue;
      orderedGroups.push({
        source,
        nodes: [...nodesForSource].sort((left, right) => String(left.data.label).localeCompare(String(right.data.label)))
      });
      grouped.delete(source);
    }

    for (const [source, nodesForSource] of grouped.entries()) {
      orderedGroups.push({
        source,
        nodes: [...nodesForSource].sort((left, right) => String(left.data.label).localeCompare(String(right.data.label)))
      });
    }

    return orderedGroups;
  }, [entrySurfaceNodes]);
  const latentEntryCount = useMemo(
    () => entrySurfaceNodes.filter((node) => Boolean(node.data.latentEntry)).length,
    [entrySurfaceNodes]
  );
  const isVariableCondition = (condition?: DialogCondition | null): condition is DialogCondition & {
    type: 'VariableCondition';
    variableName: string;
    value?: string | number | boolean;
    operator?: string;
    negated?: boolean;
  } => Boolean(condition && condition.type === 'VariableCondition' && 'variableName' in condition);

  const isEditableConditionNode = Boolean(selectedNode?.data.kind === 'condition' && selectedNode?.data.provenance?.functionName);

  const parsedRequiresCondition = useMemo(() => {
    if (!selectedEdge || selectedEdge.data?.kind !== 'requires') return null;
    const expression = String(selectedEdge.data.expression || '');
    const match = expression.match(/^([A-Z0-9_]+)\s*(==|!=|<=|>=|<|>)\s*(.+)$/i);
    if (!match?.[1] || !match?.[2]) {
      return null;
    }
    return {
      variableName: match[1].trim(),
      operator: match[2].trim(),
      value: match[3].trim()
    };
  }, [selectedEdge]);

  const canEditMisState = useMemo(() => {
    if (!selectedNode) return false;
    const kind = selectedNode.data.kind;
    return (
      (kind === 'misState' || kind === 'topicStatus' || kind === 'topic') &&
      !!selectedNode.data.variableName &&
      !!selectedNode.data.provenance?.functionName
    );
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedNode) {
      setMisValue('');
      setLogEntryText('');
      return;
    }
    const description = selectedNode.data.description || '';
    const match = description.match(/=\s*(.+)$/);
    if (match?.[1]) {
      setMisValue(match[1].trim());
      return;
    }
    if (description.includes('LOG_RUNNING')) {
      setMisValue('LOG_RUNNING');
      setTopicStatus('LOG_RUNNING');
      return;
    }
    if (description.includes('LOG_SUCCESS')) {
      setMisValue('LOG_SUCCESS');
      setTopicStatus('LOG_SUCCESS');
      return;
    }
    if (description.includes('LOG_FAILED')) {
      setMisValue('LOG_FAILED');
      setTopicStatus('LOG_FAILED');
      return;
    }
    setMisValue('');
    setLogEntryText('');
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedNode || selectedNode.data.kind !== 'condition' || !isVariableCondition(selectedNode.data.condition)) {
      setConditionDraft(null);
      return;
    }

    const variableCondition = selectedNode.data.condition;
    const operator = variableCondition.operator === '!=' ? '!=' : '==';
    setConditionDraft({
      variableName: variableCondition.variableName || '',
      value: variableCondition.value === undefined ? '' : String(variableCondition.value),
      operator,
      negated: Boolean(variableCondition.negated)
    });
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedEdge || selectedEdge.data?.kind !== 'requires') {
      setEdgeVariable('');
      setEdgeOperator('==');
      setEdgeValue('');
      setOriginalEdgeVariable('');
      setOriginalEdgeValue('');
      return;
    }
    if (!parsedRequiresCondition) {
      setEdgeVariable('');
      setEdgeOperator('==');
      setEdgeValue('');
      setOriginalEdgeVariable('');
      setOriginalEdgeValue('');
      return;
    }
    setEdgeVariable(parsedRequiresCondition.variableName);
    setEdgeOperator(parsedRequiresCondition.operator === '!=' ? '!=' : '==');
    setEdgeValue(parsedRequiresCondition.value);
    setOriginalEdgeVariable(parsedRequiresCondition.variableName);
    setOriginalEdgeValue(parsedRequiresCondition.value);
  }, [selectedEdge, parsedRequiresCondition]);

  useEffect(() => {
    if (!selectedEdge || selectedEdge.data?.kind !== 'transitions') {
      setTransitionText('');
      return;
    }
    setTransitionText(String(selectedEdge.label || 'Continue'));
  }, [selectedEdge]);

  const hasComplexExpression = Boolean(
    selectedNode?.data.kind === 'condition' &&
    selectedNode.data.expression &&
    (selectedNode.data.expression.includes('&&') || selectedNode.data.expression.includes('||'))
  );
  const hasUnsupportedRequiresExpression = Boolean(
    selectedEdge?.data?.kind === 'requires' && (!parsedRequiresCondition || !['==', '!='].includes(parsedRequiresCondition.operator))
  );
  const hasUnsupportedConditionNode = Boolean(
    selectedNode?.data.kind === 'condition' && !isVariableCondition(selectedNode?.data.condition)
  );

  const functionName = selectedNode?.data.provenance?.functionName;
  const canAppendTopicStatus = Boolean(
    functionName &&
    selectedNode &&
    (selectedNode.data.kind === 'topic' || selectedNode.data.kind === 'topicStatus' || selectedNode.data.kind === 'dialog')
  );
  const canAppendLogEntry = Boolean(
    functionName &&
    selectedNode &&
    (selectedNode.data.kind === 'topic' || selectedNode.data.kind === 'topicStatus' || selectedNode.data.kind === 'logEntry' || selectedNode.data.kind === 'dialog')
  );

  return (
    <Paper square elevation={0} sx={{ width: 340, height: '100%', borderLeft: 1, borderColor: 'divider', overflow: 'auto' }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Inspector</Typography>
        {entrySurfaceNodes.length > 0 && (
          <Stack spacing={1.25} sx={{ mb: 2 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
              <Typography variant="subtitle2">
                Entry Surfaces ({entrySurfaceNodes.length})
              </Typography>
              {latentEntryCount > 0 && (
                <Chip size="small" color="warning" label={`Latent: ${latentEntryCount}`} />
              )}
            </Stack>
            <Box sx={{ maxHeight: 220, overflow: 'auto', pr: 0.5 }}>
              <Stack spacing={1}>
                {groupedEntrySurfaces.map((group) => (
                  <Stack key={group.source} spacing={0.5}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                      {group.source} ({group.nodes.length})
                    </Typography>
                    {group.nodes.map((node) => (
                      <Button
                        key={node.id}
                        size="small"
                        variant={selectedNode?.id === node.id ? 'contained' : 'text'}
                        onClick={() => onSelectEntrySurfaceNode(node.id)}
                        sx={{
                          justifyContent: 'space-between',
                          textTransform: 'none',
                          px: 1,
                          minHeight: 28
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}
                        >
                          {node.data.label}
                        </Typography>
                        {node.data.latentEntry && (
                          <Chip size="small" color="warning" label="latent" sx={{ height: 16, fontSize: 9 }} />
                        )}
                      </Button>
                    ))}
                  </Stack>
                ))}
              </Stack>
            </Box>
            <Divider />
          </Stack>
        )}
        {!selectedNode && !selectedEdge && (
          <Typography variant="body2" color="text.secondary">
            Select a node or edge to inspect details.
          </Typography>
        )}

        {selectedNode && (
          <Stack spacing={1.5}>
            <Chip size="small" variant="outlined" label={`Node: ${selectedNode.data.kind}`} />
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {selectedNode.data.sourceKind && (
                <Chip size="small" variant="outlined" label={`Source: ${selectedNode.data.sourceKind}`} />
              )}
              {selectedNode.data.entrySurface && (
                <Chip size="small" color="success" label="Entry surface" />
              )}
              {selectedNode.data.latentEntry && (
                <Chip size="small" color="warning" label="Latent entry" />
              )}
            </Stack>
            <Typography variant="subtitle2">{selectedNode.data.label}</Typography>
            <Typography variant="caption" color="text.secondary">
              NPC: {selectedNode.data.npc}
            </Typography>
            {selectedNode.data.description && (
              <Typography variant="body2">{selectedNode.data.description}</Typography>
            )}
            {selectedNode.data.entryReason && (
              <Alert severity="info" sx={{ py: 0 }}>
                {selectedNode.data.entryReason}
              </Alert>
            )}
            {selectedNode.data.expression && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {selectedNode.data.expression}
              </Typography>
            )}
            {selectedNode.data.provenance?.dialogName && (
              <Typography variant="caption" color="text.secondary">
                Dialog: {selectedNode.data.provenance.dialogName}
              </Typography>
            )}
            {selectedNode.data.provenance?.functionName && (
              <Typography variant="caption" color="text.secondary">
                Function: {selectedNode.data.provenance.functionName}
              </Typography>
            )}
            {selectedNode.data.provenance?.filePath && (
              <Typography variant="caption" color="text.secondary">
                File: {selectedNode.data.provenance.filePath}
              </Typography>
            )}

            {hasComplexExpression && (
              <Alert severity="info">
                Complex condition expressions are currently read-only in the inspector.
              </Alert>
            )}

            {writableEnabled && isEditableConditionNode && hasUnsupportedConditionNode && (
              <Alert severity="info">
                This condition node is read-only because only VariableCondition fields are editable in the quest inspector.
              </Alert>
            )}

            {writableEnabled && isEditableConditionNode && conditionDraft && isVariableCondition(selectedNode.data.condition) && (
              <>
                <Divider />
                <Typography variant="subtitle2">Edit Condition (VariableCondition)</Typography>
                <VariableAutocomplete
                  label="Variable Name"
                  value={conditionDraft.variableName}
                  onChange={(value) => setConditionDraft((prev) => prev ? { ...prev, variableName: value } : prev)}
                  onFlush={() => undefined}
                  {...AUTOCOMPLETE_POLICIES.conditions.variableName}
                  semanticModel={semanticModel}
                  fullWidth
                />
                <TextField
                  size="small"
                  label="Operator"
                  value={conditionDraft.operator}
                  onChange={(event) => setConditionDraft((prev) => prev ? { ...prev, operator: event.target.value === '!=' ? '!=' : '==' } : prev)}
                  helperText="Supports == and !="
                />
                <TextField
                  size="small"
                  label="Value"
                  value={conditionDraft.value}
                  onChange={(event) => setConditionDraft((prev) => prev ? { ...prev, value: event.target.value } : prev)}
                />
                <TextField
                  size="small"
                  label="Negated"
                  value={conditionDraft.negated ? 'true' : 'false'}
                  onChange={(event) => setConditionDraft((prev) => prev ? { ...prev, negated: event.target.value.toLowerCase() === 'true' } : prev)}
                  helperText="Set true/false"
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={commandBusy || !conditionDraft.variableName.trim() || selectedNode.data.conditionIndex === undefined || !selectedNode.data.provenance?.functionName}
                  onClick={() => {
                    const targetFunctionName = selectedNode.data.provenance?.functionName;
                    if (!targetFunctionName || selectedNode.data.conditionIndex === undefined) return;
                    onUpdateConditionLink({
                      targetFunctionName,
                      conditionIndex: selectedNode.data.conditionIndex,
                      oldVariableName: selectedNode.data.condition.variableName,
                      oldValue: String(selectedNode.data.condition.value ?? ''),
                      variableName: conditionDraft.variableName.trim(),
                      value: conditionDraft.value.trim(),
                      operator: conditionDraft.operator,
                      negated: conditionDraft.negated
                    });
                  }}
                >
                  Preview Diff
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  disabled={commandBusy || !conditionDraft.variableName.trim() || selectedNode.data.conditionIndex === undefined || !selectedNode.data.provenance?.functionName}
                  onClick={() => {
                    const targetFunctionName = selectedNode.data.provenance?.functionName;
                    if (!targetFunctionName) return;
                    onRemoveConditionLink({
                      targetFunctionName,
                      variableName: conditionDraft.variableName.trim(),
                      value: conditionDraft.value.trim(),
                      operator: conditionDraft.operator,
                      negated: conditionDraft.negated
                    });
                  }}
                >
                  Remove Condition Link
                </Button>
              </>
            )}

            {!writableEnabled && (
              <Alert severity="info">
                Read-only mode is active. Enable writable quest editor to modify graph data.
              </Alert>
            )}

            {writableEnabled && canEditMisState && (
              <>
                <Divider />
                <Typography variant="subtitle2">Edit MIS State</Typography>
                <TextField
                  size="small"
                  label={selectedNode.data.variableName}
                  value={misValue}
                  onChange={(event) => setMisValue(event.target.value)}
                  placeholder="LOG_RUNNING or numeric value"
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={commandBusy || !misValue.trim()}
                  onClick={() => {
                    const nextFunctionName = selectedNode.data.provenance?.functionName;
                    const variableName = selectedNode.data.variableName;
                    if (!nextFunctionName || !variableName) return;
                    onSetMisState({
                      functionName: nextFunctionName,
                      variableName,
                      value: misValue.trim()
                    });
                  }}
                >
                  Preview Diff
                </Button>
              </>
            )}

            {writableEnabled && canAppendTopicStatus && (
              <>
                <Divider />
                <Typography variant="subtitle2">Add Topic Status</Typography>
                <TextField
                  size="small"
                  label="Status"
                  value={topicStatus}
                  onChange={(event) => setTopicStatus(event.target.value)}
                  placeholder="LOG_RUNNING / LOG_SUCCESS / LOG_FAILED"
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={commandBusy || !topicStatus.trim() || !functionName}
                  onClick={() => {
                    if (!functionName) return;
                    onAddTopicStatus({
                      functionName,
                      topic: questName,
                      status: topicStatus.trim()
                    });
                  }}
                >
                  Preview Diff
                </Button>
              </>
            )}

            {writableEnabled && canAppendLogEntry && (
              <>
                <Divider />
                <Typography variant="subtitle2">Add Log Entry</Typography>
                <TextField
                  size="small"
                  multiline
                  minRows={2}
                  label="Entry Text"
                  value={logEntryText}
                  onChange={(event) => setLogEntryText(event.target.value)}
                  placeholder="Quest journal entry"
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={commandBusy || !logEntryText.trim() || !functionName}
                  onClick={() => {
                    if (!functionName) return;
                    onAddLogEntry({
                      functionName,
                      topic: questName,
                      text: logEntryText.trim()
                    });
                  }}
                >
                  Preview Diff
                </Button>
              </>
            )}
          </Stack>
        )}

        {selectedEdge && (
          <Stack spacing={1.5} sx={{ mt: selectedNode ? 2 : 0 }}>
            <Chip size="small" variant="outlined" label={`Edge: ${selectedEdge.data?.kind || 'unknown'}`} />
            <Typography variant="caption" color="text.secondary">
              {selectedEdge.source} {'->'} {selectedEdge.target}
            </Typography>
            {selectedEdge.label && (
              <Typography variant="body2">{String(selectedEdge.label)}</Typography>
            )}
            {selectedEdge.data?.expression && (
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {selectedEdge.data.expression}
              </Typography>
            )}
            {writableEnabled && selectedEdge.data?.kind === 'transitions' && (
              <>
                <TextField
                  size="small"
                  label="Transition Text"
                  value={transitionText}
                  onChange={(event) => setTransitionText(event.target.value)}
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={commandBusy || !transitionText.trim()}
                  onClick={() => onUpdateTransitionText({
                    sourceFunctionName: selectedEdge.source,
                    targetFunctionName: selectedEdge.target,
                    text: transitionText.trim()
                  })}
                >
                  Preview Diff
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  disabled={commandBusy}
                  onClick={() => onRemoveTransition({
                    sourceFunctionName: selectedEdge.source,
                    targetFunctionName: selectedEdge.target
                  })}
                >
                  Remove Transition
                </Button>
              </>
            )}
            {writableEnabled && hasUnsupportedRequiresExpression && (
              <Alert severity="info">
                This condition link is read-only because it is not a simple `VARIABLE == VALUE` or `VARIABLE != VALUE` expression.
              </Alert>
            )}
            {writableEnabled && selectedEdge.data?.kind === 'requires' && (
              !hasUnsupportedRequiresExpression && (
              <>
                <TextField
                  size="small"
                  label="Variable"
                  value={edgeVariable}
                  onChange={(event) => setEdgeVariable(event.target.value)}
                />
                <TextField
                  size="small"
                  label="Operator"
                  value={edgeOperator}
                  onChange={(event) => setEdgeOperator(event.target.value === '!=' ? '!=' : '==')}
                  helperText="Supports == and !="
                />
                <TextField
                  size="small"
                  label="Value"
                  value={edgeValue}
                  onChange={(event) => setEdgeValue(event.target.value)}
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={commandBusy || !edgeVariable.trim() || !edgeValue.trim()}
                  onClick={() => onUpdateConditionLink({
                    targetFunctionName: selectedEdge.target,
                    oldVariableName: originalEdgeVariable || edgeVariable,
                    oldValue: originalEdgeValue || edgeValue,
                    variableName: edgeVariable.trim(),
                    value: edgeValue.trim(),
                    operator: edgeOperator
                  })}
                >
                  Preview Diff
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  disabled={commandBusy || !edgeVariable.trim() || !edgeValue.trim()}
                  onClick={() => onRemoveConditionLink({
                    targetFunctionName: selectedEdge.target,
                    variableName: edgeVariable.trim(),
                    value: edgeValue.trim(),
                    operator: edgeOperator
                  })}
                >
                  Remove Condition Link
                </Button>
              </>
              )
            )}
          </Stack>
        )}

        {commandError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {commandError}
          </Alert>
        )}
      </Box>
    </Paper>
  );
};

export default QuestInspectorPanel;
