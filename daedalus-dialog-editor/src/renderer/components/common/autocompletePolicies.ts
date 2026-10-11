import { createFilterOptions } from '@mui/material';
import type { VariableAutocompleteProps } from './VariableAutocomplete';

/**
 * The filter every waypoint-list `Autocomplete` takes (#321). A world's
 * waynet is ~2,900 names and MUI's listbox is not virtualized, so a field
 * that opens on focus shows the first 200 matches rather than all of them —
 * `VariableAutocomplete`'s own cap. Typing narrows it as before.
 */
export const waypointFilterOptions = createFilterOptions<string>({ limit: 200 });

type AutocompletePolicy = Pick<
  VariableAutocompleteProps,
  'typeFilter' | 'namePrefix' | 'showInstances' | 'showDialogs' | 'showFunctions' | 'showRoutines' | 'allowCreation'
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
    } as AutocompletePolicy,
    questVariable: {
      namePrefix: 'MIS_'
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
    } as AutocompletePolicy,
    routine: {
      showRoutines: true,
      allowCreation: false
    } as AutocompletePolicy
  }
} as const;
