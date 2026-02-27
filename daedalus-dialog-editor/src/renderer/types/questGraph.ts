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

export type QuestGraphSourceKind =
  | 'dialog'
  | 'item'
  | 'event'
  | 'startup'
  | 'script'
  | 'external';

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
  sourceKind?: QuestGraphSourceKind;
  entrySurface?: boolean;
  latentEntry?: boolean;
  entryReason?: string;
  inferred?: boolean;
  touchesSelectedQuest?: boolean;
  provenance?: QuestGraphProvenance;
}

export interface QuestGraphEdgeData {
  kind: QuestGraphEdgeKind;
  inferred?: boolean;
  expression?: string;
  operator?: '==' | '!=' | '<' | '>' | '<=' | '>=';
  provenance?: QuestGraphProvenance;
}

export interface QuestGraphBuildOptions {
  onlySelectedQuest?: boolean;
  hideInferredEdges?: boolean;
  showConditions?: boolean;
  showEntrySurfacesOnly?: boolean;
}

export type QuestGraphNode = Node<QuestGraphNodeData>;
export type QuestGraphEdge = Edge<QuestGraphEdgeData>;

export interface QuestGraphData {
  nodes: QuestGraphNode[];
  edges: QuestGraphEdge[];
}
