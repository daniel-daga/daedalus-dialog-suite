/**
 * Error type for worker-request failures shared by ParserService and
 * MetadataWorkerPool. The `kind` classifies the failure; the message is
 * prefixed with a stable token (e.g. `PARSE_TIMEOUT:`) so the renderer can
 * classify a rejection that has crossed the IPC boundary (where only the
 * error message survives) without needing new IPC channels.
 */
export type WorkerRequestErrorKind =
  | 'timeout' | 'worker-crashed' | 'pool-terminated'
  // The zenkit worker is a single *stateful* worker, so its failures are a
  // different event from a parse worker's: losing it loses the loaded world.
  | 'world-timeout' | 'world-crashed' | 'world-closed';

const KIND_PREFIX: Record<WorkerRequestErrorKind, string> = {
  timeout: 'PARSE_TIMEOUT',
  'worker-crashed': 'PARSER_CRASHED',
  'pool-terminated': 'POOL_TERMINATED',
  'world-timeout': 'WORLD_TIMEOUT',
  'world-crashed': 'WORLD_CRASHED',
  'world-closed': 'WORLD_CLOSED',
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
