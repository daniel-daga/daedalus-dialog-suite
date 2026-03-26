import React from 'react';
import { Info as InfoIcon, Check as CheckIcon, Code as CodeIcon, Assignment as AssignmentIcon } from '@mui/icons-material';
import type { SemanticModel } from '../../types/global';
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

export interface ConditionFieldsProps {
  condition: ConditionEditorCondition;
  handleUpdate: (updated: ConditionEditorCondition) => void;
  handleImmediateUpdate: (updated: ConditionEditorCondition) => void;
  flushUpdate: () => void;
  mainFieldRef: React.RefObject<HTMLInputElement>;
  semanticModel?: SemanticModel;
}

interface RegistryEntry {
  icon: React.ReactElement;
  label: (condition: ConditionEditorCondition) => string;
  Fields: React.ComponentType<ConditionFieldsProps>;
}

export const CONDITION_REGISTRY: Record<string, RegistryEntry> = {
  NpcKnowsInfoCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: () => 'NPC Knows Dialog',
    Fields: NpcKnowsInfoFields,
  },
  VariableCondition: {
    icon: <CheckIcon fontSize="small" />,
    label: (c) => ('negated' in c && (c as { negated?: boolean }).negated) ? 'Variable is False' : 'Variable is True',
    Fields: VariableConditionFields,
  },
  NpcHasItemsCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: () => 'NPC Has Items',
    Fields: NpcHasItemsFields,
  },
  NpcIsInStateCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: (c) => ('negated' in c && (c as { negated?: boolean }).negated) ? 'NPC Not In State' : 'NPC Is In State',
    Fields: NpcIsInStateFields,
  },
  NpcIsDeadCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: (c) => ('negated' in c && (c as { negated?: boolean }).negated) ? 'NPC Is Alive' : 'NPC Is Dead',
    Fields: NpcIsDeadFields,
  },
  NpcGetDistToWpCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: () => 'Distance To Waypoint',
    Fields: NpcGetDistToWpFields,
  },
  NpcGetTalentSkillCondition: {
    icon: <InfoIcon fontSize="small" />,
    label: () => 'NPC Talent Skill',
    Fields: NpcGetTalentSkillFields,
  },
  QuestStateCondition: {
    icon: <AssignmentIcon fontSize="small" />,
    label: () => 'Quest-Zustand',
    Fields: QuestStateFields,
  },
  Condition: {
    icon: <CodeIcon fontSize="small" />,
    label: () => 'Custom Condition',
    Fields: ExpressionConditionFields,
  },
};

export const FALLBACK_ENTRY: RegistryEntry = {
  icon: <CodeIcon fontSize="small" />,
  label: () => 'Custom Condition',
  Fields: ExpressionConditionFields,
};

export function getConditionType(condition: ConditionEditorCondition): string {
  if (typeof condition.getTypeName === 'function') {
    return condition.getTypeName();
  }
  return condition.type ?? 'Condition';
}
