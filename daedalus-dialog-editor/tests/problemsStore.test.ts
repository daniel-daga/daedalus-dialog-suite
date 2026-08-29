import type { Dialog, SemanticModel } from '../src/shared/types';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { ParsedFileCache } from '../src/renderer/store/projectStore';

const model = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {},
  functions: {},
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: [],
  ...overrides
});

const dialog = (name: string, npc: string): Dialog => ({
  name,
  parent: 'C_INFO',
  properties: { npc, information: `${name}_Info` }
});

const cache = (filePath: string, m: SemanticModel): ParsedFileCache => ({
  filePath,
  semanticModel: m,
  lastParsed: new Date()
});

const seedProject = (parsed: ParsedFileCache[], npcList: string[], allFiles: string[]): void => {
  useProjectStore.setState({
    parsedFiles: new Map(parsed.map((c) => [c.filePath, c])),
    npcList,
    npcPrototypes: [],
    allDialogFiles: allFiles
  });
};

describe('problemsStore', () => {
  beforeEach(() => {
    useProblemsStore.getState().clear();
  });

  it('scans the parsed project files and populates navigable problems', () => {
    seedProject(
      [cache('a.d', model({ dialogs: { DIA_X: dialog('DIA_X', 'Nobody') } }))],
      [],
      ['a.d']
    );

    useProblemsStore.getState().runScan();

    const state = useProblemsStore.getState();
    expect(state.hasScanned).toBe(true);
    expect(state.isScanning).toBe(false);
    expect(state.scannedFileCount).toBe(1);
    expect(state.problems.some(
        (p) => p.rule === 'npc-not-found' && p.locus.kind === 'script' && p.locus.dialogName === 'DIA_X'
      )).toBe(true);
  });

  it('reports no problems when the referenced NPC is known', () => {
    seedProject(
      [cache('ok.d', model({ dialogs: { DIA_Ok: dialog('DIA_Ok', 'Diego') } }))],
      ['Diego'],
      ['ok.d']
    );

    useProblemsStore.getState().runScan();

    expect(useProblemsStore.getState().problems).toEqual([]);
  });

  it('exposes total vs scanned counts so the panel can flag incomplete ingestion', () => {
    seedProject(
      [cache('a.d', model())],
      [],
      ['a.d', 'b.d', 'c.d'] // two files not yet parsed
    );

    useProblemsStore.getState().runScan();

    const state = useProblemsStore.getState();
    expect(state.scannedFileCount).toBe(1);
    expect(state.totalFileCount).toBe(3);
  });

  it('clear() resets to the empty state', () => {
    seedProject([cache('a.d', model({ dialogs: { DIA_X: dialog('DIA_X', 'Nobody') } }))], [], ['a.d']);
    useProblemsStore.getState().runScan();

    useProblemsStore.getState().clear();

    const state = useProblemsStore.getState();
    expect(state.problems).toEqual([]);
    expect(state.hasScanned).toBe(false);
    expect(state.scannedFileCount).toBe(0);
  });
});
