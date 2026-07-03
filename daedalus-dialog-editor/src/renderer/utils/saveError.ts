/**
 * Classification for save rejections that cross IPC from the main process.
 *
 * The parser/worker layer embeds stable prefixes in the rejection message
 * (`PARSE_TIMEOUT:` / `PARSER_CRASHED:`) so the renderer can classify a failed
 * save without new IPC channels. FileService additionally embeds
 * `ENCODING_LOSS:` (a write whose characters are unrepresentable in the file's
 * encoding) and `EXTERNAL_MODIFICATION:` (the file changed on disk since it was
 * read) so the save-status UX can surface those without extra channels.
 */
export type SaveErrorKind = 'timeout' | 'worker-crashed' | 'encoding' | 'external-conflict';

export interface SaveError {
  kind: SaveErrorKind;
  message: string;
}

export function classifySaveError(error: unknown): SaveError | undefined {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('PARSE_TIMEOUT:')) {
    return { kind: 'timeout', message };
  }
  if (message.includes('PARSER_CRASHED:')) {
    return { kind: 'worker-crashed', message };
  }
  if (message.includes('ENCODING_LOSS:')) {
    return { kind: 'encoding', message };
  }
  if (message.includes('EXTERNAL_MODIFICATION:')) {
    return { kind: 'external-conflict', message };
  }

  return undefined;
}
