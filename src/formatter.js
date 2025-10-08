class DaedalusFormatter {
  constructor(options = {}) {
    this.options = {
      indentSize: 4,
      indentType: 'spaces', // 'spaces' or 'tabs'
      preserveComments: true,
      maxLineLength: 100,
      ...options
    };
    this.parser = null; // Initialize parser only when needed
  }

  /**
   * Format Daedalus source code
   * @param {string} sourceCode - The source code to format
   * @param {Object} parser - Optional parser instance to avoid circular dependency
   * @returns {string} Formatted source code
   */
  format(sourceCode, parser = null) {
    // Use provided parser or create new one
    if (parser) {
      this.parser = parser;
    } else if (!this.parser) {
      const DaedalusParser = require('./parser');
      this.parser = new DaedalusParser();
    }

    const parseResult = this.parser.parse(sourceCode, { includeSource: true });

    if (parseResult.hasErrors) {
      throw new Error('Cannot format code with syntax errors');
    }

    this.sourceCode = sourceCode;
    this.comments = this.parser.extractComments(parseResult);
    this.output = [];
    this.indentLevel = 0;
    this.currentLine = 0;

    // Build comment map by line for easy lookup
    this.commentsByLine = new Map();
    this.comments.forEach(comment => {
      const line = comment.startPosition.row;
      if (!this.commentsByLine.has(line)) {
        this.commentsByLine.set(line, []);
      }
      this.commentsByLine.get(line).push(comment);
    });

    this.formatNode(parseResult.rootNode);

    return this.output.join('');
  }

  /**
   * Format a file from filesystem
   * @param {string} filePath - Path to file
   * @returns {string} Formatted source code
   */
  formatFile(filePath) {
    const fs = require('fs');
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    return this.format(sourceCode);
  }

  /**
   * Format an AST node directly without requiring source code
   * @param {Object} astNode - AST node to format
   * @returns {string} Formatted source code
   */
  formatAST(astNode) {
    this.sourceCode = ''; // No source code available
    this.comments = []; // No original comments to preserve
    this.output = [];
    this.indentLevel = 0;
    this.currentLine = 0;
    this.commentsByLine = new Map();

    this.formatNode(astNode);

    return this.output.join('');
  }

  /**
   * Get indent string based on current level
   * @returns {string} Indent string
   */
  getIndent() {
    const unit = this.options.indentType === 'tabs' ? '\t' : ' '.repeat(this.options.indentSize);
    return unit.repeat(this.indentLevel);
  }

  /**
   * Add content to output with proper indentation
   * @param {string} content - Content to add
   * @param {boolean} addIndent - Whether to add indentation
   */
  write(content, addIndent = false) {
    if (addIndent) {
      this.output.push(this.getIndent());
    }
    this.output.push(content);
  }

  /**
   * Add a newline to output
   */
  newline() {
    this.output.push('\n');
    this.currentLine++;
  }

  /**
   * Insert comments that appear before a given line
   * @param {number} beforeLine - Line number to check for comments
   */
  insertCommentsBeforeLine(beforeLine) {
    if (!this.options.preserveComments) { return; }

    for (let line = this.currentLine; line < beforeLine; line++) {
      const comments = this.commentsByLine.get(line);
      if (comments) {
        comments.forEach(comment => {
          if (!comment.processed) {
            this.write(comment.text, true);
            this.newline();
            comment.processed = true;
          }
        });
      }
    }
  }

  /**
   * Insert inline comments that appear on the same line
   * @param {number} line - Line number to check for comments
   * @param {number} column - Column position
   */
  insertInlineComments(line, column) {
    if (!this.options.preserveComments) { return; }

    const comments = this.commentsByLine.get(line);
    if (comments) {
      const inlineComments = comments.filter(comment =>
        comment.startPosition.column >= column && comment.type === 'line' && !comment.processed
      );

      inlineComments.forEach(comment => {
        this.write(' ');
        this.write(comment.text);
        comment.processed = true;
      });
    }
  }

  /**
   * Format a syntax tree node
   * @param {Object} node - Tree-sitter node or generated AST node
   */
  formatNode(node) {
    if (!node) { return; }

    // Skip comment nodes as they're handled separately (but handle generated comments)
    if (node.type === 'comment') {
      if (this.options.preserveComments) {
        const commentText = node.text || node.content || node.originalText;
        this.write(commentText, true);
        this.newline();
      }
      return;
    }

    // Insert comments that appear before this node (only for tree-sitter nodes)
    if (node.startPosition) {
      this.insertCommentsBeforeLine(node.startPosition.row);
    }

    switch (node.type) {
      case 'program':
        this.formatProgram(node);
        break;
      case 'instance_declaration':
        this.formatInstanceDeclaration(node);
        break;
      case 'function_declaration':
        this.formatFunctionDeclaration(node);
        break;
      case 'block':
        this.formatBlock(node);
        break;
      case 'assignment_statement':
        this.formatAssignmentStatement(node);
        break;
      case 'expression_statement':
        this.formatExpressionStatement(node);
        break;
      case 'blank_line':
        this.formatBlankLine(node);
        break;
      case 'raw_statement':
        this.formatRawStatement(node);
        break;
      case 'if_statement':
        this.formatIfStatement(node);
        break;
      case 'return_statement':
        this.formatReturnStatement(node);
        break;
      case 'call_expression':
        this.formatCallExpression(node);
        break;
      case 'binary_expression':
        this.formatBinaryExpression(node);
        break;
      case 'unary_expression':
        this.formatUnaryExpression(node);
        break;
      case 'array_access':
        this.formatArrayAccess(node);
        break;
      case 'member_access':
        this.formatMemberAccess(node);
        break;
      case 'parenthesized_expression':
        this.formatParenthesizedExpression(node);
        break;
      case 'raw_function':
        // Handle raw function code from generated AST
        this.write(node.code, true);
        this.newline();
        this.newline();
        break;
      case 'identifier':
      case 'string':
      case 'number':
      case 'boolean':
        // Handle terminal nodes through text property (works for both tree-sitter and wrapped nodes)
        this.write(node.text || this.sourceCode.slice(node.startIndex, node.endIndex));
        break;
      case 'argument_list':
        this.formatArgumentList(node);
        break;
      default:
        // Handle unknown node types using tree-sitter API
        if (node.childCount === 0) {
          // Terminal node - use text property or slice from source
          this.write(node.text || this.sourceCode.slice(node.startIndex, node.endIndex));
        } else {
          // Non-terminal node - format children
          for (let i = 0; i < node.childCount; i++) {
            this.formatNode(node.child(i));
          }
        }
        break;
    }
  }


  formatProgram(node) {
    // Use tree-sitter API for all program nodes
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type !== 'comment') {
        this.formatNode(child);

        // Add spacing between top-level declarations
        if (i < node.childCount - 1) {
          this.newline();
          this.newline();
        }
      }
    }

    // Add final newline if content was formatted
    if (this.output.length > 0 && !this.output[this.output.length - 1].endsWith('\n')) {
      this.newline();
    }
  }

  formatInstanceDeclaration(node) {
    // Use tree-sitter API for all instance declarations
    const name = node.childForFieldName('name');
    const parent = node.childForFieldName('parent');
    const body = node.childForFieldName('body');

    this.write('instance ', true);
    this.formatNode(name);
    this.write(' (');
    this.formatNode(parent);
    this.write(')');

    // Check for inline comments on the instance declaration line
    if (node.startPosition) {
      this.insertInlineComments(node.startPosition.row, node.endPosition.column);
    }

    this.newline();
    this.formatNode(body);

    // Only add semicolon for generated nodes (tree-sitter nodes don't include the trailing semicolon)
    if (node._isGeneratedWrapper) {
      this.write(';');
    }
    this.newline();
  }

  formatFunctionDeclaration(node) {
    // Use tree-sitter API for all function declarations
    const returnType = node.childForFieldName('return_type');
    const name = node.childForFieldName('name');
    const parameters = node.childForFieldName('parameters');
    const body = node.childForFieldName('body');

    this.write('func ', true);
    this.formatNode(returnType);
    this.write(' ');
    this.formatNode(name);
    this.write('(');
    if (parameters) {
      this.formatNode(parameters);
    }
    this.write(')');
    this.newline();
    this.formatNode(body);

    // Only add semicolon for generated nodes (tree-sitter nodes don't include the trailing semicolon)
    if (node._isGeneratedWrapper) {
      this.write(';');
    }
    this.newline();
  }

  formatBlock(node) {
    this.write('{', true);
    this.newline();
    this.indentLevel++;

    // Use tree-sitter API for all block nodes
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type !== '{' && child.type !== '}') {
        this.formatNode(child);
      }
    }

    this.indentLevel--;
    this.write('}', true);
  }

  formatAssignmentStatement(node) {
    // Handle both tree-sitter nodes and AST builder nodes
    const left = node.childForFieldName ? node.childForFieldName('left') : node.left;
    const right = node.childForFieldName ? node.childForFieldName('right') : node.right;

    this.write('', true);

    // Enhanced alignment handling for better column formatting
    if (node.alignColumn && left) {
      const propertyName = (left.text && left.text.trim()) || this.extractLeftSideText(left);

      this.write(propertyName);

      if (node.useTabAlignment) {
        // Calculate tabs needed to reach the alignment column
        const currentLength = propertyName.length;
        const tabsNeeded = Math.ceil((node.alignColumn - currentLength) / 8);
        this.write('\t'.repeat(Math.max(1, tabsNeeded)));
      } else {
        // Use space-based alignment
        const padding = Math.max(1, node.alignColumn - propertyName.length);
        this.write(' '.repeat(padding));
      }
      this.write('= ');
    } else if (node.alignColumn) {
      // Legacy handling for nodes without proper left field
      this.formatNode(left);
      const propertyName = this.getLastWrittenLength();
      const padding = Math.max(1, node.alignColumn - propertyName);
      this.write(' '.repeat(padding));
      this.write('= ');
    } else {
      // Default behavior without alignment
      this.formatNode(left);
      this.write(' = ');
    }

    this.formatNode(right);
    this.write(';');

    // Handle inline comments from preserved structure
    if (node.inlineComment) {
      this.write(`\t\t//${node.inlineComment}`);
    } else if (node.startPosition) {
      // Fallback to original inline comment handling
      this.insertInlineComments(node.startPosition.row, node.endPosition.column);
    }
    this.newline();
  }

  /**
   * Extract text representation of the left side of an assignment
   */
  extractLeftSideText(leftNode) {
    if (leftNode.text && leftNode.text.trim()) {
      return leftNode.text;
    }
    if (leftNode.type === 'array_access') {
      // Handle TreeSitterNodeWrapper objects by accessing underlying _node
      const actualNode = leftNode._node || leftNode;
      const arrayNode = actualNode.array;
      const indexNode = actualNode.index;

      const arrayName = arrayNode?.text || arrayNode?.name || arrayNode?.value || 'array';
      const indexName = indexNode?.text || indexNode?.name || indexNode?.value || 'index';
      return `${arrayName}[${indexName}]`;
    }
    if (leftNode.name) {
      return leftNode.name;
    }
    return 'unknown';
  }

  formatExpressionStatement(node) {
    // Use tree-sitter API for all expression statements
    this.write('', true);

    // Format the expression (first non-semicolon child)
    const expression = node.childForFieldName('expression')
                      || (node.childCount > 0 && node.child(0).type !== ';' ? node.child(0) : null);

    if (expression) {
      this.formatNode(expression);
    } else {
      // Fallback: format all non-semicolon children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type !== ';') {
          this.formatNode(child);
        }
      }
    }

    this.write(';');

    // Handle inline comment for generated nodes (using text property)
    if (node.text && this.options.preserveComments) {
      this.write(' // ');
      this.write(node.text);
    }

    // Check for source inline comments
    if (node.startPosition) {
      this.insertInlineComments(node.startPosition.row, node.endPosition.column);
    }

    this.newline();
  }

  formatIfStatement(node) {
    // Use tree-sitter API for all if statements
    const condition = node.childForFieldName('condition');
    const consequence = node.childForFieldName('consequence');
    const alternative = node.childForFieldName('alternative');

    this.write('if (', true);
    this.formatNode(condition);
    this.write(')');
    this.newline();
    this.formatNode(consequence);

    if (alternative) {
      this.newline();
      this.write('else', true);
      this.newline();
      this.formatNode(alternative);
    }

    this.write(';');
    this.newline();
  }

  formatReturnStatement(node) {
    // Use tree-sitter API for all return statements
    const value = node.childForFieldName('value');

    this.write('return', true);
    if (value) {
      this.write(' ');
      this.formatNode(value);
    }
    this.write(';');
    this.newline();
  }

  formatCallExpression(node) {
    // Use tree-sitter API for all call expressions
    const func = node.childForFieldName('function');
    const args = node.childForFieldName('arguments');

    this.formatNode(func);


    this.write('(');
    if (args) {
      this.formatArgumentList(args);
    }
    this.write(')');
  }

  formatArgumentList(node) {
    // Use tree-sitter API for all argument lists
    // Handle both tree-sitter (with comma tokens) and generated (without comma tokens) argument lists

    let hasCommaTokens = false;
    // Check if any child is a comma token (tree-sitter style)
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i).type === ',') {
        hasCommaTokens = true;
        break;
      }
    }

    if (hasCommaTokens) {
      // Tree-sitter style - has comma tokens as children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === ',') {
          this.write(', ');
        } else {
          this.formatNode(child);
        }
      }
    } else {
      // Generated style - only argument expressions, no comma tokens
      for (let i = 0; i < node.childCount; i++) {
        this.formatNode(node.child(i));
        if (i < node.childCount - 1) {
          this.write(', ');
        }
      }
    }
  }

  formatBinaryExpression(node) {
    const left = node.child(0);
    const operator = node.child(1);
    const right = node.child(2);

    this.formatNode(left);
    this.write(' ');
    this.formatNode(operator);
    this.write(' ');
    this.formatNode(right);
  }

  formatUnaryExpression(node) {
    const operator = node.childForFieldName('operator');
    const operand = node.childForFieldName('operand');

    this.formatNode(operator);
    this.formatNode(operand);
  }

  formatArrayAccess(node) {
    // Handle both tree-sitter nodes and AST builder nodes
    const array = node.childForFieldName ? node.childForFieldName('array') : node.array;
    const index = node.childForFieldName ? node.childForFieldName('index') : node.index;

    this.formatNode(array);
    this.write('[');
    this.formatNode(index);
    this.write(']');
  }

  formatMemberAccess(node) {
    const object = node.childForFieldName('object');
    const member = node.childForFieldName('member');

    this.formatNode(object);
    this.write('.');
    this.formatNode(member);
  }

  formatParenthesizedExpression(node) {
    this.write('(');
    for (let i = 1; i < node.childCount - 1; i++) {
      this.formatNode(node.child(i));
    }
    this.write(')');
  }

  /**
   * Format blank line nodes (for preserved structure)
   */
  formatBlankLine(node) {
    this.newline();
  }

  /**
   * Format raw statement nodes (for preserved unknown content)
   */
  formatRawStatement(node) {
    this.write(node.content || node.text || '', true);
    this.newline();
  }
}

module.exports = DaedalusFormatter;
