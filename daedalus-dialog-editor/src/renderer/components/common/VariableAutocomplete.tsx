import React, { useEffect, useMemo, useState } from 'react';
import { Autocomplete, TextField, Box, Typography, Chip, createFilterOptions, TextFieldProps, InputAdornment, IconButton, Tooltip } from '@mui/material';
import { OpenInNew as OpenInNewIcon, Add as AddIcon } from '@mui/icons-material';
import { useProjectStore } from '../../store/projectStore';
import { SemanticModel } from '../../types/global';
import { useNavigation } from '../../hooks/useNavigation';
import VariableCreationDialog from './VariableCreationDialog';

export interface VariableAutocompleteProps {
  /** Current value */
  value: string;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Label for the input */
  label?: string;
  /** Placeholder for the input */
  placeholder?: string;
  /** Filter by variable/constant type (e.g. 'int', 'string') */
  typeFilter?: string | string[];
  /** Filter by name prefix (e.g. 'TOPIC_') */
  namePrefix?: string | string[];
  /** Whether to include instances (e.g. NPCs, items) */
  showInstances?: boolean;
  /** Whether to include dialogs from the project index */
  showDialogs?: boolean;
  /** Whether to allow values that are not in the list */
  allowFreeInput?: boolean;
  /** Whether to allow creating a new variable if not found (default: true) */
  allowCreation?: boolean;
  /** Custom styles */
  sx?: any;
  /** Whether to take full width */
  fullWidth?: boolean;
  /** Whether this is the main field (receives ref) */
  isMainField?: boolean;
  /** Ref for the main input field */
  mainFieldRef?: React.RefObject<HTMLInputElement>;
  /** Additional props to pass to the TextField */
  textFieldProps?: Partial<TextFieldProps>;
  /** Optional callback to flush updates (e.g. onBlur) */
  onFlush?: () => void;
  /** Optional keyboard event handler */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Optional semantic model to merge with global project model */
  semanticModel?: SemanticModel;
  /** Whether to show the navigation button (default: true) */
  showNavigation?: boolean;
}

type OptionType = {
  name: string;
  type: string;
  source: 'variable' | 'constant' | 'instance' | 'dialog' | 'new';
  filePath?: string;
  value?: string | number | boolean;
  isCreationSuggestion?: boolean;
};

const MAX_RESULTS = 200;
const LARGE_LIST_THRESHOLD = 2000;
const MIN_CHARS_FOR_LARGE_LIST = 2;

const filter = createFilterOptions<OptionType>({
  stringify: (option) => `${option.name} ${option.type} ${option.value !== undefined ? option.value : ''}`,
  limit: MAX_RESULTS
});

const VariableAutocomplete = React.memo<VariableAutocompleteProps>(({
  value,
  onChange,
  label,
  placeholder,
  typeFilter,
  namePrefix,
  showInstances = false,
  showDialogs = false,
  allowFreeInput = true,
  allowCreation = true,
  sx,
  fullWidth = false,
  isMainField = false,
  mainFieldRef,
  textFieldProps,
  onFlush,
  onKeyDown,
  semanticModel,
  showNavigation = true
}) => {
  const { mergedSemanticModel, dialogIndex, npcList } = useProjectStore();
  const { navigateToSymbol, navigateToDialog } = useNavigation();
  const [creationDialogOpen, setCreationDialogOpen] = useState(false);
  const [pendingCreationName, setPendingCreationName] = useState('');
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const options = useMemo(() => {
    const opts: OptionType[] = [];
    const seenNames = new Set<string>();
    
    const filters = typeFilter ? (Array.isArray(typeFilter) ? typeFilter.map(f => f.toLowerCase()) : [typeFilter.toLowerCase()]) : null;
    const prefixes = namePrefix ? (Array.isArray(namePrefix) ? namePrefix.map(p => p.toLowerCase()) : [namePrefix.toLowerCase()]) : null;

    // Helper to check type
    const isTypeMatch = (type: string | undefined) => {
      if (!filters) return true;
      if (!type) return false;
      return filters.includes(type.toLowerCase());
    };

    // Helper to check name prefix
    const isNameMatch = (name: string) => {
      if (!prefixes) return true;
      const lowerName = name.toLowerCase();
      return prefixes.some(p => lowerName.startsWith(p));
    };

    // Helper to add options from a Record/Object
    const addFromRecord = (record: Record<string, any> | undefined, source: 'variable' | 'constant' | 'instance') => {
      if (!record) return;
      
      for (const name in record) {
        const item = record[name];
        const lowerName = name.toLowerCase();
        
        if (!seenNames.has(lowerName)) {
          // For instances, check parent class type
          const itemType = source === 'instance' ? (item.parent || 'instance') : item.type;
          
          if (isTypeMatch(itemType) && isNameMatch(name)) {
            opts.push({
              name: item.name || name,
              type: itemType,
              source,
              filePath: item.filePath,
              value: item.value
            });
            seenNames.add(lowerName);
          }
        }
      }
    };

    // Add constants (highest priority for same names)
    addFromRecord(semanticModel?.constants, 'constant');
    addFromRecord(mergedSemanticModel.constants, 'constant');

    // Add variables
    addFromRecord(semanticModel?.variables, 'variable');
    addFromRecord(mergedSemanticModel.variables, 'variable');

    // Add instances
    if (showInstances) {
      addFromRecord(semanticModel?.instances, 'instance');
      addFromRecord(mergedSemanticModel.instances, 'instance');

      // Fallback source: project index NPC list (when semantic instances are unavailable)
      for (const npcName of npcList || []) {
        const lowerName = npcName.toLowerCase();
        if (!seenNames.has(lowerName) && isTypeMatch('C_NPC') && isNameMatch(npcName)) {
          opts.push({
            name: npcName,
            type: 'C_NPC',
            source: 'instance'
          });
          seenNames.add(lowerName);
        }
      }
    }

    // Add dialogs
    if (showDialogs && dialogIndex) {
      for (const dialogs of dialogIndex.values()) {
        for (const d of dialogs) {
          const lowerName = d.dialogName.toLowerCase();
          if (!seenNames.has(lowerName) && isTypeMatch('C_INFO') && isNameMatch(d.dialogName)) {
            opts.push({
              name: d.dialogName,
              type: 'C_INFO',
              source: 'dialog',
              filePath: d.filePath
            });
            seenNames.add(lowerName);
          }
        }
      }
    }

    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [mergedSemanticModel, semanticModel, typeFilter, namePrefix, showInstances, showDialogs, dialogIndex, npcList]);

  // Check if current value exists in options (to enable navigation)
  const canNavigate = useMemo(() => {
    if (!value) return false;
    const lowerValue = value.toLowerCase();
    return options.some(o => o.name.toLowerCase() === lowerValue);
  }, [value, options]);

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (value) {
      const lowerValue = value.toLowerCase();
      const option = options.find(o => o.name.toLowerCase() === lowerValue);
      if (option?.source === 'dialog') {
        navigateToDialog(option.name);
      } else if (option) {
        navigateToSymbol(option.name);
      }
    }
  };

  const handleCreateNew = (name: string) => {
    setPendingCreationName(name);
    setCreationDialogOpen(true);
  };

  return (
    <>
      <Autocomplete
        value={value}
        onChange={(_event, newValue) => {
          if (typeof newValue === 'string') {
            onChange(newValue);
          } else if (newValue && newValue.isCreationSuggestion) {
            handleCreateNew(newValue.name.replace('Add "', '').replace('"', ''));
          } else if (newValue && newValue.name) {
            onChange(newValue.name);
          } else {
            onChange('');
          }
        }}
        inputValue={inputValue}
        onInputChange={(_event, newInputValue) => {
          setInputValue(newInputValue);
          onChange(newInputValue);
        }}
        options={options}
        getOptionLabel={(option) => {
          // Value selected with enter, right from the input
          if (typeof option === 'string') {
            return option;
          }
          // Regular option
          return option.name;
        }}
        filterOptions={(options, params) => {
          const { inputValue } = params;
          const isLargeList = options.length > LARGE_LIST_THRESHOLD;
          const isTooShort = inputValue.length < MIN_CHARS_FOR_LARGE_LIST;
          if (isLargeList && isTooShort) {
            const minimal: OptionType[] = [];
            if (allowCreation && inputValue !== '') {
              minimal.push({
                name: `Add "${inputValue}"`,
                type: 'new',
                source: 'new',
                isCreationSuggestion: true
              });
            }
            return minimal;
          }

          const filtered = filter(options, params);
          
          // Suggest creation if enabled and not found
          if (allowCreation && inputValue !== '') {
            const isExisting = options.some((option) => inputValue.toLowerCase() === option.name.toLowerCase());
            if (!isExisting) {
              filtered.push({
                name: `Add "${inputValue}"`,
                type: 'new',
                source: 'new',
                isCreationSuggestion: true
              });
            }
          }
          
          return filtered;
        }}
        freeSolo={allowFreeInput}
        selectOnFocus
        handleHomeEndKeys
        noOptionsText={
          options.length > LARGE_LIST_THRESHOLD && inputValue.length < MIN_CHARS_FOR_LARGE_LIST
            ? `Type at least ${MIN_CHARS_FOR_LARGE_LIST} characters to search`
            : 'No options'
        }
        renderOption={(props, option) => {
            // Extract key to avoid passing it to li
            const { key, ...otherProps } = props as any;
            return (
              <li key={key} {...otherProps}>
                <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2" sx={{ fontWeight: 'medium', display: 'flex', alignItems: 'center' }}>
                      {option.isCreationSuggestion && <AddIcon sx={{ mr: 1, fontSize: 16 }} />}
                      {option.name}
                    </Typography>
                    <Chip
                      label={option.type}
                      size="small"
                      variant="outlined"
                      color={option.source === 'constant' ? 'primary' : option.source === 'instance' ? 'secondary' : option.source === 'new' ? 'success' : 'default'}
                      sx={{ height: 20, fontSize: '0.65rem' }}
                    />
                  </Box>
                  {option.source === 'constant' && option.value !== undefined && (
                     <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                        Value: {String(option.value)}
                     </Typography>
                  )}
                </Box>
              </li>
            );
        }}
        fullWidth={fullWidth}
        renderInput={(params) => (
          <TextField
            {...params}
            {...textFieldProps}
            label={label}
            placeholder={placeholder}
            size="small"
            inputRef={isMainField ? mainFieldRef : undefined}
            onBlur={onFlush}
            onKeyDown={onKeyDown}
            sx={sx}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <React.Fragment>
                  {showNavigation && canNavigate && (
                    <InputAdornment position="end" sx={{ mr: 1 }}>
                      <Tooltip title="Follow reference" arrow>
                        <IconButton
                          size="small"
                          onClick={handleNavigate}
                          edge="end"
                          onMouseDown={(e) => e.preventDefault()} // Prevent blur when clicking icon
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  )}
                  {params.InputProps.endAdornment}
                </React.Fragment>
              )
            }}
          />
        )}
        sx={sx}
        disableClearable={!allowFreeInput}
      />

      <VariableCreationDialog
        open={creationDialogOpen}
        onClose={() => setCreationDialogOpen(false)}
        initialName={pendingCreationName}
        isConstant={pendingCreationName.toUpperCase() === pendingCreationName && pendingCreationName.includes('_')}
      />
    </>
  );
});

export default VariableAutocomplete;
