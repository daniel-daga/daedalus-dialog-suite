import DaedalusParser from '../../core/parser';
import type { TreeSitterNode } from '../semantic-model';
import type { CodeGeneratable } from '../semanticModelInterfaces';

let parser: DaedalusParser | undefined;

function firstCall(node: TreeSitterNode): TreeSitterNode | undefined {
  if (node.type === 'call_expression') return node;
  for (const child of node.namedChildren) {
    const call = firstCall(child);
    if (call) return call;
  }
  return undefined;
}

/** Capture callee ownership from syntax, without a registry of recognized names. */
export function captureCallIdentity(owner: CodeGeneratable, node: TreeSitterNode): void {
  const sourceName = firstCall(node)?.childForFieldName('function')?.text;
  if (!sourceName) return;
  parser ??= DaedalusParser.create();
  // Conditions generate a bare expression, actions a terminated statement; the
  // wrapper holds one statement, so add the terminator a condition lacks (#444).
  const generated = owner.generateCode({ includeComments: true });
  const statement = generated.trimEnd().endsWith(';') ? generated : `${generated};`;
  const result = parser.parse(`func void __call_identity() {\n${statement}\n};`);
  const generatedName = firstCall(result.rootNode as TreeSitterNode)?.childForFieldName('function')?.text;
  if (result.hasErrors || !generatedName) {
    throw new Error('Cannot capture call identity: generated expression must contain a valid call.');
  }
  owner.callIdentity = { version: 1, sourceName, generatedName };
}
