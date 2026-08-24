/**
 * Renderer bundle-split contract (§3 P3 bundle-size finding).
 *
 * Two things this guards, both of which are one careless `import` away from
 * silently regressing — and neither of which a render test would notice, since
 * a statically-imported component renders exactly like a lazy one:
 *
 *  1. The heavyweight, rarely-opened dialogs are `React.lazy` *and* mounted
 *     only while open. The `open`-gate is the half that matters: `lazy` alone
 *     still pulls the chunk on first paint if the element is always rendered
 *     with `open={false}`.
 *  2. `mockAPI.ts` — 600+ lines of browser-harness fake main process — does not
 *     ride into the production Electron bundle. Its only consumer is the
 *     Playwright harness, which runs the Vite *dev* server, so the import is
 *     dynamic behind `import.meta.env.DEV`; Vite substitutes the literal
 *     `false` there in `vite build`, and Rollup drops the branch with it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect } from '@jest/globals';

const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer');
const DIALOG_DETAILS_EDITOR = path.join(RENDERER_DIR, 'components', 'DialogDetailsEditor.tsx');
const MAIN_TSX = path.join(RENDERER_DIR, 'main.tsx');

const read = (filePath: string): string => fs.readFileSync(filePath, 'utf8');

/** Matches `import X from '<specifier>'` / `import { X } from '<specifier>'`. */
const staticallyImports = (source: string, specifier: string): boolean =>
  new RegExp(`^\\s*import\\s[^;]*?from\\s*['"]${specifier}['"]`, 'm').test(source);

const lazyImports = (source: string, specifier: string): boolean =>
  new RegExp(`lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(['"]${specifier}['"]\\)\\s*\\)`).test(source);

const SPLIT_DIALOGS: Array<{ component: string; specifier: string; openFlag: string }> = [
  {
    component: 'DialogSourceViewDialog',
    specifier: './DialogSourceViewDialog',
    openFlag: 'uiState.sourceViewOpen',
  },
  {
    component: 'ReviewChangesDialog',
    specifier: './ReviewChangesDialog',
    openFlag: 'reviewChangesOpen',
  },
  {
    component: 'SimulatorDialog',
    specifier: './Simulator/SimulatorDialog',
    openFlag: 'simulatorOpen',
  },
];

describe('renderer bundle split', () => {
  describe('heavyweight dialogs are code-split and open-gated', () => {
    const source = read(DIALOG_DETAILS_EDITOR);

    test.each(SPLIT_DIALOGS)('$component is lazy, not a static import', ({ component, specifier }) => {
      expect(staticallyImports(source, specifier)).toBe(false);
      expect(lazyImports(source, specifier)).toBe(true);
      // Sanity: the component is genuinely still used, so this is a split and
      // not a leftover assertion about a deleted dialog.
      expect(source).toContain(`<${component}`);
    });

    test.each(SPLIT_DIALOGS)(
      '$component is mounted only while open, so its chunk loads on first use',
      ({ component, openFlag }) => {
        const mountIndex = source.indexOf(`<${component}`);
        expect(mountIndex).toBeGreaterThan(-1);

        // The JSX guard immediately preceding the element must include the open
        // flag — otherwise the element mounts at first paint and `lazy` buys
        // nothing.
        const precedingGuard = source.slice(0, mountIndex).lastIndexOf('&& (');
        const guardLineStart = source.lastIndexOf('\n', precedingGuard);
        const guard = source.slice(guardLineStart, precedingGuard);
        expect(guard).toContain(openFlag);
      }
    );

    test.each(SPLIT_DIALOGS)('$component renders inside a Suspense boundary', ({ component }) => {
      const mountIndex = source.indexOf(`<${component}`);
      const suspenseIndex = source.lastIndexOf('<Suspense', mountIndex);
      expect(suspenseIndex).toBeGreaterThan(-1);
      // No intervening </Suspense> between the boundary and the element.
      expect(source.slice(suspenseIndex, mountIndex)).not.toContain('</Suspense>');
    });
  });

  describe('mockAPI stays out of the production bundle', () => {
    const source = read(MAIN_TSX);

    test('main.tsx does not statically import mockAPI', () => {
      expect(staticallyImports(source, './utils/mockAPI')).toBe(false);
    });

    test('the mock is imported dynamically behind an import.meta.env.DEV gate', () => {
      expect(source).toContain("import('./utils/mockAPI')");

      const importIndex = source.indexOf("import('./utils/mockAPI')");
      const gateIndex = source.lastIndexOf('import.meta.env.DEV', importIndex);
      expect(gateIndex).toBeGreaterThan(-1);

      // The gate must be an early return that skips the import in a production
      // build, not merely a mention somewhere above it.
      expect(source.slice(gateIndex, importIndex)).toMatch(/return;/);
    });

    test('no other renderer module drags mockAPI in statically', () => {
      const offenders: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (/\.tsx?$/.test(entry.name) && full !== path.join(RENDERER_DIR, 'utils', 'mockAPI.ts')) {
            if (/^\s*import\s[^;]*?from\s*['"][^'"]*mockAPI['"]/m.test(read(full))) {
              offenders.push(path.relative(RENDERER_DIR, full));
            }
          }
        }
      };
      walk(RENDERER_DIR);
      expect(offenders).toEqual([]);
    });
  });
});
