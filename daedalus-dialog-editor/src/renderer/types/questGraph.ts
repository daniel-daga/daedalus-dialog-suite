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
  conditionExpression?: string;
  conditionCount?: number;
  conditionMode?: 'structured' | 'generic-expression';
  editableConditionExpression?: string;
  conditionOwnerFunctionName?: string;
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
  choiceIndex?: number;
  provenance?: QuestGraphProvenance;
}

export interface QuestGraphBuildOptions {
  onlySelectedQuest?: boolean;
  hideInferredEdges?: boolean;
  showConditions?: boolean;
  showEntrySurfacesOnly?: boolean;
}

// Editor-owned graph element types; decoupled from any rendering library.
export interface QuestGraphNode {
  id: string;
  position: { x: number; y: number };
  data: QuestGraphNodeData;
  type?: string;
  style?: Record<string, string | number>;
  selectable?: boolean;
  draggable?: boolean;
}

export interface QuestGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  label?: string;
  animated?: boolean;
  markerEnd?: { type: string };
  style?: Record<string, string | number>;
  labelStyle?: Record<string, string | number>;
  data?: QuestGraphEdgeData;
}

export interface QuestGraphData {
  nodes: QuestGraphNode[];
  edges: QuestGraphEdge[];
}

