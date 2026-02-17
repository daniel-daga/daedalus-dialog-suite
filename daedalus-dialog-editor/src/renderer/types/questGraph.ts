import type { Edge, Node } from 'reactflow';

export type QuestGraphNodeKind =
  | 'topic'
  | 'topicStatus'
  | 'misState'
  | 'logEntry'
  | 'dialog'
  | 'condition';

export type QuestGraphEdgeKind =
  | 'writes'
  | 'requires'
  | 'transitions'
  | 'references';

export interface QuestGraphProvenance {
  filePath?: string;
  functionName?: string;
  dialogName?: string;
  lineHint?: string;
}

export interface QuestGraphNodeData {
  label: string;
  npc: string;
  description?: string;
  expression?: string;
  type?: string;
  status?: string;
  variableName?: string;
  kind: QuestGraphNodeKind;
  inferred?: boolean;
  touchesSelectedQuest?: boolean;
  provenance?: QuestGraphProvenance;
}

export interface QuestGraphEdgeData {
  kind: QuestGraphEdgeKind;
  inferred?: boolean;
  expression?: string;
  provenance?: QuestGraphProvenance;
}

export interface QuestGraphBuildOptions {
  onlySelectedQuest?: boolean;
  hideInferredEdges?: boolean;
  showConditions?: boolean;
}

export type QuestGraphNode = Node<QuestGraphNodeData>;
export type QuestGraphEdge = Edge<QuestGraphEdgeData>;

export interface QuestGraphData {
  nodes: QuestGraphNode[];
  edges: QuestGraphEdge[];
}
