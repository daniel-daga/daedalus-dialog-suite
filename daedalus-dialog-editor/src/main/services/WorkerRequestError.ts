/**
 * Error type for worker-request failures shared by ParserService and
 * MetadataWorkerPool. The `kind` classifies the failure; the message is
 * prefixed with a stable token (e.g. `PARSE_TIMEOUT:`) so the renderer can
 * classify a rejection that has crossed the IPC boundary (where only the
 * error message survives) without needing new IPC channels.
 */
export type WorkerRequestErrorKind = 'timeout' | 'worker-crashed' | 'pool-terminated';

const KIND_PREFIX: Record<WorkerRequestErrorKind, string> = {
  timeout: 'PARSE_TIMEOUT',
  'worker-crashed': 'PARSER_CRASHED',
  'pool-terminated': 'POOL_TERMINATED',
};

export class WorkerRequestError extends Error {
  readonly kind: WorkerRequestErrorKind;

  constructor(message: string, kind: WorkerRequestErrorKind) {
    super(`${KIND_PREFIX[kind]}: ${message}`);
    this.name = 'WorkerRequestError';
    this.kind = kind;
    // Preserve instanceof across the transpile target.
    Object.setPrototypeOf(this, WorkerRequestError.prototype);
  }
}
