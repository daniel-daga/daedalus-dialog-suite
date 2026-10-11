/**
 * Guards the editor against a process-wide corruption of the native tree-sitter
 * runtime.
 *
 * `tree-sitter`'s JS wrapper patches the prototypes it gets from the native
 * addon: it reads the native members off e.g. `Tree.prototype` and replaces them
 * with accessors closing over what it just read. Node caches the `.node` addon
 * once per process, but Jest gives every test file its own module registry, so
 * the wrapper can be evaluated repeatedly against one set of native prototypes.
 * The second evaluation reads `Tree.prototype.rootNode` back through the
 * accessor the first one installed — with `this === Tree.prototype`, which fails
 * that getter's `this instanceof Tree` guard — captures `undefined`, and
 * reinstalls the accessor over it. From then on every parse in the process has
 * an undefined `rootNode`, which surfaces here as an empty project index because
 * `ProjectService.buildProjectIndex` records per-file metadata errors instead of
 * throwing.
 *
 * `jest.isolateModules` creates exactly such a fresh registry, so this
 * reproduces the failure deterministically in a single suite rather than relying
 * on how Jest happens to pack test files into workers.
 */
const SOURCE = `INSTANCE SLD_99003_Farim (Npc_Default)
{
  name = "Farim";
};

INSTANCE DIA_Farim_Hello (C_INFO)
{
  npc = SLD_99003_Farim;
  description = "Hello";
};`;

const extractInFreshModuleRegistry = () => {
  let metadata: any;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the require must run inside the fresh registry
    const { extractFileMetadataFromSource } = require('../src/main/utils/semanticMetadataUtils');
    metadata = extractFileMetadataFromSource(SOURCE, 'farim.d');
  });
  return metadata;
};

describe('native parser across Jest module registries', () => {
  it('keeps producing metadata after the module graph is re-evaluated', () => {
    // Three passes: the first evaluation of the tree-sitter wrapper always
    // works, so a single pass would not catch the regression.
    for (let pass = 1; pass <= 3; pass += 1) {
      const metadata = extractInFreshModuleRegistry();

      expect(metadata.instances.map((instance: { name: string }) => instance.name))
        .toContain('SLD_99003_Farim');
      expect(metadata.dialogs.map((dialog: { dialogName: string }) => dialog.dialogName))
        .toContain('DIA_Farim_Hello');
      expect(metadata.semanticModel).toBeDefined();
    }
  });

  it('leaves parsers created before a re-evaluation usable', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- pairs with the isolateModules require below
    const { extractFileMetadataFromSource } = require('../src/main/utils/semanticMetadataUtils');
    expect(extractFileMetadataFromSource(SOURCE, 'farim.d').dialogs).toHaveLength(1);

    extractInFreshModuleRegistry();

    // The corruption is global to the native prototypes, so the module instance
    // loaded before the re-evaluation is the sharpest signal that they survived.
    expect(extractFileMetadataFromSource(SOURCE, 'farim.d').dialogs).toHaveLength(1);
  });
});
