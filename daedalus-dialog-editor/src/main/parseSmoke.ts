import * as fs from 'fs';

// The packaged-app parse smoke (build-windows.yml). Twin of openWorldSmoke, for
// the other native binding: the world smoke proves zenkit_node.node survived
// packaging, this proves the tree-sitter pair did. They load in
// parser.worker.ts, out of the packaged app, and nothing else in CI opens them
// there — `npmRebuild: false` and a hand-maintained `files` allowlist mean a
// missing or unloadable binding is silent until a user opens a dialog file.
//
// Driven through ParserService.parseSource, the exact call the parser:parseSource
// IPC handler makes, so the worker spawn, the binding load and the semantic
// passes all run as they would for a user. Env-gated in main.ts; inert in
// production.

export interface ParseSmokeResult {
  ok: boolean;
  dialogCount?: number;
  functionCount?: number;
  error?: string;
}

/** The slice of ParserService the smoke drives — injected in tests. */
export interface SmokeParserService {
  parseSource(sourceCode: string): Promise<any>;
  dispose(): Promise<void>;
}

export async function runParseSmoke(
  parserService: SmokeParserService,
  filePath: string,
  resultPath: string | undefined,
): Promise<ParseSmokeResult> {
  let result: ParseSmokeResult;
  try {
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const model = await parserService.parseSource(sourceCode);
    const dialogCount = Object.keys(model?.dialogs ?? {}).length;
    const functionCount = Object.keys(model?.functions ?? {}).length;
    if (model?.hasErrors) {
      result = {
        ok: false,
        error: `parsed with syntax errors: ${JSON.stringify(model.errors ?? [])}`,
      };
    } else if (dialogCount > 0 && functionCount > 0) {
      result = { ok: true, dialogCount, functionCount };
    } else {
      // A binding that loaded but produced nothing: the counts, not the absence
      // of a throw, are what say the semantic passes actually ran.
      result = {
        ok: false,
        error: `implausible model: dialogCount=${dialogCount} functionCount=${functionCount}`,
      };
    }
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  await parserService.dispose();

  if (resultPath) {
    fs.writeFileSync(resultPath, JSON.stringify(result));
  }
  // The exit code is the primary verdict; the log line is for the CI transcript.
  console.log(`[smoke] parse ${result.ok ? 'OK' : 'FAILED'}: ${JSON.stringify(result)}`);
  return result;
}
