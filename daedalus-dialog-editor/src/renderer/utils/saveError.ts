/**
 * Classification for save rejections that cross IPC from the main process.
 *
 * The parser/worker layer embeds stable prefixes in the rejection message
 * (`PARSE_TIMEOUT:` / `PARSER_CRASHED:`) so the renderer can classify a failed
 * save without new IPC channels. The union is intentionally left open — slice 2
 * will add further kinds (e.g. 'encoding') as the save-status UX grows.
 */
export type SaveErrorKind = 'timeout' | 'worker-crashed';

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

  return undefined;
}
