import React, { useMemo } from 'react';
import { Autocomplete, TextField, Box, Typography, Chip, createFilterOptions, TextFieldProps, InputAdornment, IconButton, Tooltip } from '@mui/material';
import { OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { GlobalConstant, GlobalVariable, SemanticModel } from '../../types/global';
import { useNavigation } from '../../hooks/useNavigation';

// Instance definition might not be strictly typed in global types yet
interface InstanceDefinition {
  name: string;
  parent: string;
  filePath?: string;
  [key: string]: any;
}

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
  /** Whether to include instances (e.g. NPCs, items) */
  showInstances?: boolean;
  /** Whether to include dialogs from the project index */
  showDialogs?: boolean;
  /** Whether to allow values that are not in the list */
  allowFreeInput?: boolean;
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
  /** Optional file path to prefer semantic model from editor store */
  filePath?: string;
  /** Whether to show the navigation button (default: true) */
  showNavigation?: boolean;
}

type OptionType = {
  name: string;
  type: string;
  source: 'variable' | 'constant' | 'instance' | 'dialog';
  filePath?: string;
  value?: string | number | boolean;
};

const filter = createFilterOptions<OptionType>();

const VariableAutocomplete = React.memo<VariableAutocompleteProps>(({
  value,
  onChange,
  label,
  placeholder,
  typeFilter,
  showInstances = false,
  showDialogs = false,
  allowFreeInput = true,
  sx,
  fullWidth = false,
  isMainField = false,
  mainFieldRef,
  textFieldProps,
  onFlush,
  onKeyDown,
  semanticModel,
  filePath,
  showNavigation = true
}) => {
  const { mergedSemanticModel, dialogIndex } = useProjectStore();
  const { openFiles } = useEditorStore();
  const { navigateToSymbol, navigateToDialog } = useNavigation();

  const effectiveSemanticModel = useMemo(() => {
    if (filePath) {
      const fileState = openFiles.get(filePath);
      if (fileState?.semanticModel) {
        return fileState.semanticModel;
      }
    }
    return semanticModel;
  }, [filePath, openFiles, semanticModel]);

  const options = useMemo(() => {
    const opts: OptionType[] = [];
    const seenNames = new Set<string>();
    
    const filters = typeFilter ? (Array.isArray(typeFilter) ? typeFilter.map(f => f.toLowerCase()) : [typeFilter.toLowerCase()]) : null;

    // Helper to check type
    const isTypeMatch = (type: string) => {
      if (!filters) return true;
      return filters.includes(type.toLowerCase());
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
          
          if (isTypeMatch(itemType)) {
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
    addFromRecord(effectiveSemanticModel?.constants, 'constant');
    addFromRecord(mergedSemanticModel.constants, 'constant');

    // Add variables
    addFromRecord(effectiveSemanticModel?.variables, 'variable');
    addFromRecord(mergedSemanticModel.variables, 'variable');

    // Add instances
    if (showInstances) {
      addFromRecord(effectiveSemanticModel?.instances, 'instance');
      addFromRecord(mergedSemanticModel.instances, 'instance');
    }

    // Add dialogs
    if (showDialogs && dialogIndex) {
      for (const dialogs of dialogIndex.values()) {
        for (const d of dialogs) {
          const lowerName = d.dialogName.toLowerCase();
          if (!seenNames.has(lowerName) && (isTypeMatch('C_INFO') || !filters)) {
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
  }, [mergedSemanticModel, effectiveSemanticModel, typeFilter, showInstances, showDialogs, dialogIndex]);

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

  return (
    <Autocomplete
      value={value}
      onChange={(_event, newValue) => {
        if (typeof newValue === 'string') {
          onChange(newValue);
        } else if (newValue && newValue.name) {
          onChange(newValue.name);
        } else {
          onChange('');
        }
      }}
      inputValue={value}
      onInputChange={(_event, newInputValue) => {
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
        const filtered = filter(options, params);
        return filtered;
      }}
      freeSolo={allowFreeInput}
      selectOnFocus
      handleHomeEndKeys
      renderOption={(props, option) => {
          // Extract key to avoid passing it to li
          const { key, ...otherProps } = props as any;
          return (
            <li key={key} {...otherProps}>
              <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                    {option.name}
                  </Typography>
                  <Chip
                    label={option.type}
                    size="small"
                    variant="outlined"
                    color={option.source === 'constant' ? 'primary' : option.source === 'instance' ? 'secondary' : 'default'}
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
  );
});

export default VariableAutocomplete;
