import type { VariableAutocompleteProps } from './VariableAutocomplete';

type AutocompletePolicy = Pick<
  VariableAutocompleteProps,
  'typeFilter' | 'namePrefix' | 'showInstances' | 'showDialogs' | 'allowCreation'
>;

export const AUTOCOMPLETE_POLICIES = {
  conditions: {
    npc: {
      showInstances: true,
      typeFilter: 'C_NPC'
    } as AutocompletePolicy,
    npcKnowsDialog: {
      showInstances: true,
      showDialogs: true,
      typeFilter: 'C_INFO',
      namePrefix: 'DIA_'
    } as AutocompletePolicy,
    variableName: {
      typeFilter: ['int', 'string', 'float']
    } as AutocompletePolicy,
    item: {
      showInstances: true,
      typeFilter: 'C_ITEM'
    } as AutocompletePolicy
  },
  dialogProperties: {
    npc: {
      showInstances: true,
      typeFilter: 'C_NPC'
    } as AutocompletePolicy,
    description: {
      typeFilter: 'string',
      namePrefix: 'DIALOG_'
    } as AutocompletePolicy
  },
  actions: {
    npc: {
      showInstances: true,
      typeFilter: 'C_NPC'
    } as AutocompletePolicy,
    animation: {
      showInstances: true,
      typeFilter: 'C_MDS',
      allowCreation: false
    } as AutocompletePolicy,
    item: {
      showInstances: true,
      typeFilter: 'C_ITEM'
    } as AutocompletePolicy,
    topic: {
      typeFilter: 'string',
      namePrefix: 'TOPIC_'
    } as AutocompletePolicy,
    intVariable: {
      typeFilter: 'int'
    } as AutocompletePolicy,
    setVariableName: {
      typeFilter: ['int', 'string', 'float']
    } as AutocompletePolicy,
    npcNoInstances: {
      typeFilter: 'C_NPC'
    } as AutocompletePolicy
  }
} as const;
