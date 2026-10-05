import DaedalusParser from '../core/parser';
import type { TreeSitterNode } from './semantic-model';

/** Parentheses and comment trivia do not change an identifier's reference identity. */
export function referenceIdentifier(node: TreeSitterNode): string | undefined {
  let current = node;
  while (current.type === 'parenthesized_expression') {
    const operands = current.namedChildren.filter(child => child.type !== 'comment');
    if (operands.length !== 1) return undefined;
    current = operands[0];
  }
  return current.type === 'identifier' ? current.text : undefined;
}

let parser: DaedalusParser | undefined;
const identifiers = new Map<string, string | undefined>();

/** Resolve current model text without stripping quotes or evaluating an expression. */
export function referenceIdentifierFromText(source: string): string | undefined {
  const text = source.trim();
  // Most references are bare names; use the grammar's identifier alphabet.
  if (/^[A-Za-z_\u0080-\u00FF][A-Za-z0-9_\u0080-\u00FF]*$/.test(text)) return text;
  if (identifiers.has(text)) return identifiers.get(text);
  parser ??= DaedalusParser.create();
  const result = parser.parse(`func void __reference_expression() {\n${text}\n};`);
  const declarations = (result.rootNode as TreeSitterNode).namedChildren.filter(node => node.type !== 'comment');
  const declaration = declarations[0];
  const statements = declaration?.childForFieldName('body')?.namedChildren.filter(node => node.type !== 'comment') || [];
  const statement = statements[0];
  const expressions = statement?.namedChildren.filter(node => node.type !== 'comment') || [];
  const name = !result.hasErrors && declarations.length === 1 && declaration.type === 'function_declaration' &&
    statements.length === 1 && statement.type === 'expression_statement' && expressions.length === 1 &&
    !statement.children.some(node => node.type === ';')
    ? referenceIdentifier(expressions[0]) : undefined;
  // Bound the cache: current editor expressions are immutable keys, not model snapshots.
  if (identifiers.size >= 512) identifiers.delete(identifiers.keys().next().value!);
  identifiers.set(text, name);
  return name;
}
