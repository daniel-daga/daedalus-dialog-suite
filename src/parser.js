const Parser = require('tree-sitter');
const Daedalus = require('../bindings/node');

class DaedalusParser {
  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Daedalus);
  }

  /**
   * Parse Daedalus source code and return syntax tree
   * @param {string} sourceCode - The Daedalus source code to parse
   * @param {Object} options - Parsing options
   * @param {boolean} options.includeSource - Include source text in nodes
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
      throughput: sourceCode.length / parseTimeMs * 1000, // bytes per second
    };

    if (options.includeSource) {
      result.sourceCode = sourceCode;
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
   * Extract all declarations from parsed tree
   * @param {Object} parseResult - Result from parse() method
   * @returns {Array} Array of declaration objects
   */
  extractDeclarations(parseResult) {
    const declarations = [];
    const rootNode = parseResult.rootNode;

    for (let i = 0; i < rootNode.childCount; i++) {
      const child = rootNode.child(i);

      if (child.type === 'instance_declaration') {
        declarations.push({
          type: 'instance',
          name: this.getFieldText(child, 'name', parseResult.sourceCode),
          parent: this.getFieldText(child, 'parent', parseResult.sourceCode),
          startPosition: child.startPosition,
          endPosition: child.endPosition,
          node: child
        });
      } else if (child.type === 'function_declaration') {
        declarations.push({
          type: 'function',
          name: this.getFieldText(child, 'name', parseResult.sourceCode),
          returnType: this.getFieldText(child, 'return_type', parseResult.sourceCode),
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
  getFieldText(node, fieldName, sourceCode) {
    const field = node.childForFieldName(fieldName);
    return field ? sourceCode.slice(field.startIndex, field.endIndex) : null;
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
        message: `Unexpected token at line ${node.startPosition.row + 1}`,
        position: node.startPosition,
        text: sourceCode.slice(node.startIndex, node.endIndex)
      });
    }

    for (let i = 0; i < node.childCount; i++) {
      this.collectErrors(node.child(i), sourceCode, errors);
    }
  }
}

module.exports = DaedalusParser;