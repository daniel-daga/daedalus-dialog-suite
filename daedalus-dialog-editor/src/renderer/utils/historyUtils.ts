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

export interface QuestHistorySnapshot {
  model: SemanticModel;
  nodePositions: Map<string, QuestNodePositionMap>;
}

export interface QuestHistoryState {
  past: QuestHistorySnapshot[];
  future: QuestHistorySnapshot[];
}

/**
 * Extended snapshot used by the unified edit history (dialog + quest surfaces).
 * Includes a timestamp for coalescing rapid edits into a single undo step.
 */
export interface EditSnapshot extends QuestHistorySnapshot {
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

export function cloneSemanticModel(model: SemanticModel): SemanticModel {
  try {
    if (typeof structuredClone === 'function') return structuredClone(model);
  } catch {
    // structuredClone fails on Immer proxy objects (e.g. when called inside a
    // historyStore.set() callback); fall through to the JSON-based clone.
  }
  return JSON.parse(JSON.stringify(model)) as SemanticModel;
}

export function createQuestHistorySnapshot(
  model: SemanticModel,
  fileQuestPositions: Map<string, QuestNodePositionMap> | undefined
): QuestHistorySnapshot {
  return {
    model: cloneSemanticModel(model),
    nodePositions: cloneQuestNodePositionsForFile(fileQuestPositions)
  };
}
