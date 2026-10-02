import DaedalusParser from '../core/parser';
import type { TreeSitterNode } from './semantic-model';
import type { CodeGeneratable, SourceCall } from './semanticModelInterfaces';

interface CallLayout {
  node: TreeSitterNode;
  name: { start: number; end: number; text: string };
  closeEnd: number;
  arguments: { start: number; end: number; text: string }[];
}

let parser: DaedalusParser | undefined;
const PREFIX = 'func void __action_source() {\n';

/** Read generated call boundaries with the same grammar that parsed the file. */
export function parseActionCall(code: string): CallLayout {
  parser ??= DaedalusParser.create();
  const result = parser.parse(PREFIX + code + '\n};');
  const root = result.rootNode as TreeSitterNode;
  const declarations = root.namedChildren.filter(node => node.type !== 'comment');
  const declaration = declarations[0];
  const body = declaration?.childForFieldName('body');
  const statements = body?.namedChildren.filter(node => node.type !== 'comment') || [];
  const expressions = statements[0]?.namedChildren.filter(node => node.type !== 'comment') || [];
  const node = expressions[0];
  if (result.hasErrors || declarations.length !== 1 || declaration.type !== 'function_declaration'
    || statements.length !== 1 || statements[0].type !== 'expression_statement'
    || expressions.length !== 1 || node.type !== 'call_expression') {
    throw new Error('Cannot reconcile commented action: generated statement must be a valid single call.');
  }

  const name = node.childForFieldName('function')!;
  const open = node.children.find(child => child.type === '(')!;
  const close = node.children.find(child => child.type === ')')!;
  const argsNode = node.childForFieldName('arguments');
  const args = argsNode?.namedChildren.filter(child => child.type !== 'comment') || [];
  const commas = argsNode?.children.filter(child => child.type === ',') || [];
  return {
    node,
    name: { start: name.startIndex - PREFIX.length, end: name.endIndex - PREFIX.length, text: name.text },
    closeEnd: close.endIndex - PREFIX.length,
    arguments: args.map((_arg, index) => {
      const start = (index === 0 ? open.endIndex : commas[index - 1].endIndex) - PREFIX.length;
      const end = (index === args.length - 1 ? close.startIndex : commas[index].startIndex) - PREFIX.length;
      // Include newly authored boundary comments and their physical newlines.
      return { start, end, text: code.slice(start, end).trimStart() };
    })
  };
}

/** Capture editable expression ranges and their original generated values. */
export function captureActionSource(node: TreeSitterNode, action: CodeGeneratable): SourceCall {
  const initial = parseActionCall(action.generateCode({ includeComments: true }));
  const offset = node.startIndex;
  const name = node.childForFieldName('function')!;
  const args = node.childForFieldName('arguments')?.namedChildren.filter(child => child.type !== 'comment') || [];
  if (args.length !== initial.arguments.length) {
    throw new Error('Cannot capture commented action: argument count changed during extraction.');
  }
  const outsideComments: string[] = [];
  const collect = (current: TreeSitterNode) => {
    if (current.type === 'comment') {
      if (!args.some(arg => current.startIndex >= arg.startIndex && current.endIndex <= arg.endIndex)) {
        outsideComments.push(current.text);
      }
      return;
    }
    current.namedChildren.forEach(collect);
  };
  collect(node);
  return {
    version: 1,
    name: { start: name.startIndex - offset, end: name.endIndex - offset, initialValue: initial.name.text },
    closeEnd: node.endIndex - offset,
    arguments: args.map((arg, index) => ({
      start: arg.startIndex - offset,
      end: arg.endIndex - offset,
      initialValue: initial.arguments[index].text.trim()
    })),
    outsideComments
  };
}
