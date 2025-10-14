/**
 * Utility functions for dialog editing
 */

/**
 * Generate a unique function name for a choice's target function
 * Format: <DialogName>_Choice_<Number>
 */
export const generateUniqueChoiceFunctionName = (dialogName: string, semanticModel: any): string => {
  const baseName = `${dialogName}_Choice`;
  let counter = 1;
  let candidateName = `${baseName}_${counter}`;

  // Keep incrementing until we find a unique name
  while (semanticModel.functions && semanticModel.functions[candidateName]) {
    counter++;
    candidateName = `${baseName}_${counter}`;
  }

  return candidateName;
};

/**
 * Create a new empty function in the semantic model
 */
export const createEmptyFunction = (functionName: string): any => {
  return {
    name: functionName,
    returnType: 'void',
    calls: [],
    actions: []
  };
};

/**
 * Validate function name for choice target functions
 * Returns error message if invalid, null if valid
 */
export const validateChoiceFunctionName = (
  functionName: string,
  requiredPrefix: string,
  semanticModel: any,
  originalFunctionName?: string
): string | null => {
  if (!functionName || functionName.trim() === '') {
    return 'Function name cannot be empty';
  }

  if (!functionName.startsWith(requiredPrefix)) {
    return `Function name must start with "${requiredPrefix}"`;
  }

  // Check uniqueness (skip if it's the same as original - meaning no rename)
  if (functionName !== originalFunctionName && semanticModel?.functions?.[functionName]) {
    return 'Function name already exists';
  }

  return null;
};
