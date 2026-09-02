import React from 'react';
import { Info as InfoIcon, Check as CheckIcon, Code as CodeIcon, Assignment as AssignmentIcon } from '@mui/icons-material';
import type { ConditionEditorCondition } from '../dialogTypes';
import NpcKnowsInfoFields from './NpcKnowsInfoFields';
import VariableConditionFields from './VariableConditionFields';
import NpcHasItemsFields from './NpcHasItemsFields';
import NpcIsInStateFields from './NpcIsInStateFields';
import NpcIsDeadFields from './NpcIsDeadFields';
import NpcGetDistToWpFields from './NpcGetDistToWpFields';
import NpcGetTalentSkillFields from './NpcGetTalentSkillFields';
import QuestStateFields from './QuestStateFields';
import ExpressionConditionFields from './ExpressionConditionFields';

// No `semanticModel` prop (memo-boundary invariant, render-performance.md):
// fields that need model data get it via `useVariableOptions`' own
// per-category store subscriptions inside VariableAutocomplete.
export interface ConditionFieldsProps {
  condition: ConditionEditorCondition;
  handleUpdate: (updated: ConditionEditorCondition) => void;
  handleImmediateUpdate: (updated: ConditionEditorCondition) => void;
  flushUpdate: () => void;
  mainFieldRef: React.RefObject<HTMLInputElement>;
}

interface RegistryEntry {
  icon: React.ReactElement;
  label: (condition: ConditionEditorCondition) => string;
  /** Item text in the Add-condition menu. */
  menuLabel: string;
  /** The condition the Add-condition menu appends. */
  createDefault: () => ConditionEditorCondition;
  Fields: React.ComponentType<ConditionFieldsProps>;
}

export const CONDITION_REGISTRY: Record<string, RegistryEntry> = {
  NpcKnowsInfoCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: (c) => ('negated' in c && (c as { negated?: boolean }).negated) ? 'NPC Does Not Know Dialog' : 'NPC Knows Dialog',
    menuLabel: 'NPC Knows Dialog',
    createDefault: () => ({
      type: 'NpcKnowsInfoCondition',
      npc: 'self',
      dialogRef: '',
      getTypeName: () => 'NpcKnowsInfoCondition'
    }),
    Fields: NpcKnowsInfoFields,
  },
  VariableCondition: {
    icon: <CheckIcon fontSize="small" />,
    label: (c) => ('negated' in c && (c as { negated?: boolean }).negated) ? 'Variable is False' : 'Variable is True',
    menuLabel: 'Variable Check',
    createDefault: () => ({
      type: 'VariableCondition',
      variableName: '',
      negated: false,
      getTypeName: () => 'VariableCondition'
    }),
    Fields: VariableConditionFields,
  },
  NpcHasItemsCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: () => 'NPC Has Items',
    menuLabel: 'NPC Has Items',
    createDefault: () => ({
      type: 'NpcHasItemsCondition',
      npc: 'other',
      item: '',
      operator: '>=',
      value: 1,
      getTypeName: () => 'NpcHasItemsCondition'
    }),
    Fields: NpcHasItemsFields,
  },
  NpcIsInStateCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: (c) => ('negated' in c && (c as { negated?: boolean }).negated) ? 'NPC Not In State' : 'NPC Is In State',
    menuLabel: 'NPC Is In State',
    createDefault: () => ({
      type: 'NpcIsInStateCondition',
      npc: 'self',
      state: 'ZS_Talk',
      negated: false,
      getTypeName: () => 'NpcIsInStateCondition'
    }),
    Fields: NpcIsInStateFields,
  },
  NpcIsDeadCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: (c) => ('negated' in c && (c as { negated?: boolean }).negated) ? 'NPC Is Alive' : 'NPC Is Dead',
    menuLabel: 'NPC Is Dead',
    createDefault: () => ({
      type: 'NpcIsDeadCondition',
      npc: '',
      negated: false,
      getTypeName: () => 'NpcIsDeadCondition'
    }),
    Fields: NpcIsDeadFields,
  },
  NpcGetDistToWpCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: () => 'Distance To Waypoint',
    menuLabel: 'Distance To WP',
    createDefault: () => ({
      type: 'NpcGetDistToWpCondition',
      npc: 'self',
      waypoint: '',
      operator: '<=',
      value: 500,
      getTypeName: () => 'NpcGetDistToWpCondition'
    }),
    Fields: NpcGetDistToWpFields,
  },
  NpcGetTalentSkillCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: () => 'NPC Talent Skill',
    menuLabel: 'Talent Skill',
    createDefault: () => ({
      type: 'NpcGetTalentSkillCondition',
      npc: 'other',
      talent: 'NPC_TALENT_PICKPOCKET',
      operator: '>=',
      value: 1,
      getTypeName: () => 'NpcGetTalentSkillCondition'
    }),
    Fields: NpcGetTalentSkillFields,
  },
  QuestStateCondition: {
    icon: <AssignmentIcon fontSize="small" />,
    label: () => 'Quest-Zustand',
    menuLabel: 'Quest-Zustand',
    createDefault: () => ({
      type: 'QuestStateCondition',
      questVariable: '',
      state: 'LOG_SUCCESS',
      getTypeName: () => 'QuestStateCondition'
    }),
    Fields: QuestStateFields,
  },
  Condition: {
    icon: <CodeIcon fontSize="small" />,
    label: () => 'Custom Condition',
    menuLabel: 'Custom Condition',
    createDefault: () => ({
      type: 'Condition',
      condition: '',
      getTypeName: () => 'Condition'
    }),
    Fields: ExpressionConditionFields,
  },
};

export const FALLBACK_ENTRY: RegistryEntry = CONDITION_REGISTRY.Condition;

export function getConditionType(condition: ConditionEditorCondition): string {
  if (typeof condition.getTypeName === 'function') {
    return condition.getTypeName();
  }
  return condition.type ?? 'Condition';
}
