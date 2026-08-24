/**
 * Renderer Content-Security-Policy (docs/architecture/security-model.md).
 *
 * The renderer loads over file:// in production, where `onHeadersReceived`
 * never fires — so the policy has to ship in the document itself, and these
 * assertions are on the HTML entry rather than on a main-process handler.
 *
 * The policy is only as strong as the renderer staying free of the two things
 * that would force a hole in it: an eval consumer, and a remote script origin.
 * Both are guarded here, because both are easy to reintroduce by accident (an
 * `@monaco-editor/react` call site left on its default CDN loader is exactly
 * how the second one gets in).
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect } from '@jest/globals';

const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer');
const INDEX_HTML = path.join(RENDERER_DIR, 'index.html');

const readPolicy = (): string => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
  );
  if (!match) {
    throw new Error('index.html carries no Content-Security-Policy meta tag');
  }
  return match[1];
};

const directive = (policy: string, name: string): string | undefined =>
  policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));

describe('renderer Content-Security-Policy', () => {
  test('index.html ships a CSP meta tag', () => {
    expect(() => readPolicy()).not.toThrow();
  });

  test('defaults to self and locks down the dangerous fetch directives', () => {
    const policy = readPolicy();
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(policy, 'frame-src')).toBe("frame-src 'none'");
  });

  test('grants no eval escape hatch', () => {
    expect(readPolicy()).not.toContain('unsafe-eval');
  });

  test('script-src is self only — no remote origin, no inline', () => {
    const policy = readPolicy();
    expect(directive(policy, 'script-src')).toBe("script-src 'self'");
    // Belt and braces: no scheme-host anywhere in the policy, so a remote
    // origin cannot be smuggled in through a directive this test does not
    // name explicitly.
    expect(policy).not.toMatch(/https?:\/\//);
  });

  test('inline style is allowed but inline script is not', () => {
    // emotion/MUI and Monaco both inject <style> at runtime; that is a style
    // concession only and must not leak into script-src.
    expect(directive(readPolicy(), 'style-src')).toContain("'unsafe-inline'");
  });
});

describe('nothing in the renderer needs a hole in the policy', () => {
  const collect = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? collect(full) : [full];
    });

  const sourceFiles = collect(RENDERER_DIR).filter((file) => /\.tsx?$/.test(file));

  test('no renderer source loads code from a remote origin', () => {
    const offenders = sourceFiles.filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      // Strip comments so the explanatory notes about the CDN we moved off of
      // do not register as the thing they describe.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return /https?:\/\//.test(code);
    });
    expect(offenders).toEqual([]);
  });

  test('Monaco is pinned to a same-origin path, not the default CDN loader', () => {
    const callSites = sourceFiles.filter((file) =>
      fs.readFileSync(file, 'utf8').includes("from '@monaco-editor/react'")
    );
    // If this ever grows, every new call site needs the same treatment.
    expect(callSites).toHaveLength(1);

    const source = fs.readFileSync(callSites[0], 'utf8');
    expect(source).toContain('loader.config(');
    expect(source).toContain("new URL('monaco/vs', document.baseURI)");
  });
});
