/**
 * Pure helper types and functions for quest undo/redo history management.
 * Extracted from editorStore to separate the history concern from the store.
 */

import type { SemanticModel } from '../types/global';

export interface QuestNodePosition {
  x: number;
  y: number;
}

export type QuestNodePositionMap = Map<string, QuestNodePosition>;

/**
 * Snapshot used by the unified edit history (dialog + quest surfaces).
 * The timestamp coalesces rapid edits into a single undo step; quest-surface
 * snapshots use timestamp 0 so later edits never coalesce into them.
 * The model is held by reference (structurally shared with Immer-frozen
 * fileStore state), not deep-cloned.
 */
export interface EditSnapshot {
  model: SemanticModel;
  nodePositions: Map<string, QuestNodePositionMap>;
  timestamp: number;
}

export interface EditHistoryState {
  past: EditSnapshot[];
  future: EditSnapshot[];
}

export interface QuestBatchHistoryState {
  past: string[][];
  future: string[][];
}

export const normalizeBatchFilePaths = (filePaths: string[]): string[] => (
  Array.from(new Set(filePaths.filter((filePath) => filePath.trim().length > 0)))
);

export function cloneQuestNodePositionsForFile(
  positions: Map<string, QuestNodePositionMap> | undefined
): Map<string, QuestNodePositionMap> {
  if (!positions) return new Map();
  const cloned = new Map<string, QuestNodePositionMap>();
  positions.forEach((nodeMap, questName) => {
    const nextNodeMap: QuestNodePositionMap = new Map();
    nodeMap.forEach((position, nodeId) => {
      nextNodeMap.set(nodeId, { x: position.x, y: position.y });
    });
    cloned.set(questName, nextNodeMap);
  });
  return cloned;
}
