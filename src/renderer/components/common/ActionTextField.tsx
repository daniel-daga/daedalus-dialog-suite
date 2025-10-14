import React from 'react';
import { TextField, TextFieldProps } from '@mui/material';

/**
 * Props for ActionTextField (extends MUI TextFieldProps)
 */
export interface ActionTextFieldProps extends Omit<TextFieldProps, 'size' | 'onBlur' | 'onKeyDown' | 'onChange' | 'value'> {
  /** Current value */
  value: string | number;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Optional callback to flush updates (e.g., to parent state) */
  onFlush?: () => void;
  /** Optional keyboard event handler */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Whether this is the main field (will receive inputRef) */
  isMainField?: boolean;
  /** Main field ref (only used if isMainField is true) */
  mainFieldRef?: React.RefObject<HTMLInputElement>;
}

/**
 * Standardized text field for action renderers
 * Pre-configured with common props and consistent behavior
 */
const ActionTextField: React.FC<ActionTextFieldProps> = ({
  value,
  onChange,
  onFlush,
  onKeyDown,
  isMainField = false,
  mainFieldRef,
  ...textFieldProps
}) => {
  return (
    <TextField
      {...textFieldProps}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      size="small"
      onBlur={onFlush}
      onKeyDown={onKeyDown}
      inputRef={isMainField ? mainFieldRef : undefined}
    />
  );
};

export default ActionTextField;
