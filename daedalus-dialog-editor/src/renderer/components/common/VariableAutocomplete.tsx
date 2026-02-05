import React, { useMemo } from 'react';
import { Autocomplete, TextField, Box, Typography, Chip, createFilterOptions, TextFieldProps, InputAdornment, IconButton, Tooltip } from '@mui/material';
import { OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { useProjectStore } from '../../store/projectStore';
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

const VariableAutocomplete: React.FC<VariableAutocompleteProps> = ({
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
  showNavigation = true
}) => {
  const { mergedSemanticModel, dialogIndex } = useProjectStore();
  const { navigateToSymbol, navigateToDialog } = useNavigation();

  const options = useMemo(() => {
    const opts: OptionType[] = [];
    const filters = typeFilter ? (Array.isArray(typeFilter) ? typeFilter : [typeFilter]) : null;

    // Helper to check type
    const isTypeMatch = (type: string) => {
      if (!filters) return true;
      return filters.includes(type);
    };

    // Add constants
    const constants = { ...mergedSemanticModel.constants, ...semanticModel?.constants };
    if (constants) {
      Object.values(constants).forEach((c: GlobalConstant) => {
        if (isTypeMatch(c.type)) {
          // Avoid duplicates if merging
          if (opts.some(o => o.name === c.name)) return;

          opts.push({
            name: c.name,
            type: c.type,
            source: 'constant',
            filePath: c.filePath,
            value: c.value
          });
        }
      });
    }

    // Add variables
    const variables = { ...mergedSemanticModel.variables, ...semanticModel?.variables };
    if (variables) {
      Object.values(variables).forEach((v: GlobalVariable) => {
        if (isTypeMatch(v.type)) {
          if (opts.some(o => o.name === v.name)) return;

          opts.push({
            name: v.name,
            type: v.type,
            source: 'variable',
            filePath: v.filePath
          });
        }
      });
    }

    // Add instances
    if (showInstances) {
      const instances = { ...mergedSemanticModel.instances, ...semanticModel?.instances };
      if (instances) {
        Object.values(instances).forEach((i: unknown) => {
            const instance = i as InstanceDefinition;
            // Instances usually have a class (parent), e.g., C_NPC, C_ITEM.
            // If typeFilter is provided, we might want to match against the class name.
            if (isTypeMatch(instance.parent || 'instance') || !filters) {
                if (opts.some(o => o.name === instance.name)) return;

                opts.push({
                    name: instance.name,
                    type: instance.parent || 'instance',
                    source: 'instance',
                    filePath: instance.filePath
                });
            }
        });
      }
    }

    // Add dialogs
    if (showDialogs && dialogIndex) {
      dialogIndex.forEach((dialogs) => {
        dialogs.forEach((d) => {
          if (isTypeMatch('C_INFO') || !filters) {
            if (opts.some(o => o.name === d.dialogName)) return;

            opts.push({
              name: d.dialogName,
              type: 'C_INFO',
              source: 'dialog',
              filePath: d.filePath
            });
          }
        });
      });
    }

    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [mergedSemanticModel, semanticModel, typeFilter, showInstances, showDialogs, dialogIndex]);

  // Check if current value exists in options (to enable navigation)
  const canNavigate = useMemo(() => {
    if (!value) return false;
    return options.some(o => o.name === value);
  }, [value, options]);

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (value) {
      const option = options.find(o => o.name === value);
      if (option?.source === 'dialog') {
        navigateToDialog(value);
      } else {
        navigateToSymbol(value);
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
};

export default VariableAutocomplete;
