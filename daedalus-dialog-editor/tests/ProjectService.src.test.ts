/** @jest-environment node */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ProjectService from '../src/main/services/ProjectService';
import * as iconv from 'iconv-lite';

describe('SRC-backed project indexing (#559)', () => {
  let root: string;
  const write = (name: string, source: string) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    return file;
  };
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-src-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('excludes reference stubs but still reports duplicate functions in included files', async () => {
    const duplicate = 'FUNC INT Npc_GetActiveSpell(var C_NPC self) { return 0; };\n'.repeat(2);
    const reference = write('Content/AI/Externals.d', duplicate);
    const included = write('Content/Story/Live.d', duplicate);
    write('Content/Gothic.src', '// compilation list\nSTORY\\*.D\n');
    const service = new ProjectService();
    const index = await service.buildProjectIndex(root);
    expect(index.allFiles).toEqual([included]);
    expect(index.parseErrors.map(file => file.filePath)).toEqual([included]);
    expect(index.parseErrors[0].errors.some(error => error.message.includes('Duplicate declaration'))).toBe(true);
    expect(await service.scanDirectory(root)).toContain(reference);
    write('Content/Gothic.src', 'Story\\*.d\nAI\\Externals.d\n');
    const reindexed = await service.buildProjectIndex(root);
    expect(reindexed.allFiles).toContain(reference);
    expect(reindexed.parseErrors).toHaveLength(2);
  });

  it('resolves nested lists, comments, mixed case and separators, and leaves other scopes alone', async () => {
    write('Content/GOTHIC.SRC', '\uFEFF/* files */\r\n"story/sub.src" // nested\r\n');
    write('Content/Story/Sub.src', '..\\Gothic.src\nLive_?.d\n');
    const live = write('Content/Story/Live_A.d', 'func void Included() {};');
    write('Content/Reference.d', 'func void ReferenceOnly() {};');
    const other = write('System/Standalone.d', 'func void Standalone() {};');
    const index = await new ProjectService().buildProjectIndex(root);
    expect(index.allFiles).toEqual([live, other].sort());
    expect(index.functions).toEqual(['INCLUDED', 'STANDALONE']);
  });

  it('keeps the folder scan when no compilation list exists', async () => {
    const file = write('Externals.d', 'func void Reference() {};');
    expect((await new ProjectService().buildProjectIndex(root)).allFiles).toEqual([file]);
  });

  it('keeps the union of separate compilation lists, including Windows-1252 paths', async () => {
    const game = write('Content/Story/Grüße.d', 'func void GameFunction() {};');
    const menu = write('System/Menu/Main.d', 'func void MenuFunction() {};');
    write('Content/Unused.d', 'func void Unused() {};');
    write('System/Unused.d', 'func void UnusedSystem() {};');
    const list = write('Content/Gothic.src', '');
    fs.writeFileSync(list, iconv.encode('Story\\Grüße.d\n', 'windows-1252'));
    write('System/Menu.src', 'Menu\\*.d\nEmpty\\*.d\n');
    const index = await new ProjectService().buildProjectIndex(root);
    expect(index.allFiles).toEqual([game, menu].sort());
    expect(index.functions).toEqual(['GAMEFUNCTION', 'MENUFUNCTION']);
  });

  it.each(['..\\outside.src', '..\\*.d', 'Missing.src', 'Missing.d'])(
    'does not hide errors for an unresolved or unsafe compilation entry: %s', async entry => {
      write('Gothic.src', entry + '\n');
      const file = write('Broken.d', 'func int Broken() { return 0; };\n'.repeat(2));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const index = await new ProjectService().buildProjectIndex(root);
        expect(index.allFiles).toEqual([file]);
        expect(index.parseErrors).toHaveLength(1);
        expect(warn).toHaveBeenCalled();
      } finally { warn.mockRestore(); }
    });
});
