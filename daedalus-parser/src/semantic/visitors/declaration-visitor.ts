import {
  TreeSitterNode,
  TreeCursor,
  Dialog,
  DialogFunction,
  SemanticModel,
  GlobalConstant,
  GlobalVariable,
  GlobalInstance
} from '../semantic-model';
import { parseLiteralOrIdentifier } from '../parsers/literal-parsing';

export class DeclarationVisitor {
  private semanticModel: SemanticModel;
  private functionNameMap: Map<string, string>;
  private pendingLeadingComments: string[];

  constructor(semanticModel: SemanticModel, functionNameMap: Map<string, string>) {
    this.semanticModel = semanticModel;
    this.functionNameMap = functionNameMap;
    this.pendingLeadingComments = [];
  }

  /**
   * First pass: Create all skeleton objects to ensure they exist before linking
   */
  visit(node: TreeSitterNode): void {
    const cursor = node.walk();
    this.createObjectsRecursively(cursor);
  }

  private createObjectsRecursively(cursor: TreeCursor): void {
    const node = cursor.currentNode;

    // Optimization: Handle root node specifically to skip non-declaration children
    if (node.type === 'program' || node.type === 'source_file') {
      if (cursor.gotoFirstChild()) {
        do {
          const child = cursor.currentNode;
          if (child.type === 'comment') {
            this.pendingLeadingComments.push(child.text);
            continue;
          }
          // Only recurse into declarations we care about
          if (child.type === 'function_declaration' ||
              child.type === 'instance_declaration' ||
              child.type === 'variable_declaration') {
            this.createObjectsRecursively(cursor);
            this.pendingLeadingComments = [];
          } else {
            this.pendingLeadingComments = [];
          }
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
      return;
    }

    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      const typeNode = node.childForFieldName('return_type');
      const keywordNode = node.childForFieldName('keyword');
      if (nameNode && typeNode) {
        const func = new DialogFunction(nameNode.text, typeNode.text);
        const firstLine = node.text.split('\n')[0] || '';
        if (keywordNode) {
          func.keyword = keywordNode.text;
        }
        func.spaceBeforeParen = new RegExp(`${nameNode.text}\\s+\\(`).test(firstLine);
        func.leadingComments = [...this.pendingLeadingComments];
        this.semanticModel.functions[func.name] = func;
        this.semanticModel.declarationOrder?.push({ type: 'function', name: func.name });
        this.functionNameMap.set(func.name.toLowerCase(), func.name);
      }
      return; // Optimization: Don't recurse into function bodies during object creation
    } else if (node.type === 'instance_declaration') {
      const nameNode = node.childForFieldName('name');
      const parentNode = node.childForFieldName('parent');
      const keywordNode = node.childForFieldName('keyword');
      if (nameNode) {
        const parentType = parentNode ? parentNode.text : '';
        const isDialogInstance = parentType.toUpperCase() === 'C_INFO';

        if (isDialogInstance) {
          const dialog = new Dialog(nameNode.text, parentNode ? parentNode.text : null);
          const firstLine = node.text.split('\n')[0] || '';
          if (keywordNode) {
            dialog.keyword = keywordNode.text;
          }
          dialog.spaceBeforeParen = new RegExp(`${nameNode.text}\\s+\\(`).test(firstLine);
          dialog.leadingComments = [...this.pendingLeadingComments];
          this.semanticModel.dialogs[dialog.name] = dialog;
          this.semanticModel.declarationOrder?.push({ type: 'dialog', name: dialog.name });
        } else {
          const instance = new GlobalInstance(nameNode.text, parentType);
          instance.position = {
            startLine: node.startPosition.row + 1,
            startColumn: node.startPosition.column + 1,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column + 1
          };
          instance.range = {
            startIndex: node.startIndex,
            endIndex: node.endIndex
          };

          if (!this.semanticModel.instances) {
            this.semanticModel.instances = {};
          }
          this.semanticModel.instances[instance.name] = instance;

          const upperParent = parentType.toUpperCase();
          if (upperParent === 'C_ITEM' || upperParent === 'C_NPC') {
            const displayName = this.extractInstanceDisplayName(node);
            if (displayName !== undefined) {
              instance.displayName = displayName;
            }
          }

          if (upperParent === 'C_ITEM') {
            if (!this.semanticModel.items) {
              this.semanticModel.items = {};
            }
            this.semanticModel.items[instance.name] = instance;
          }

          if (upperParent === 'C_NPC') {
            if (!this.semanticModel.npcs) {
              this.semanticModel.npcs = {};
            }
            this.semanticModel.npcs[instance.name] = instance;
          }

          if (upperParent === 'C_MDS') {
            if (!this.semanticModel.animations) {
              this.semanticModel.animations = {};
            }
            this.semanticModel.animations[instance.name] = instance;
          }
        }
      }
      return; // Optimization: Don't recurse into instance bodies during object creation
    } else if (node.type === 'variable_declaration') {
      this.createGlobalSymbol(node);
      return;
    }

    // For any other node types (e.g. if passed directly in tests), we don't expect nested declarations
    // so we don't need to recurse.
  }

  private extractInstanceDisplayName(instanceNode: TreeSitterNode): string | undefined {
    const bodyNode = instanceNode.childForFieldName('body');
    if (!bodyNode) {
      return undefined;
    }

    for (const child of bodyNode.namedChildren) {
      if (child.type !== 'assignment_statement') {
        continue;
      }
      const leftNode = child.childForFieldName('left');
      const rightNode = child.childForFieldName('right');
      if (!leftNode || !rightNode) {
        continue;
      }
      if (leftNode.text.toLowerCase() !== 'name' || rightNode.type !== 'string') {
        continue;
      }
      const value = parseLiteralOrIdentifier(rightNode, { normalizeStringLiterals: true });
      return typeof value === 'string' && value.trim() !== '' ? value : undefined;
    }

    return undefined;
  }

  /**
   * Create GlobalConstant or GlobalVariable from variable declaration node
   */
  private createGlobalSymbol(node: TreeSitterNode): void {
    const keywordNode = node.childForFieldName('keyword');
    const typeNode = node.childForFieldName('type');
    const nameNode = node.childForFieldName('name');
    const valueNode = node.childForFieldName('value');

    if (!keywordNode || !typeNode || !nameNode) {
      return;
    }

    const keyword = keywordNode.text.toLowerCase();
    const type = typeNode.text;
    const name = nameNode.text;

    if (keyword === 'const') {
      let value: string | number | boolean = 0;
      if (valueNode) {
        value = parseLiteralOrIdentifier(valueNode);
      }

      const constant = new GlobalConstant(name, type, value);
      constant.position = {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1
      };
      constant.range = {
        startIndex: node.startIndex,
        endIndex: node.endIndex
      };

      if (!this.semanticModel.constants) {
        this.semanticModel.constants = {};
      }
      this.semanticModel.constants[name] = constant;

    } else if (keyword === 'var') {
      const variable = new GlobalVariable(name, type);
      variable.position = {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1
      };
      variable.range = {
        startIndex: node.startIndex,
        endIndex: node.endIndex
      };

      if (!this.semanticModel.variables) {
        this.semanticModel.variables = {};
      }
      this.semanticModel.variables[name] = variable;
    }
  }
}
