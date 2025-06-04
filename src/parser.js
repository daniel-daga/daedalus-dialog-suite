const Parser = require('tree-sitter');
const Daedalus = require('../bindings/node');
const { PERFORMANCE } = require('./utils/constants');

class DaedalusParser {
  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Daedalus);
  }

  /**
   * Parse Daedalus source code and return syntax tree
   * @param {string} sourceCode - The Daedalus source code to parse
   * @param {Object} options - Parsing options
   * @returns {Object} Parse tree with metadata
   */
  parse(sourceCode, options = {}) {
    const startTime = process.hrtime.bigint();

    const tree = this.parser.parse(sourceCode);

    const endTime = process.hrtime.bigint();
    const parseTimeMs = Number(endTime - startTime) / 1_000_000;

    const result = {
      tree,
      rootNode: tree.rootNode,
      hasErrors: tree.rootNode.hasError,
      parseTime: parseTimeMs,
      sourceLength: sourceCode.length,
      throughput: sourceCode.length / parseTimeMs * PERFORMANCE.THROUGHPUT_CALCULATION_MS // bytes per second
    };

    if (result.hasErrors) {
      const validation = parser.validate(result.sourceCode);
      result.errors = validation.errors;
    }

    return result;
  }

  /**
   * Parse file from filesystem
   * @param {string} filePath - Path to Daedalus file
   * @param {Object} options - Parsing options
   * @returns {Object} Parse result
   */
  parseFile(filePath, options = {}) {
    const fs = require('fs');
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const result = this.parse(sourceCode, options);
    result.filePath = filePath;
    return result;
  }

  /**
   * Extract all comments from parsed tree
   * @param {Object} parseResult - Result from parse() method
   * @returns {Array} Array of comment objects
   */
  extractComments(parseResult) {
    const comments = [];
    const { rootNode } = parseResult;
    const sourceCode = parseResult.sourceCode || '';

    function findComments(node) {
      if (node.type === 'comment') {
        const text = sourceCode.slice(node.startIndex, node.endIndex);
        comments.push({
          type: text.startsWith('//') ? 'line' : 'block',
          text,
          content: text.startsWith('//')
            ? text.slice(2).trim()
            : text.slice(2, -2).trim(),
          startPosition: node.startPosition,
          endPosition: node.endPosition,
          node
        });
      }

      for (let i = 0; i < node.childCount; i++) {
        findComments(node.child(i));
      }
    }

    findComments(rootNode);
    return comments;
  }

  /**
   * Extract all declarations from parsed tree
   * @param {Object} parseResult - Result from parse() method
   * @returns {Array} Array of declaration objects
   */
  extractDeclarations(parseResult) {
    const declarations = [];
    const { rootNode } = parseResult;

    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);

      if (child.type === 'instance_declaration') {
        declarations.push({
          type: 'instance',
          name: this.getFieldText(child, 'name'),
          parent: this.getFieldText(child, 'parent'),
          startPosition: child.startPosition,
          endPosition: child.endPosition,
          node: child
        });
      } else if (child.type === 'function_declaration') {
        declarations.push({
          type: 'function',
          name: this.getFieldText(child, 'name'),
          returnType: this.getFieldText(child, 'return_type'),
          startPosition: child.startPosition,
          endPosition: child.endPosition,
          node: child
        });
      } else if (child.type === 'variable_declaration') {
        const keyword = this.getFieldText(child, 'keyword');
        declarations.push({
          type: 'variable',
          name: this.getFieldText(child, 'name'),
          varType: this.getFieldText(child, 'type'),
          isConst: keyword && keyword.toLowerCase() === 'const',
          value: this.getFieldText(child, 'value'),
          startPosition: child.startPosition,
          endPosition: child.endPosition,
          node: child
        });
      } else if (child.type === 'class_declaration') {
        declarations.push({
          type: 'class',
          name: this.getFieldText(child, 'name'),
          startPosition: child.startPosition,
          endPosition: child.endPosition,
          node: child
        });
      } else if (child.type === 'prototype_declaration') {
        declarations.push({
          type: 'prototype',
          name: this.getFieldText(child, 'name'),
          parent: this.getFieldText(child, 'parent'),
          startPosition: child.startPosition,
          endPosition: child.endPosition,
          node: child
        });
      }
    }

    return declarations;
  }

  /**
   * Get text content of a named field from a node
   * @private
   */
  getFieldText(node, fieldName) {
    const field = node.childForFieldName(fieldName);
    return field.text;;
  }

  /**
   * Validate Daedalus syntax
   * @param {string} sourceCode - Source code to validate
   * @returns {Object} Validation result
   */
  validate(sourceCode) {
    const parseResult = this.parse(sourceCode);

    const errors = [];
    if (parseResult.hasErrors) {
      this.collectErrors(parseResult.rootNode, sourceCode, errors);
    }

    return {
      isValid: !parseResult.hasErrors,
      errors,
      parseTime: parseResult.parseTime,
      throughput: parseResult.throughput
    };
  }





  /**
   * Collect syntax errors from parse tree
   * @private
   */
  collectErrors(node, sourceCode, errors) {
    if (node.type === 'ERROR') {
      errors.push({
        type: 'syntax_error',
        message: `Syntax error at line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}`,
        position: node.startPosition,
        text: sourceCode.slice(node.startIndex, node.endIndex)
      });
    }

    if (node.isMissing) {
      errors.push({
        type: 'missing_token',
        message: `Missing ${node.type} at line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}`,
        position: node.startPosition,
        text: ''
      });
    }

    for (let i = 0; i < node.childCount; i++) {
      this.collectErrors(node.child(i), sourceCode, errors);
    }
  }

  /**
   * Create a parser instance with error handling
   * @returns {DaedalusParser} Parser instance
   */
  static create() {
    try {
      return new DaedalusParser();
    } catch (error) {
      throw new Error(`Failed to create DaedalusParser: ${error.message}`);
    }
  }
}

module.exports = DaedalusParser;
module.exports.default = DaedalusParser;
module.exports.DaedalusLanguage = Daedalus;
