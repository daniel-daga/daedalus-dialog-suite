import React, { useMemo } from 'react';
import { Autocomplete, TextField, Box, Typography, Chip, createFilterOptions, TextFieldProps } from '@mui/material';
import { useProjectStore } from '../../store/projectStore';
import { GlobalConstant, GlobalVariable, SemanticModel, GlobalSymbol } from '../../types/global';

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
}

type OptionType = {
  name: string;
  type: string;
  source: 'variable' | 'constant' | 'instance';
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
  allowFreeInput = true,
  sx,
  fullWidth = false,
  isMainField = false,
  mainFieldRef,
  textFieldProps,
  onFlush,
  onKeyDown,
  semanticModel
}) => {
  const { mergedSemanticModel, symbols } = useProjectStore();

  const options = useMemo(() => {
    const opts: OptionType[] = [];
    const filters = typeFilter ? (Array.isArray(typeFilter) ? typeFilter : [typeFilter]) : null;

    // Helper to check type
    const isTypeMatch = (type: string) => {
      if (!filters) return true;
      return filters.includes(type);
    };

    const addedNames = new Set<string>();

    // 1. Add symbols from lightweight index (covers all files)
    if (symbols) {
        symbols.forEach((s: GlobalSymbol) => {
             if (isTypeMatch(s.type)) {
                 if (addedNames.has(s.name)) return;
                 addedNames.add(s.name);

                 opts.push({
                     name: s.name,
                     type: s.type,
                     source: s.value !== undefined ? 'constant' : 'variable',
                     filePath: s.filePath,
                     value: s.value
                 });
             }
        });
    }

    // 2. Add detailed constants/variables from parsed models (might override or add details)
    // Note: Since we prioritize presence, lightweight index is good enough for autocomplete.
    // But we check local semanticModel (passed as prop) which usually has local scope.

    // Local Constants
    if (semanticModel?.constants) {
      Object.values(semanticModel.constants).forEach((c: GlobalConstant) => {
        if (isTypeMatch(c.type)) {
          if (addedNames.has(c.name)) return;
          addedNames.add(c.name);

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

    // Local Variables
    if (semanticModel?.variables) {
      Object.values(semanticModel.variables).forEach((v: GlobalVariable) => {
        if (isTypeMatch(v.type)) {
          if (addedNames.has(v.name)) return;
          addedNames.add(v.name);

          opts.push({
            name: v.name,
            type: v.type,
            source: 'variable',
            filePath: v.filePath
          });
        }
      });
    }

    // Merged Model (parsed files) - technically covered by symbols map for globals,
    // but might have more accurate types if parsing is better than regex.
    // We skip iterating mergedSemanticModel to rely on 'symbols' map for performance
    // and because symbols map covers everything.

    // 3. Add instances (not fully covered by symbols map yet, unless we expand regex)
    // For now, we still rely on mergedSemanticModel for instances, which means
    // instances only show up if parsed.
    // TODO: Expand regex to capture instances too if needed.
    if (showInstances) {
      const instances = { ...mergedSemanticModel.instances, ...semanticModel?.instances };
      if (instances) {
        Object.values(instances).forEach((i: unknown) => {
            const instance = i as InstanceDefinition;
            if (isTypeMatch(instance.parent || 'instance') || !filters) {
                if (addedNames.has(instance.name)) return;
                addedNames.add(instance.name);

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

    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [mergedSemanticModel, semanticModel, symbols, typeFilter, showInstances]);

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
        />
      )}
      sx={sx}
      disableClearable={!allowFreeInput}
    />
  );
};

export default VariableAutocomplete;
