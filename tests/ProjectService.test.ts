/**
 * Test suite for ProjectService - Gothic mod project scanning and indexing
 *
 * Tests the ability to:
 * - Scan directories recursively for .d files
 * - Extract NPCs from dialog INSTANCE declarations
 * - Build lightweight project index without full parsing
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProjectService', () => {
  let tempDir: string;
  let ProjectService: any;

  beforeEach(async () => {
    // Create temporary test directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gothic-test-'));

    // Dynamically import to avoid issues with main process code in renderer tests
    const module = await import('../src/main/services/ProjectService');
    ProjectService = module.default;
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('scanDirectory', () => {
    it('should find all .d files recursively', async () => {
      // Create test directory structure
      const dialogDir = path.join(tempDir, 'Dialoge');
      const npcDir = path.join(tempDir, 'NPC');
      fs.mkdirSync(dialogDir, { recursive: true });
      fs.mkdirSync(npcDir, { recursive: true });

      // Create test files
      fs.writeFileSync(path.join(dialogDir, 'DIA_Farim.d'), '// Dialog file');
      fs.writeFileSync(path.join(dialogDir, 'DIA_Arog.d'), '// Dialog file');
      fs.writeFileSync(path.join(npcDir, 'SLD_Farim.d'), '// NPC file');
      fs.writeFileSync(path.join(tempDir, 'root.d'), '// Root file');

      // Create non-.d file (should be ignored)
      fs.writeFileSync(path.join(dialogDir, 'readme.txt'), 'Should be ignored');

      const service = new ProjectService();
      const files = await service.scanDirectory(tempDir);

      expect(files).toHaveLength(4);
      expect(files).toContain(path.join(dialogDir, 'DIA_Farim.d'));
      expect(files).toContain(path.join(dialogDir, 'DIA_Arog.d'));
      expect(files).toContain(path.join(npcDir, 'SLD_Farim.d'));
      expect(files).toContain(path.join(tempDir, 'root.d'));
      expect(files).not.toContain(path.join(dialogDir, 'readme.txt'));
    });

    it('should handle empty directories', async () => {
      const service = new ProjectService();
      const files = await service.scanDirectory(tempDir);

      expect(files).toHaveLength(0);
    });

    it('should handle nested directory structures', async () => {
      // Create deeply nested structure
      const deepPath = path.join(tempDir, 'a', 'b', 'c', 'd');
      fs.mkdirSync(deepPath, { recursive: true });
      fs.writeFileSync(path.join(deepPath, 'deep.d'), '// Deep file');

      const service = new ProjectService();
      const files = await service.scanDirectory(tempDir);

      expect(files).toHaveLength(1);
      expect(files[0]).toContain('deep.d');
    });
  });

  describe('extractDialogMetadata', () => {
    it('should extract dialog name and NPC from INSTANCE declaration', async () => {
      const content = `
INSTANCE DIA_Farim_Hallo (C_INFO)
{
    npc         = SLD_99003_Farim;
    nr          = 1;
    condition   = DIA_Farim_Hallo_Condition;
    information = DIA_Farim_Hallo_Info;
    permanent   = TRUE;
    description = "Hallo!";
};
      `;

      const service = new ProjectService();
      const metadata = service.extractDialogMetadata(content, '/test/DIA_Farim.d');

      expect(metadata).toHaveLength(1);
      expect(metadata[0].dialogName).toBe('DIA_Farim_Hallo');
      expect(metadata[0].npc).toBe('SLD_99003_Farim');
      expect(metadata[0].filePath).toBe('/test/DIA_Farim.d');
    });

    it('should extract multiple dialogs from same file', async () => {
      const content = `
INSTANCE DIA_Farim_Hallo (C_INFO)
{
    npc = SLD_99003_Farim;
};

INSTANCE DIA_Farim_Goodbye (C_INFO)
{
    npc = SLD_99003_Farim;
};
      `;

      const service = new ProjectService();
      const metadata = service.extractDialogMetadata(content, '/test/DIA_Farim.d');

      expect(metadata).toHaveLength(2);
      expect(metadata[0].dialogName).toBe('DIA_Farim_Hallo');
      expect(metadata[1].dialogName).toBe('DIA_Farim_Goodbye');
    });

    it('should handle different NPC formats (with/without semicolon)', async () => {
      const content = `
INSTANCE DIA_Test1 (C_INFO) { npc = NPC_1; };
INSTANCE DIA_Test2 (C_INFO) { npc = NPC_2 };
      `;

      const service = new ProjectService();
      const metadata = service.extractDialogMetadata(content, '/test/file.d');

      expect(metadata).toHaveLength(2);
      expect(metadata[0].npc).toBe('NPC_1');
      expect(metadata[1].npc).toBe('NPC_2');
    });

    it('should skip INSTANCE declarations without npc field', async () => {
      const content = `
INSTANCE SomeItem (C_ITEM)
{
    name = "Test Item";
};

INSTANCE DIA_Valid (C_INFO)
{
    npc = SLD_12345_TestNPC;
};
      `;

      const service = new ProjectService();
      const metadata = service.extractDialogMetadata(content, '/test/file.d');

      expect(metadata).toHaveLength(1);
      expect(metadata[0].dialogName).toBe('DIA_Valid');
    });

    it('should return empty array for files without INSTANCE declarations', async () => {
      const content = `
FUNC void SomeFunction()
{
    // Just a function
};
      `;

      const service = new ProjectService();
      const metadata = service.extractDialogMetadata(content, '/test/file.d');

      expect(metadata).toHaveLength(0);
    });

    it('should extract NPC correctly when nested braces exist', async () => {
      const content = `
INSTANCE DIA_Nested (C_INFO)
{
    condition = function() {
        if (TRUE) { return TRUE; };
    };
    npc = SLD_Nested_NPC;
    description = "Nested test";
};
      `;

      const service = new ProjectService();
      const metadata = service.extractDialogMetadata(content, '/test/nested.d');

      expect(metadata).toHaveLength(1);
      expect(metadata[0].dialogName).toBe('DIA_Nested');
      expect(metadata[0].npc).toBe('SLD_Nested_NPC');
    });
  });

  describe('buildProjectIndex', () => {
    it('should build complete project index from directory', async () => {
      // Create test project structure
      const dialogDir = path.join(tempDir, 'Dialoge');
      fs.mkdirSync(dialogDir, { recursive: true });

      // Create DIA_Farim.d with 2 dialogs
      fs.writeFileSync(path.join(dialogDir, 'DIA_Farim.d'), `
INSTANCE DIA_Farim_Hallo (C_INFO)
{
    npc = SLD_99003_Farim;
};

INSTANCE DIA_Farim_Trade (C_INFO)
{
    npc = SLD_99003_Farim;
};
      `);

      // Create DIA_Arog.d with 1 dialog
      fs.writeFileSync(path.join(dialogDir, 'DIA_Arog.d'), `
INSTANCE DIA_Arog_Greeting (C_INFO)
{
    npc = SLD_99005_Arog;
};
      `);

      const service = new ProjectService();
      const index = await service.buildProjectIndex(tempDir);

      // Verify NPCs
      expect(index.npcs).toHaveLength(2);
      expect(index.npcs).toContain('SLD_99003_Farim');
      expect(index.npcs).toContain('SLD_99005_Arog');

      // Verify dialogs by NPC
      expect(index.dialogsByNpc.get('SLD_99003_Farim')).toHaveLength(2);
      expect(index.dialogsByNpc.get('SLD_99005_Arog')).toHaveLength(1);

      const farimDialogs = index.dialogsByNpc.get('SLD_99003_Farim')!;
      expect(farimDialogs[0].dialogName).toBe('DIA_Farim_Hallo');
      expect(farimDialogs[1].dialogName).toBe('DIA_Farim_Trade');

      // Verify all files are tracked
      expect(index.allFiles).toHaveLength(2);
    });

    it('should handle project with no dialog files', async () => {
      fs.writeFileSync(path.join(tempDir, 'random.d'), 'FUNC void test() {};');

      const service = new ProjectService();
      const index = await service.buildProjectIndex(tempDir);

      expect(index.npcs).toHaveLength(0);
      expect(index.dialogsByNpc.size).toBe(0);
      expect(index.allFiles).toHaveLength(1); // File still tracked
    });

    it('should sort NPCs alphabetically', async () => {
      const dialogDir = path.join(tempDir, 'Dialoge');
      fs.mkdirSync(dialogDir, { recursive: true });

      fs.writeFileSync(path.join(dialogDir, 'DIA_Zebra.d'), 'INSTANCE DIA_Z (C_INFO) { npc = Zebra; };');
      fs.writeFileSync(path.join(dialogDir, 'DIA_Alpha.d'), 'INSTANCE DIA_A (C_INFO) { npc = Alpha; };');
      fs.writeFileSync(path.join(dialogDir, 'DIA_Beta.d'), 'INSTANCE DIA_B (C_INFO) { npc = Beta; };');

      const service = new ProjectService();
      const index = await service.buildProjectIndex(tempDir);

      expect(index.npcs).toEqual(['Alpha', 'Beta', 'Zebra']);
    });
  });

  describe('getDialogsForNpc', () => {
    it('should return all dialogs for a specific NPC', async () => {
      const dialogDir = path.join(tempDir, 'Dialoge');
      fs.mkdirSync(dialogDir, { recursive: true });

      fs.writeFileSync(path.join(dialogDir, 'DIA_Farim.d'), `
INSTANCE DIA_Farim_1 (C_INFO) { npc = SLD_99003_Farim; };
INSTANCE DIA_Farim_2 (C_INFO) { npc = SLD_99003_Farim; };
      `);

      fs.writeFileSync(path.join(dialogDir, 'DIA_Arog.d'), `
INSTANCE DIA_Arog_1 (C_INFO) { npc = SLD_99005_Arog; };
      `);

      const service = new ProjectService();
      const index = await service.buildProjectIndex(tempDir);
      const farimDialogs = service.getDialogsForNpc(index, 'SLD_99003_Farim');

      expect(farimDialogs).toHaveLength(2);
      expect(farimDialogs[0].dialogName).toBe('DIA_Farim_1');
      expect(farimDialogs[1].dialogName).toBe('DIA_Farim_2');
    });

    it('should return empty array for unknown NPC', async () => {
      const service = new ProjectService();
      const index = await service.buildProjectIndex(tempDir);
      const dialogs = service.getDialogsForNpc(index, 'UnknownNPC');

      expect(dialogs).toHaveLength(0);
    });
  });
});
