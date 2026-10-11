import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards the quest-editor layering contract (docs/architecture/quest-editor.md):
 * `quest/domain/*` is pure logic and must not depend on UI libraries or the
 * QuestEditor UI tree, and the shared graph types must not pull in reactflow.
 */

const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer');
const DOMAIN_DIR = path.join(RENDERER_DIR, 'quest', 'domain');
const QUEST_GRAPH_TYPES = path.join(RENDERER_DIR, 'types', 'questGraph.ts');

const FORBIDDEN_MODULES = ['react', 'react-dom', 'reactflow', '@mui', 'litegraph.js', 'dagre', 'electron', 'zustand'];

const collectFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(fullPath) : [fullPath];
  });

const getImportSources = (filePath: string): string[] => {
  const source = fs.readFileSync(filePath, 'utf8');
  const importPattern = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
  const sources: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source)) !== null) {
    sources.push(match[1]);
  }
  return sources;
};

describe('quest domain boundary', () => {
  const domainFiles = collectFiles(DOMAIN_DIR);

  it('contains the quest logic modules (not just shims)', () => {
    expect(domainFiles.length).toBeGreaterThanOrEqual(8);
  });

  it('carries no command write path (removed with the Flow view)', () => {
    const commandFiles = domainFiles.filter((file) =>
      file.includes(`${path.sep}commands${path.sep}`)
    );
    expect(commandFiles).toEqual([]);
  });

  it('does not import UI libraries from domain modules or graph types', () => {
    const violations: string[] = [];
    for (const file of [...domainFiles, QUEST_GRAPH_TYPES]) {
      for (const source of getImportSources(file)) {
        const forbidden = FORBIDDEN_MODULES.some(
          (mod) => source === mod || source.startsWith(`${mod}/`)
        );
        if (forbidden) {
          violations.push(`${path.relative(RENDERER_DIR, file)} imports "${source}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not import from the QuestEditor UI tree', () => {
    const violations: string[] = [];
    for (const file of domainFiles) {
      for (const source of getImportSources(file)) {
        if (source.includes('components/QuestEditor')) {
          violations.push(`${path.relative(RENDERER_DIR, file)} imports "${source}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
