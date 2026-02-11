import { TreeSitterNode } from '../semantic-model';

/**
 * Parse a tree-sitter argument_list node into normalized argument text values.
 */
export function parseArguments(argsNode: TreeSitterNode): string[] {
  const args: string[] = [];
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (child.type !== ',' && child.type !== '(' && child.type !== ')') {
      args.push(normalizeArgumentText(child));
    }
  }
  return args;
}

/**
 * Normalize argument text, removing only outer quotes for string nodes.
 */
export function normalizeArgumentText(node: TreeSitterNode): string {
  if (node.type === 'string') {
    return node.text.replace(/^"/, '').replace(/"$/, '');
  }
  return node.text.trim();
}
