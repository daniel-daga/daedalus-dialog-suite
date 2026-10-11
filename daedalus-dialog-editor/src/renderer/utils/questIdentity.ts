export type QuestTopicFilterPolicy = 'missions_only' | 'missions_and_notes';

export const DEFAULT_QUEST_TOPIC_FILTER_POLICY: QuestTopicFilterPolicy = 'missions_and_notes';

const TOPIC_PREFIX_CASE_INSENSITIVE = /^topic_/i;

export const getCanonicalQuestKey = (value: string): string => value.toLowerCase();

export const isCaseInsensitiveMatch = (left: string | null | undefined, right: string | null | undefined): boolean => {
  if (!left || !right) return false;
  return getCanonicalQuestKey(left) === getCanonicalQuestKey(right);
};

export const getQuestMisVariableName = (questTopicName: string): string => {
  return questTopicName.replace(TOPIC_PREFIX_CASE_INSENSITIVE, 'MIS_');
};

export const isQuestTopicConstantByPolicy = (
  constantName: string,
  policy: QuestTopicFilterPolicy = DEFAULT_QUEST_TOPIC_FILTER_POLICY
): boolean => {
  if (constantName.startsWith('TOPIC_')) {
    return true;
  }
  if (policy === 'missions_and_notes' && constantName.startsWith('Topic_')) {
    return true;
  }
  return false;
};

export type QuestLifecycleState = 'running' | 'success' | 'failed' | 'obsolete' | 'unknown';

export const normalizeQuestLifecycleState = (value: unknown): QuestLifecycleState => {
  const normalized = String(value).trim().toUpperCase();

  if (normalized === 'LOG_RUNNING' || normalized === '1') return 'running';
  if (normalized === 'LOG_SUCCESS' || normalized === '2') return 'success';
  if (normalized === 'LOG_FAILED' || normalized === '3') return 'failed';
  if (normalized === 'LOG_OBSOLETE' || normalized === '4') return 'obsolete';

  return 'unknown';
};
