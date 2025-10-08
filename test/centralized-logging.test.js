const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Centralized Logging Architecture', async (t) => {
  await t.test('Logger utility should be properly exported and accessible', () => {
    const logger = require('../src/utils/logger');

    // Should export logger factory and convenience methods
    assert.strictEqual(typeof logger.createLogger, 'function', 'Should export createLogger factory');
    assert.strictEqual(typeof logger.Logger, 'function', 'Should export Logger class');
    assert.strictEqual(typeof logger.error, 'function', 'Should export error convenience method');
    assert.strictEqual(typeof logger.warn, 'function', 'Should export warn convenience method');
    assert.strictEqual(typeof logger.info, 'function', 'Should export info convenience method');
    assert.strictEqual(typeof logger.debug, 'function', 'Should export debug convenience method');
  });

  await t.test('Source files should use centralized logging instead of direct console calls', () => {
    const sourceFiles = [
      'src/parser.js',
      'src/production-ast-semantic-dialog.js',
      'src/simplified-production-ast-dialog.js',
      'src/ast-semantic-dialog.js',
      'src/dialog-edit-operations.js',
      'src/edit-transaction.js',
      'src/ast-index-manager.js',
      'src/editor-integration/validation-bridge.js',
      'src/editor-integration/ast-dialog-ipc-bridge.js'
    ];

    const directConsoleCalls = [];

    sourceFiles.forEach(filePath => {
      const fullPath = path.join(process.cwd(), filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Check for direct console calls (excluding logger.js itself)
        const consoleMatches = content.match(/console\.(log|warn|error|debug)/g);
        if (consoleMatches) {
          directConsoleCalls.push({
            file: filePath,
            calls: consoleMatches.length,
            matches: consoleMatches
          });
        }
      }
    });

    // Should not have direct console calls in production code
    assert.strictEqual(directConsoleCalls.length, 0,
      `Found direct console calls in: ${directConsoleCalls.map(f =>
        `${f.file} (${f.calls} calls: ${f.matches.join(', ')})`
      ).join(', ')}`);
  });

  await t.test('Source files should import and use module-specific loggers', () => {
    const sourceFiles = [
      // 'src/parser.js', // Removed - now just a thin wrapper, no logging needed
      'src/production-ast-semantic-dialog.js',
      'src/simplified-production-ast-dialog.js',
      'src/ast-semantic-dialog.js',
      'src/dialog-edit-operations.js'
    ];

    sourceFiles.forEach(filePath => {
      const fullPath = path.join(process.cwd(), filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Should import logger utility
        const hasLoggerImport = content.includes("require('../utils/logger')") ||
                               content.includes("require('./utils/logger')") ||
                               content.includes("const logger = require");

        assert.ok(hasLoggerImport,
          `File ${filePath} should import the logger utility`);

        // Should create module-specific logger instance
        const hasModuleLogger = content.includes('createLogger(') ||
                               content.includes('new Logger(');

        assert.ok(hasModuleLogger,
          `File ${filePath} should create a module-specific logger instance`);
      }
    });
  });

  await t.test('Logger instances should have consistent naming convention', () => {
    const sourceFiles = [
      // 'src/parser.js', // Removed - now just a thin wrapper, no logging needed
      'src/production-ast-semantic-dialog.js',
      'src/simplified-production-ast-dialog.js',
      'src/ast-semantic-dialog.js',
      'src/dialog-edit-operations.js'
    ];

    sourceFiles.forEach(filePath => {
      const fullPath = path.join(process.cwd(), filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Should declare logger variable
        const hasLoggerVariable = content.includes('const logger = ') ||
                                 content.includes('const log = ');

        assert.ok(hasLoggerVariable,
          `File ${filePath} should declare a logger variable`);
      }
    });
  });

  await t.test('Logger configuration should be environment-aware', () => {
    const { Logger } = require('../src/utils/logger');

    // Test production environment behavior
    const originalEnv = process.env.NODE_ENV;
    const originalLogEnabled = process.env.DAEDALUS_LOG_ENABLED;

    try {
      // Test production with no explicit setting
      process.env.NODE_ENV = 'production';
      delete process.env.DAEDALUS_LOG_ENABLED;

      const prodLogger = new Logger('TestLogger');
      assert.strictEqual(prodLogger.enabled, false,
        'Logger should be disabled by default in production');

      // Test production with explicit enable
      process.env.DAEDALUS_LOG_ENABLED = 'true';
      const enabledProdLogger = new Logger('TestLogger');
      assert.strictEqual(enabledProdLogger.enabled, true,
        'Logger should be enabled when explicitly configured in production');

      // Test development environment
      process.env.NODE_ENV = 'development';
      delete process.env.DAEDALUS_LOG_ENABLED;

      const devLogger = new Logger('TestLogger');
      assert.strictEqual(devLogger.enabled, true,
        'Logger should be enabled by default in development');

    } finally {
      // Restore original environment
      if (originalEnv !== undefined) {
        process.env.NODE_ENV = originalEnv;
      } else {
        delete process.env.NODE_ENV;
      }

      if (originalLogEnabled !== undefined) {
        process.env.DAEDALUS_LOG_ENABLED = originalLogEnabled;
      } else {
        delete process.env.DAEDALUS_LOG_ENABLED;
      }
    }
  });
});

test('Logging Integration Validation', async (t) => {
  await t.test('Parser module should use proper logging', () => {
    const DaedalusParser = require('../src/parser');
    const parser = new DaedalusParser();

    // Test that parser operations don't throw errors with logging
    assert.doesNotThrow(() => {
      parser.parse('func void test() {}');
    }, 'Parser should work with integrated logging');
  });

  // Note: Dialog operations test removed - dialog-edit-operations.js was removed
  // in favor of the new semantic model-based approach

});

test('Logging Performance and Configuration', async (t) => {
  await t.test('Disabled loggers should have minimal performance impact', () => {
    const { createLogger } = require('../src/utils/logger');
    const logger = createLogger('PerfTest', 'ERROR'); // High threshold

    const startTime = process.hrtime.bigint();

    // These calls should be very fast when disabled
    for (let i = 0; i < 1000; i++) {
      logger.debug('Debug message that should be ignored');
      logger.info('Info message that should be ignored');
    }

    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1000000;

    // Should complete very quickly (under 10ms for 2000 disabled calls)
    assert.ok(durationMs < 10,
      `Disabled logging should be fast, took ${durationMs.toFixed(2)}ms`);
  });

  await t.test('Logger should support dynamic level changes', () => {
    const { Logger } = require('../src/utils/logger');
    const logger = new Logger('DynamicTest', 'ERROR');

    // Initially should not log debug
    assert.strictEqual(logger.shouldLog(3), false, // DEBUG level
      'Should not log debug at ERROR level');

    // Change level dynamically
    logger.level = logger.parseLogLevel('DEBUG');

    assert.strictEqual(logger.shouldLog(3), true, // DEBUG level
      'Should log debug after changing to DEBUG level');
  });
});