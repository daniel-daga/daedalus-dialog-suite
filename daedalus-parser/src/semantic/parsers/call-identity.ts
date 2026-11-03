import type { TreeSitterNode } from '../semantic-model';
import type { CodeGeneratable } from '../semanticModelInterfaces';

function firstCallName(node: TreeSitterNode): string | undefined {
  if (node.type === 'call_expression') return node.childForFieldName('function')?.text;
  for (const child of node.namedChildren) {
    const name = firstCallName(child);
    if (name) return name;
  }
  return undefined;
}

/**
 * Capture callee ownership from syntax, without a registry of recognized names.
 *
 * The emitted callee is the head of what the owner generates, so read it from
 * that text instead of parsing the text back into a throwaway tree per call
 * (a third of extraction time, #439).
 */
export function captureCallIdentity(owner: CodeGeneratable, node: TreeSitterNode): void {
  const sourceName = firstCallName(node);
  if (!sourceName) return;
  // Conditions generate a bare expression, actions a terminated statement, and
  // a negated condition leads with `!` (#444).
  const head = owner.generateCode({ includeComments: true }).trimStart().replace(/^!\s*/, '');
  const openParen = head.indexOf('(');
  const generatedName = openParen < 0 ? '' : head.slice(0, openParen).trim();
  if (!/^\S+$/.test(generatedName)) {
    throw new Error('Cannot capture call identity: generated expression must contain a valid call.');
  }
  owner.callIdentity = { version: 1, sourceName, generatedName };
}
