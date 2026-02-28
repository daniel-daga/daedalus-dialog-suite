import type { Edge, Node } from 'reactflow';
import type { DialogCondition } from './global';

export type QuestGraphNodeKind =
  | 'topic'
  | 'topicStatus'
  | 'misState'
  | 'logEntry'
  | 'dialog'
  | 'condition'
  | 'logical';

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

export type QuestGraphConditionType =
  | 'VariableCondition'
  | 'NpcKnowsInfoCondition'
  | 'NpcHasItemsCondition'
  | 'NpcIsInStateCondition'
  | 'NpcIsDeadCondition'
  | 'NpcGetDistToWpCondition'
  | 'NpcGetTalentSkillCondition'
  | 'Condition'
  | 'LogicalCondition'
  | 'ExternalTriggerCondition';

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
  operator?: 'AND' | 'OR';
  negated?: boolean;
  type?: string;
  conditionType?: QuestGraphConditionType;
  status?: string;
  variableName?: string;
  condition?: DialogCondition;
  conditionIndex?: number;
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
