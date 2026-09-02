import type { FileService } from './FileService';
import type { FileWatcherService } from './FileWatcherService';
import type { ParserService } from './ParserService';
import { PathValidationError, type PathValidationService } from './PathValidationService';
import type { AppendInsertNpcResult } from '../../shared/types';

/**
 * The `script:appendInsertNpc` body (level-editor.md §16.19, slice 16 C):
 * append `Wld_InsertNpc (INSTANCE, "WP");` as the last statement of a
 * `STARTUP_<world>` function on disk.
 *
 * Deliberately not `saveFileFlow` minus the generate step in shape only —
 * it never generates at all. Regenerating retail's Startup.d rewrites 4,788
 * of its 4,802 lines (slice B's measurement), so the write is a text splice
 * before the function's closing `};`, located through the range the parser
 * recorded for the declaration node. The file is parsed here, on disk, rather
 * than trusting the renderer's cached model: the range must belong to the
 * bytes being spliced. A model with errors is refused, never forced.
 */
export interface AppendInsertNpcDeps {
  pathValidator: Pick<PathValidationService, 'validatePathResolved'>;
  fileService: Pick<FileService, 'readFile' | 'writeFile'>;
  parserService: Pick<ParserService, 'parseSource'>;
  fileWatcherService: Pick<FileWatcherService, 'notifySelfWrite'>;
}

export async function appendInsertNpcFlow(
  deps: AppendInsertNpcDeps,
  filePath: string,
  functionName: string,
  npcInstance: string,
  spawnPoint: string,
): Promise<AppendInsertNpcResult> {
  try {
    await deps.pathValidator.validatePathResolved(filePath, { write: true });
    const source = await deps.fileService.readFile(filePath);
    const model = await deps.parserService.parseSource(source);
    if (model.hasErrors) {
      const errors: string[] = (model.errors ?? []).map((e: any) => e.message ?? 'Syntax error');
      return { ok: false, reason: { kind: 'parse-errors', errors } };
    }

    const wanted = functionName.toUpperCase();
    const declared = Object.keys(model.functions).find((name) => name.toUpperCase() === wanted);
    const range = declared ? model.functions[declared].range : undefined;
    if (!range) return { ok: false, reason: { kind: 'function-not-found', functionName } };

    const { text, line } = spliceBeforeClosingBrace(
      source, range, `Wld_InsertNpc (${npcInstance}, "${spawnPoint}");`
    );
    try {
      await deps.fileService.writeFile(filePath, text, { expectUnchanged: true });
    } catch (error) {
      if ((error as { code?: string }).code === 'EXTERNAL_MODIFICATION') {
        return { ok: false, reason: { kind: 'external-modification' } };
      }
      throw error;
    }
    deps.fileWatcherService.notifySelfWrite(filePath);
    return { ok: true, line };
  } catch (error) {
    if (error instanceof PathValidationError) {
      console.error('[IPC] script:appendInsertNpc - Path validation failed:', error.message);
      throw new Error(error.message);
    }
    console.error('[IPC] script:appendInsertNpc error:', error);
    throw new Error(`Failed to append Wld_InsertNpc: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * `statement` on its own line before the `}` that closes the function whose
 * declaration spans `range`, in the file's own line ending and the indent the
 * body's first indented line uses (a tab when the body has none). Returns the
 * new text and the 1-based line the statement landed on.
 */
function spliceBeforeClosingBrace(
  source: string,
  range: { startIndex: number; endIndex: number },
  statement: string,
): { text: string; line: number } {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const close = source.lastIndexOf('}', range.endIndex);
  const lineStart = source.lastIndexOf('\n', close - 1) + 1;
  const indent = /^([ \t]+)\S/m.exec(source.slice(range.startIndex, lineStart))?.[1] ?? '\t';

  // `};` alone on its line is the shape of every retail function; a brace
  // sharing its line with the last statement still gets its own line back.
  const braceHasOwnLine = source.slice(lineStart, close).trim() === '';
  const at = braceHasOwnLine ? lineStart : close;
  const insert = braceHasOwnLine ? `${indent}${statement}${eol}` : `${eol}${indent}${statement}${eol}`;

  const text = source.slice(0, at) + insert + source.slice(at);
  const line = source.slice(0, at).split('\n').length + (braceHasOwnLine ? 0 : 1);
  return { text, line };
}
