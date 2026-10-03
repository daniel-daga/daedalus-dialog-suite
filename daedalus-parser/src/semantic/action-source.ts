import DaedalusParser from '../core/parser';
import type { TreeSitterNode } from './semantic-model';
import type { CodeGeneratable, SourceCall, SourceAssignment } from './semanticModelInterfaces';
import { getAssignmentOperator } from './parsers/ast-constants';

interface CallLayout {
  node: TreeSitterNode;
  name: { start: number; end: number; text: string };
  closeEnd: number;
  arguments: { start: number; end: number; text: string }[];
}

let parser: DaedalusParser | undefined;
const PREFIX = 'func void __action_source() {\n';

function assignmentOperatorNode(node: TreeSitterNode): TreeSitterNode {
  const operator = node.children.find(child => child.type === getAssignmentOperator(node));
  if (!operator) throw new Error('Cannot reconcile commented assignment: missing assignment operator.');
  return operator;
}

/** Read a current single assignment, including comments newly authored in its fields. */
export function parseActionAssignment(code: string) {
  parser ??= DaedalusParser.create();
  const result = parser.parse(PREFIX + code + '\n};');
  const root = result.rootNode as TreeSitterNode;
  const declarations = root.namedChildren.filter(node => node.type !== 'comment');
  const declaration = declarations[0];
  const statements = declaration?.childForFieldName('body')?.namedChildren.filter(node => node.type !== 'comment') || [];
  const node = statements[0];
  if (result.hasErrors || declarations.length !== 1 || declaration.type !== 'function_declaration'
    || statements.length !== 1 || node.type !== 'assignment_statement') {
    throw new Error('Cannot reconcile commented assignment: generated statement must be a valid single assignment.');
  }
  const operator = assignmentOperatorNode(node);
  const semicolon = node.children.find(child => child.type === ';')!;
  return {
    left: { text: code.slice(node.startIndex - PREFIX.length, operator.startIndex - PREFIX.length).trimStart() },
    operator: { text: operator.text },
    right: { text: code.slice(operator.endIndex - PREFIX.length, semicolon.startIndex - PREFIX.length).trimStart() }
  };
}

/** Original expression ranges own their contents; comments in token gaps stay outside edits. */
export function captureAssignmentSource(node: TreeSitterNode, action: CodeGeneratable): SourceAssignment {
  const initial = parseActionAssignment(action.generateCode({ includeComments: true }));
  const range = (part: TreeSitterNode, initialValue: string) => ({
    start: part.startIndex - node.startIndex,
    end: part.endIndex - node.startIndex,
    initialValue: initialValue.trim()
  });
  return {
    version: 1,
    left: range(node.childForFieldName('left')!, initial.left.text),
    operator: range(assignmentOperatorNode(node), initial.operator.text),
    right: range(node.childForFieldName('right')!, initial.right.text)
  };
}

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

/** Comments after a call belong to its complete statement, not its argument list. */
export function getCallStatementSuffix(node: TreeSitterNode): string | undefined {
  const statement = node.parent;
  if (statement?.type !== 'expression_statement' ||
      !statement.namedChildren.some(child => child.type === 'comment' && child.startIndex >= node.endIndex)) {
    return undefined;
  }
  const semicolon = statement.children.find(child => child.type === ';');
  return statement.text.slice(
    node.endIndex - statement.startIndex,
    (semicolon?.startIndex ?? statement.endIndex) - statement.startIndex
  );
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
  const statementSuffix = getCallStatementSuffix(node);
  return {
    version: 1,
    name: { start: name.startIndex - offset, end: name.endIndex - offset, initialValue: initial.name.text },
    closeEnd: node.endIndex - offset,
    arguments: args.map((arg, index) => ({
      start: arg.startIndex - offset,
      end: arg.endIndex - offset,
      initialValue: initial.arguments[index].text.trim()
    })),
    outsideComments,
    ...(statementSuffix === undefined ? {} : { statementSuffix })
  };
}
