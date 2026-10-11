/**
 * Test helper utilities for Daedalus parser tests
 * Provides common setup and assertion functions
 */

const Parser = require('tree-sitter');
const Daedalus = require('../bindings/node');
const { strict: assert } = require('node:assert');

/**
 * Create a configured tree-sitter parser for Daedalus
 * @returns {Parser} Configured parser instance
 */
function createParser() {
  const parser = new Parser();
  parser.setLanguage(Daedalus);
  return parser;
}

/**
 * Assert that a result includes all expected parts
 * @param {string} actual - The actual result string
 * @param {string[]} expectedParts - Array of strings that should be in the result
 * @param {string} [context] - Optional context for better error messages
 */
function assertIncludes(actual, expectedParts, context = 'Result') {
  expectedParts.forEach((part) => {
    assert.ok(
      actual.includes(part),
      `${context} should include "${part}". Got: ${actual.substring(0, 100)}...`
    );
  });
}

/**
 * Assert that a result does not include any of the given parts
 * @param {string} actual - The actual result string
 * @param {string[]} unexpectedParts - Array of strings that should NOT be in the result
 * @param {string} [context] - Optional context for better error messages
 */
function assertExcludes(actual, unexpectedParts, context = 'Result') {
  unexpectedParts.forEach((part) => {
    assert.ok(
      !actual.includes(part),
      `${context} should not include "${part}"`
    );
  });
}

module.exports = {
  createParser,
  assertIncludes,
  assertExcludes
};
