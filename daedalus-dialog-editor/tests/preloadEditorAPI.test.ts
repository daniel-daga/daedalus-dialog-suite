/**
 * @jest-environment node
 */

/**
 * preload.ts hands `contextBridge` a plain object literal, so TypeScript never
 * compares it with the renderer's `EditorAPI`. The two directions are not
 * equally loud: a method in preload that `EditorAPI` lacks fails to compile at
 * its first renderer call, but a method in `EditorAPI` that preload lacks
 * compiles, passes every Jest suite through `mockAPI`, and throws
 * `window.editorAPI.<x> is not a function` only when a user clicks it in the
 * packaged app (#480).
 *
 * Both sides are read from source, so neither list is maintained by hand.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { describe, test, expect } from '@jest/globals';

const SRC_DIR = path.join(__dirname, '..', 'src');

const parse = (filePath: string): ts.SourceFile =>
  ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);

const editorApiNames = (): string[] => {
  const source = parse(path.join(SRC_DIR, 'renderer', 'types', 'global.d.ts'));
  const iface = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === 'EditorAPI'
  );
  if (!iface) throw new Error('EditorAPI is not declared in src/renderer/types/global.d.ts');
  return iface.members.flatMap((member) => (member.name ? [member.name.getText(source)] : []));
};

const exposedKeys = (): string[] => {
  const file = path.join(SRC_DIR, 'main', 'preload.ts');
  const source = parse(file);

  const exposedValue = (node: ts.Node): ts.Expression | undefined => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'exposeInMainWorld'
    ) {
      return node.arguments[1];
    }
    let found: ts.Expression | undefined;
    node.forEachChild((child) => { found ??= exposedValue(child); });
    return found;
  };

  const exposed = exposedValue(source);
  if (!exposed || !ts.isObjectLiteralExpression(exposed)) {
    throw new Error('src/main/preload.ts exposes no object literal to contextBridge');
  }
  return exposed.properties
    .filter((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property))
    .map((property) => property.name.getText(source));
};

const onlyIn = (names: string[], other: string[]): string[] =>
  names.filter((name) => !other.includes(name));

describe('preload surface', () => {
  test('every name in EditorAPI is a key of the exposed object, and nothing else is', () => {
    const typeNames = editorApiNames();
    const preloadKeys = exposedKeys();

    // An extraction that silently found nothing would make the comparison vacuous.
    expect(typeNames.length).toBeGreaterThan(0);

    expect({
      missingFromPreload: onlyIn(typeNames, preloadKeys),
      missingFromEditorAPI: onlyIn(preloadKeys, typeNames),
    }).toEqual({ missingFromPreload: [], missingFromEditorAPI: [] });
  });
});
