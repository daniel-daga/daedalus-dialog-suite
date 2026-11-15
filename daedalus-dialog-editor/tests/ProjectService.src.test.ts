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

  it('keeps SRC membership despite a SCRIPTBIN header and missing explicit scripts (Beppo regression)', async () => {
    const duplicate = 'FUNC INT Npc_GetActiveSpell(var C_NPC self) { return 0; };\n'.repeat(2);
    const live = write('Content/Story/Live.d', duplicate);
    write('Content/AI/AI_Intern/Externals.d', duplicate);
    write('Content/gothic.src', '_INTERN\\SCRIPTBIN\nAI\\AI_INTERN\\AI_CONSTANTS.D\nSTORY\\Story_Globals.d\nSTORY\\Live.d\n');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const index = await new ProjectService().buildProjectIndex(root);
      expect(index.allFiles).toEqual([live]);
      expect(index.parseErrors.map(file => file.filePath)).toEqual([live]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('AI_CONSTANTS.D'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Story_Globals.d'));
      expect(warn.mock.calls.some(([message]) => String(message).includes('indexing all scripts'))).toBe(false);
    } finally { warn.mockRestore(); }
  });

  it.each(['..\\outside.src', 'Missing.src'])(
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

  describe('scoped fallback (#569)', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { warn.mockRestore(); });

    it('falls back only inside the scope of the list that cannot be resolved', async () => {
      write('Content/Gothic.src', 'Missing.src\nStory\\Live.d\n');
      const live = write('Content/Story/Live.d', 'func void Live() {};');
      const unlisted = write('Content/Unlisted.d', 'func void Unlisted() {};');
      write('System/Menu.src', 'Menu\\*.d\n');
      const menu = write('System/Menu/Main.d', 'func void MenuFunction() {};');
      write('System/Unused.d', 'func void UnusedSystem() {};');
      const index = await new ProjectService().buildProjectIndex(root);
      expect(index.allFiles).toEqual([live, unlisted, menu].sort());
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Missing.src'));
    });

    it('keeps the outer list when a nested list cannot be resolved', async () => {
      write('Content/Gothic.src', 'Story\\Sub.src\nAI\\Used.d\n');
      write('Content/Story/Sub.src', '..\\..\\..\\outside.src\nLive.d\n');
      const live = write('Content/Story/Live.d', 'func void Live() {};');
      const storyUnlisted = write('Content/Story/Unlisted.d', 'func void StoryUnlisted() {};');
      const used = write('Content/AI/Used.d', 'func void Used() {};');
      write('Content/AI/Reference.d', 'func void Reference() {};');
      const index = await new ProjectService().buildProjectIndex(root);
      expect(index.allFiles).toEqual([used, live, storyUnlisted].sort());
    });

    it('also distrusts the folder a missing nested list would have governed', async () => {
      write('Content/Gothic.src', '..\\System\\Extra.src\n');
      const content = write('Content/Any.d', 'func void Any() {};');
      write('System/Menu.src', 'Menu\\*.d\n');
      const menu = write('System/Menu/Main.d', 'func void MenuFunction() {};');
      const maybeExtra = write('System/Extra/Maybe.d', 'func void Maybe() {};');
      const index = await new ProjectService().buildProjectIndex(root);
      expect(index.allFiles).toEqual([content, maybeExtra, menu].sort());
    });

    it('reads a leading separator as relative to the list, as the engine concatenates paths', async () => {
      write('Content/Gothic.src', '\\Story\\Live.d\n/Story/Other.d\n');
      const live = write('Content/Story/Live.d', 'func void Live() {};');
      const other = write('Content/Story/Other.d', 'func void Other() {};');
      write('Content/Reference.d', 'func void Reference() {};');
      const index = await new ProjectService().buildProjectIndex(root);
      expect(index.allFiles).toEqual([live, other].sort());
      expect(warn).not.toHaveBeenCalled();
    });

    it('skips a script entry outside the project and keeps the rest of its list', async () => {
      write('Content/Gothic.src', '..\\..\\Elsewhere\\Shared.d\n..\\..\\*.d\nStory\\Live.d\n');
      const live = write('Content/Story/Live.d', 'func void Live() {};');
      write('Content/Reference.d', 'func void Reference() {};');
      const index = await new ProjectService().buildProjectIndex(root);
      expect(index.allFiles).toEqual([live]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Shared.d'));
      expect(warn.mock.calls.some(([message]) => String(message).includes('indexing all scripts'))).toBe(false);
    });
  });
});
