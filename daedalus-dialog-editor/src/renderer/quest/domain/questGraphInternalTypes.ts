/**
 * Internal types shared across the quest-graph build pipeline.
 *
 * These types are implementation details of the build pipeline
 * (identifyQuestNodes → buildQuestEdges → filterGraph → calculateDagreLayout)
 * and are not part of the public API.
 */

import type { DialogCondition } from '../../types/global';
import type {
  QuestGraphConditionType,
  QuestGraphEdge,
  QuestGraphNodeKind,
  QuestGraphProvenance,
  QuestGraphSourceKind,
} from '../../types/questGraph';

export interface InternalNodeData {
  id: string;
  type: 'start' | 'update' | 'success' | 'failed' | 'check';
  label: string;
  npc: string;
  description?: string;
  nodeKind: 'function' | 'external-condition';
  expression?: string;
  operator?: 'AND' | 'OR';
  negated?: boolean;
  kind: QuestGraphNodeKind;
  conditionType?: QuestGraphConditionType;
  condition?: DialogCondition;
  conditionIndex?: number;
  conditionExpression?: string;
  conditionCount?: number;
  conditionMode?: 'structured' | 'generic-expression';
  /**
   * Codec-parseable source form of the owner function's conditions, used to
   * prefill the inspector's editable condition field so prefill and re-parse are
   * inverses. Present only when the owner's conditions can round-trip losslessly.
   */
  editableConditionExpression?: string;
  /** Function that actually owns the displayed conditions (info fn or its condition fn). */
  conditionOwnerFunctionName?: string;
  sourceKind: QuestGraphSourceKind;
  entrySurface?: boolean;
  latentEntry?: boolean;
  entryReason?: string;
  inferred: boolean;
  touchesSelectedQuest: boolean;
  provenance?: QuestGraphProvenance;
}

/** Variable-value → producer-function index built during node identification. */
export type ProducerMap = Map<string, Map<string, Set<string>>>;

export interface IdentifyResult {
  nodeDataMap: Map<string, InternalNodeData>;
  producersByVariableAndValue: ProducerMap;
}

export interface EdgeBuildResult {
  edges: QuestGraphEdge[];
  adjacency: Map<string, string[]>;
}

export interface EffectiveConditionEntry {
  condition: DialogCondition;
  ownerFunctionName: string;
  ownerConditionIndex: number;
}
