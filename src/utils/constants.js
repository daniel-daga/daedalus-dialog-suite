/**
 * Centralized Constants for Daedalus Parser
 *
 * This module provides all configuration constants used throughout the parser,
 * eliminating magic numbers and providing a single source of truth for values.
 * Constants are organized by domain and support environment-based overrides.
 */

// Gothic Scripting Language Formatting Standards
const GOTHIC = {
  // Standard column alignment for Gothic dialog properties
  STANDARD_ALIGN_COLUMN: 12,

  // Default alignment for regular properties
  DEFAULT_PROPERTY_ALIGN: 16,

  // Default alignment for array properties
  DEFAULT_ARRAY_ALIGN: 32,

  // Maximum line length for Gothic code formatting
  MAX_LINE_LENGTH: 100,

  // Tab size for alignment calculations
  ALIGNMENT_TAB_SIZE: 8,

  // Minimum alignment for calculations
  MIN_ALIGN_COLUMN: 4
};

// Parsing and Language Processing Constants
const PARSING = {
  // Radix for parseInt operations (decimal)
  DECIMAL_RADIX: 10,

  // Multiplier for throughput calculations (bytes per second)
  THROUGHPUT_MULTIPLIER: 1000,

  // Maximum length for source code previews
  MAX_PREVIEW_LENGTH: 100
};

// Performance and Timing Constants
const PERFORMANCE = {
  // Default debounce time for real-time operations (milliseconds)
  DEFAULT_DEBOUNCE_MS: 300,

  // Multiplier for throughput calculations
  THROUGHPUT_CALCULATION_MS: 1000
};

// User Interface Constants
const UI = {
  // Warning threshold for too many dialog lines
  MAX_DIALOG_LINES_WARNING: 20
};

// ID Generation Constants
const ID_GENERATION = {
  // Base for toString() when generating random strings
  RANDOM_STRING_BASE: 36,

  // Length of short random IDs (substr length)
  SHORT_ID_LENGTH: 5,

  // Length of long random IDs (substr length)
  LONG_ID_LENGTH: 9,

  // Start index for substr when generating IDs
  ID_START_INDEX: 2
};

// Environment-aware configuration
function getEnvironmentConstants() {
  const isTest = process.env.NODE_ENV === 'test';
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Allow environment overrides for testing
  if (isTest) {
    return {
      GOTHIC: {
        ...GOTHIC,
        // Smaller values for faster tests
        MAX_LINE_LENGTH: parseInt(process.env.TEST_MAX_LINE_LENGTH) || GOTHIC.MAX_LINE_LENGTH
      },
      PARSING,
      PERFORMANCE: {
        ...PERFORMANCE,
        // Faster debounce for tests
        DEFAULT_DEBOUNCE_MS: parseInt(process.env.TEST_DEBOUNCE_MS) || 50
      },
      UI,
      ID_GENERATION
    };
  }

  if (isDevelopment) {
    return {
      GOTHIC: {
        ...GOTHIC,
        // Allow development overrides
        MAX_LINE_LENGTH: parseInt(process.env.DEV_MAX_LINE_LENGTH) || GOTHIC.MAX_LINE_LENGTH
      },
      PARSING,
      PERFORMANCE: {
        ...PERFORMANCE,
        DEFAULT_DEBOUNCE_MS: parseInt(process.env.DEV_DEBOUNCE_MS) || PERFORMANCE.DEFAULT_DEBOUNCE_MS
      },
      UI,
      ID_GENERATION
    };
  }

  // Production defaults
  return {
    GOTHIC,
    PARSING,
    PERFORMANCE,
    UI,
    ID_GENERATION
  };
}

// Export environment-aware constants
const constants = getEnvironmentConstants();

module.exports = constants;

// Also export individual categories for convenience
module.exports.GOTHIC = constants.GOTHIC;
module.exports.PARSING = constants.PARSING;
module.exports.PERFORMANCE = constants.PERFORMANCE;
module.exports.UI = constants.UI;
module.exports.ID_GENERATION = constants.ID_GENERATION;