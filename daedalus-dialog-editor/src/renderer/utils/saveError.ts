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

/**
 * User-facing copy for a classifiable save failure. Every message keeps the
 * "your changes are kept in the editor" reassurance and an actionable next step.
 * Shared by the app-bar save indicator (App.tsx) and the window-close guard
 * (E1) so a failed save reads identically wherever it surfaces.
 */
export function describeSaveError(saveError: SaveError): string {
  switch (saveError.kind) {
    case 'timeout':
      return 'Save failed: the parser did not respond (timed out). Your changes are kept in the editor — retry with Ctrl+S.';
    case 'worker-crashed':
      return 'Save failed: the parser worker crashed. Your changes are kept in the editor — retry with Ctrl+S.';
    case 'encoding':
      return 'Save failed: the characters named in the error cannot be represented in this file’s encoding (windows-1252, the format Gothic tooling requires). Your changes are kept in the editor — remove or replace those characters, then retry with Ctrl+S.';
    case 'external-conflict':
      return 'Save failed: the file changed on disk since it was opened. Your changes are kept in the editor — reload to see the external version or overwrite it.';
    default:
      return 'Save failed. Your changes are kept in the editor — retry with Ctrl+S.';
  }
}
