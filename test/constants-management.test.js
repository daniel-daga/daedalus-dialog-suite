const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Constants Management Architecture', async (t) => {
  await t.test('Constants module should exist and export all required constants', () => {
    // Should be able to import constants module
    assert.doesNotThrow(() => {
      const constants = require('../src/utils/constants');

      // Should export major constant categories
      assert.ok(constants.GOTHIC, 'Should export GOTHIC formatting constants');
      assert.ok(constants.PARSING, 'Should export PARSING constants');
      assert.ok(constants.PERFORMANCE, 'Should export PERFORMANCE constants');
      assert.ok(constants.UI, 'Should export UI constants');
      assert.ok(constants.ID_GENERATION, 'Should export ID_GENERATION constants');

    }, 'Constants module should be importable and have required exports');
  });

  await t.test('Gothic formatting constants should be properly defined', () => {
    const { GOTHIC } = require('../src/utils/constants');

    // Gothic standard alignment values
    assert.ok(typeof GOTHIC.STANDARD_ALIGN_COLUMN === 'number' && GOTHIC.STANDARD_ALIGN_COLUMN > 0,
      'Should define STANDARD_ALIGN_COLUMN as positive number');
    assert.ok(typeof GOTHIC.DEFAULT_PROPERTY_ALIGN === 'number' && GOTHIC.DEFAULT_PROPERTY_ALIGN > 0,
      'Should define DEFAULT_PROPERTY_ALIGN as positive number');
    assert.ok(typeof GOTHIC.DEFAULT_ARRAY_ALIGN === 'number' && GOTHIC.DEFAULT_ARRAY_ALIGN > 0,
      'Should define DEFAULT_ARRAY_ALIGN as positive number');
    assert.ok(typeof GOTHIC.MAX_LINE_LENGTH === 'number' && GOTHIC.MAX_LINE_LENGTH > 0,
      'Should define MAX_LINE_LENGTH as positive number');
    assert.ok(typeof GOTHIC.ALIGNMENT_TAB_SIZE === 'number' && GOTHIC.ALIGNMENT_TAB_SIZE > 0,
      'Should define ALIGNMENT_TAB_SIZE as positive number');
  });

  await t.test('Parsing constants should be properly defined', () => {
    const { PARSING } = require('../src/utils/constants');

    assert.strictEqual(PARSING.DECIMAL_RADIX, 10, 'Should define decimal radix as 10');
    assert.ok(typeof PARSING.THROUGHPUT_MULTIPLIER === 'number',
      'Should define throughput multiplier');
    assert.ok(typeof PARSING.MAX_PREVIEW_LENGTH === 'number' && PARSING.MAX_PREVIEW_LENGTH > 0,
      'Should define max preview length');
  });

  await t.test('Performance constants should be properly defined', () => {
    const { PERFORMANCE } = require('../src/utils/constants');

    assert.ok(typeof PERFORMANCE.DEFAULT_DEBOUNCE_MS === 'number' && PERFORMANCE.DEFAULT_DEBOUNCE_MS > 0,
      'Should define default debounce time');
    assert.ok(typeof PERFORMANCE.THROUGHPUT_CALCULATION_MS === 'number',
      'Should define throughput calculation multiplier');
  });

  await t.test('UI constants should be properly defined', () => {
    const { UI } = require('../src/utils/constants');

    assert.ok(typeof UI.MAX_DIALOG_LINES_WARNING === 'number' && UI.MAX_DIALOG_LINES_WARNING > 0,
      'Should define max dialog lines warning threshold');
  });

  await t.test('ID generation constants should be properly defined', () => {
    const { ID_GENERATION } = require('../src/utils/constants');

    assert.ok(typeof ID_GENERATION.RANDOM_STRING_BASE === 'number',
      'Should define random string base');
    assert.ok(typeof ID_GENERATION.SHORT_ID_LENGTH === 'number' && ID_GENERATION.SHORT_ID_LENGTH > 0,
      'Should define short ID length');
    assert.ok(typeof ID_GENERATION.LONG_ID_LENGTH === 'number' && ID_GENERATION.LONG_ID_LENGTH > 0,
      'Should define long ID length');
    assert.ok(typeof ID_GENERATION.ID_START_INDEX === 'number' && ID_GENERATION.ID_START_INDEX >= 0,
      'Should define ID start index for substr');
  });
});

test('Magic Numbers Elimination', async (t) => {
  await t.test('Source files should not contain magic alignment numbers', () => {
    const sourceFiles = [
      'src/parser.js',
      'src/formatter.js'
    ];

    const magicNumbers = [];

    sourceFiles.forEach(filePath => {
      const fullPath = path.join(process.cwd(), filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Check for hardcoded alignment values
        const alignmentMatches = content.match(/(?:alignColumn\s*=\s*|Math\.max\()\s*(?:12|16|32)\b/g);
        if (alignmentMatches) {
          magicNumbers.push({
            file: filePath,
            type: 'alignment',
            matches: alignmentMatches
          });
        }

        // Check for hardcoded line lengths
        const lengthMatches = content.match(/(?:maxLineLength|length.*>\s*|Math\.min.*,\s*)\s*100\b/g);
        if (lengthMatches) {
          magicNumbers.push({
            file: filePath,
            type: 'length',
            matches: lengthMatches
          });
        }
      }
    });

    assert.strictEqual(magicNumbers.length, 0,
      `Found magic numbers in: ${magicNumbers.map(m =>
        `${m.file} (${m.type}: ${m.matches.join(', ')})`
      ).join(', ')}`);
  });

  await t.test('Source files should not contain magic ID generation numbers', () => {
    const sourceFiles = [
      'src/edit-transaction.js',
      'src/editor-integration/validation-bridge.js',
      'src/editor-integration/ast-dialog-ipc-bridge.js'
    ];

    const magicNumbers = [];

    sourceFiles.forEach(filePath => {
      const fullPath = path.join(process.cwd(), filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Check for hardcoded substr values and toString base
        const idMatches = content.match(/(?:toString\(36\)|substr\(2,\s*[59]\))/g);
        if (idMatches) {
          magicNumbers.push({
            file: filePath,
            matches: idMatches
          });
        }
      }
    });

    assert.strictEqual(magicNumbers.length, 0,
      `Found magic ID generation numbers in: ${magicNumbers.map(m =>
        `${m.file} (${m.matches.join(', ')})`
      ).join(', ')}`);
  });

  await t.test('Source files should not contain magic parsing numbers', () => {
    const sourceFiles = [
      'src/parser.js',
      'src/production-ast-semantic-dialog.js',
      'src/ast-semantic-dialog.js'
    ];

    const magicNumbers = [];

    sourceFiles.forEach(filePath => {
      const fullPath = path.join(process.cwd(), filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Check for hardcoded parseInt radix and throughput multiplier
        const parseMatches = content.match(/(?:parseInt\([^,]+,\s*10\)|\/\s*1000\s*\/\/.*per second)/g);
        if (parseMatches) {
          magicNumbers.push({
            file: filePath,
            matches: parseMatches
          });
        }
      }
    });

    assert.strictEqual(magicNumbers.length, 0,
      `Found magic parsing numbers in: ${magicNumbers.map(m =>
        `${m.file} (${m.matches.join(', ')})`
      ).join(', ')}`);
  });
});

test('Constants Integration Validation', async (t) => {
  await t.test('Parser should use constants for formatting', () => {
    const DaedalusParser = require('../src/parser');
    const { GOTHIC } = require('../src/utils/constants');

    const parser = new DaedalusParser();

    // Test that parser operations work with constants
    assert.doesNotThrow(() => {
      const result = parser.parse('instance TestDialog (C_INFO) { npc = TestNPC; }');
      assert.ok(result, 'Parser should work with integrated constants');
    }, 'Parser should work with constants integration');

    // Verify constants are reasonable values
    assert.ok(GOTHIC.STANDARD_ALIGN_COLUMN >= 8 && GOTHIC.STANDARD_ALIGN_COLUMN <= 20,
      'Standard align column should be reasonable (8-20)');
    assert.ok(GOTHIC.MAX_LINE_LENGTH >= 80 && GOTHIC.MAX_LINE_LENGTH <= 150,
      'Max line length should be reasonable (80-150)');
  });

  // Note: ID generation test removed - edit-transaction.js was removed
  // in favor of the new semantic model-based approach which doesn't require
  // transaction IDs for code generation

  await t.test('Performance constants should be configurable', () => {
    const { PERFORMANCE } = require('../src/utils/constants');

    // Should be able to override defaults
    assert.ok(typeof PERFORMANCE.DEFAULT_DEBOUNCE_MS === 'number',
      'Debounce should be configurable number');
    assert.ok(PERFORMANCE.DEFAULT_DEBOUNCE_MS >= 100 && PERFORMANCE.DEFAULT_DEBOUNCE_MS <= 1000,
      'Default debounce should be reasonable (100-1000ms)');
  });
});

test('Constants Configuration Management', async (t) => {
  await t.test('Constants should support environment-based overrides', () => {
    // Test that constants can be configured for different environments
    const originalEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'test';

      // Re-require to get fresh constants
      delete require.cache[require.resolve('../src/utils/constants')];
      const constants = require('../src/utils/constants');

      assert.ok(constants.GOTHIC, 'Constants should be available in test environment');
      assert.ok(typeof constants.GOTHIC.STANDARD_ALIGN_COLUMN === 'number',
        'Constants should have proper types in test environment');

    } finally {
      if (originalEnv !== undefined) {
        process.env.NODE_ENV = originalEnv;
      } else {
        delete process.env.NODE_ENV;
      }
      // Clear cache for future tests
      delete require.cache[require.resolve('../src/utils/constants')];
    }
  });

  await t.test('Constants should provide meaningful defaults', () => {
    const constants = require('../src/utils/constants');

    // Verify all constants have meaningful defaults
    assert.ok(constants.GOTHIC.STANDARD_ALIGN_COLUMN > 0, 'Gothic align should be positive');
    assert.ok(constants.PARSING.DECIMAL_RADIX === 10, 'Decimal radix should be 10');
    assert.ok(constants.PERFORMANCE.DEFAULT_DEBOUNCE_MS > 0, 'Debounce should be positive');
    assert.ok(constants.UI.MAX_DIALOG_LINES_WARNING > 0, 'Warning threshold should be positive');
    assert.ok(constants.ID_GENERATION.RANDOM_STRING_BASE > 0, 'ID base should be positive');
  });
});