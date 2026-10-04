import DaedalusParser from '../core/parser';
import type { TreeSitterNode } from './semantic-model';
import type { SourceHeader } from './semanticModelInterfaces';

interface HeaderToken {
  text: string;
  startIndex: number;
  endIndex: number;
}

/** The grammar's parameter keyword is hidden; mask AST comments before reading it. */
export function parameterKeyword(node: TreeSitterNode): HeaderToken | undefined {
  const type = node.childForFieldName('type');
  if (!type) return undefined;
  let prefix = node.text.slice(0, type.startIndex - node.startIndex);
  for (const comment of node.namedChildren.filter(child => child.type === 'comment' && child.endIndex <= type.startIndex)) {
    const start = comment.startIndex - node.startIndex;
    const end = comment.endIndex - node.startIndex;
    prefix = prefix.slice(0, start) + ' '.repeat(end - start) + prefix.slice(end);
  }
  const match = /^\s*(var|const)\b/i.exec(prefix);
  if (!match) return undefined;
  const startIndex = node.startIndex + match[0].length - match[1].length;
  return { text: match[1], startIndex, endIndex: startIndex + match[1].length };
}

function headerLayout(node: TreeSitterNode): SourceHeader {
  const body = node.childForFieldName('body');
  if (!body) throw new Error('Declaration has no body');
  const fields: SourceHeader['fields'] = [];
  const add = (key: string, token: HeaderToken | null | undefined) => {
    if (!token) return;
    fields.push({
      key, start: token.startIndex - node.startIndex, end: token.endIndex - node.startIndex,
      initialValue: token.text
    });
  };
  add('keyword', node.childForFieldName('keyword'));
  add('returnType', node.childForFieldName('return_type'));
  add('name', node.childForFieldName('name'));
  add('parent', node.childForFieldName('parent'));
  const parameters = node.childForFieldName('parameters')?.namedChildren.filter(child => child.type === 'parameter') || [];
  parameters.forEach((parameter, index) => {
    add(`parameter:${index}:keyword`, parameterKeyword(parameter));
    add(`parameter:${index}:type`, parameter.childForFieldName('type'));
    add(`parameter:${index}:name`, parameter.childForFieldName('name'));
  });
  const comments: string[] = [];
  const collect = (current: TreeSitterNode) => {
    if (current.startIndex >= body.startIndex) return;
    if (current.type === 'comment') comments.push(current.text);
    else current.namedChildren.forEach(collect);
  };
  collect(node);
  return { version: 1, text: node.text.slice(0, body.startIndex - node.startIndex), fields, comments };
}

export function captureDeclarationHeader(node: TreeSitterNode): SourceHeader | undefined {
  const source = headerLayout(node);
  return source.comments.length > 0 ? source : undefined;
}

/** The declaration, not its body/header, owns comments between `}` and `;`. */
export function captureDeclarationSuffix(node: TreeSitterNode): string | undefined {
  const body = node.childForFieldName('body');
  if (!body || !node.namedChildren.some(child => child.type === 'comment' && child.startIndex >= body.endIndex)) {
    return undefined;
  }
  const semicolon = node.children.find(child => child.type === ';' && child.startIndex >= body.endIndex);
  return node.text.slice(body.endIndex - node.startIndex, (semicolon?.startIndex ?? node.endIndex) - node.startIndex);
}

let parser: DaedalusParser | undefined;

/** Patch current typed tokens while original header trivia remains outside them. */
export function generateDeclarationHeader(canonical: string, previous?: SourceHeader, includeComments = true): string {
  if (!includeComments || !previous) return canonical;
  if (previous.version !== 1) throw new Error('Unsupported declaration header source metadata');
  parser ??= DaedalusParser.create();
  const result = parser.parse(canonical + '\n{};');
  const declarations = result.rootNode.namedChildren.filter(node => node.type !== 'comment') as TreeSitterNode[];
  const declaration = declarations[0];
  if (result.hasErrors || declarations.length !== 1 ||
      !['function_declaration', 'instance_declaration'].includes(declaration?.type)) {
    throw new Error('Edited declaration header must be a valid single function or instance');
  }
  const current = headerLayout(declaration);
  // Added/removed parameters or keywords have no positional correspondence.
  // Header comments are outside the editable tokens, so retain them ahead of
  // the current complete signature rather than replaying an obsolete one.
  if (current.fields.length !== previous.fields.length ||
      current.fields.some(field => !previous.fields.some(original => original.key === field.key))) {
    return previous.comments.join('\n') + '\n' + canonical;
  }
  let text = previous.text;
  const replacements = previous.fields.flatMap(field => {
    const edited = current.fields.find(candidate => candidate.key === field.key)!;
    return edited.initialValue === field.initialValue ? [] : [{ ...field, text: edited.initialValue }];
  });
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end);
  }
  // The generator supplies the newline before `{`, also safely ending a final //.
  return text.trimEnd();
}
