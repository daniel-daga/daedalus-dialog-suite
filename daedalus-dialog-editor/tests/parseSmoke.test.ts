/**
 * The packaged-app parse smoke (build-windows.yml). CI launches the packaged
 * exe with DDE_SMOKE_PARSE pointing at a committed corpus fixture; main.ts
 * routes that into runParseSmoke instead of creating a window. It is the
 * open-world smoke's twin for the *other* native binding: the world smoke
 * proves zenkit_node.node survived packaging, this one proves the tree-sitter
 * bindings did — they load in parser.worker.ts and nothing else in CI opens
 * them out of the packaged app.
 *
 * These tests pin the verdict logic — a dead binding (parseSource rejects), a
 * model that came back with syntax errors, an empty model, and an unreadable
 * fixture must all come back red, and the verdict must land in the result file
 * CI reads.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runParseSmoke } from '../src/main/parseSmoke';

function makeService(parseSource: jest.Mock) {
  return { parseSource, dispose: jest.fn().mockResolvedValue(undefined) };
}

const model = {
  dialogs: { DIA_Order: {} },
  functions: { DIA_Order_Info: {}, DIA_Order_Condition: {} },
};

describe('runParseSmoke', () => {
  let dir: string;
  let resultPath: string;
  let fixturePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dde-parse-smoke-'));
    resultPath = path.join(dir, 'result.json');
    fixturePath = path.join(dir, 'declaration-order.d');
    fs.writeFileSync(fixturePath, 'instance DIA_Order (C_INFO) {};\n', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports ok with the model counts when the source parses', async () => {
    const parseSource = jest.fn().mockResolvedValue(model);
    const service = makeService(parseSource);

    const result = await runParseSmoke(service, fixturePath, resultPath);

    expect(result.ok).toBe(true);
    expect(result.dialogCount).toBe(1);
    expect(result.functionCount).toBe(2);
    // The parse must go through the same call the parser:parseSource handler
    // makes, with the fixture's own text.
    expect(parseSource).toHaveBeenCalledWith('instance DIA_Order (C_INFO) {};\n');
    const written = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(written).toEqual(result);
  });

  it('reports failure when the parse rejects (binding failed to load)', async () => {
    const service = makeService(
      jest.fn().mockRejectedValue(
        new Error('Cannot open tree_sitter_daedalus_binding.node'),
      ),
    );

    const result = await runParseSmoke(service, fixturePath, resultPath);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('tree_sitter_daedalus_binding.node');
    const written = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(written.ok).toBe(false);
  });

  it('reports failure when the model came back with syntax errors', async () => {
    const service = makeService(
      jest.fn().mockResolvedValue({
        dialogs: {},
        functions: {},
        hasErrors: true,
        errors: [{ message: 'unexpected token' }],
      }),
    );

    const result = await runParseSmoke(service, fixturePath, resultPath);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/syntax error/i);
  });

  it('reports failure on an empty model — a binding that loaded but parsed nothing', async () => {
    const service = makeService(jest.fn().mockResolvedValue({ dialogs: {}, functions: {} }));

    const result = await runParseSmoke(service, fixturePath, resultPath);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/dialogCount/);
  });

  it('reports failure when the fixture cannot be read', async () => {
    const service = makeService(jest.fn().mockResolvedValue(model));

    const result = await runParseSmoke(service, path.join(dir, 'missing.d'), resultPath);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ENOENT/);
    expect(service.parseSource).not.toHaveBeenCalled();
  });

  it('tears the pool down and still returns a verdict with no result path', async () => {
    const service = makeService(jest.fn().mockResolvedValue(model));

    const result = await runParseSmoke(service, fixturePath, undefined);

    expect(result.ok).toBe(true);
    expect(service.dispose).toHaveBeenCalled();
  });
});
