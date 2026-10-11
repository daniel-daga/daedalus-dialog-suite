import { ChildProcess, fork } from 'child_process';

/**
 * Cap on the child's V8 heap — the process-level equivalent of the
 * `resourceLimits.maxOldGenerationSizeMb` the `worker_threads` pools used to
 * pass. Runaway memory now aborts the child rather than raising a catchable
 * `ERR_WORKER_OUT_OF_MEMORY`, which the pools already handle: an abort is a
 * death like any other.
 */
const MAX_OLD_SPACE_MB = 512;

/**
 * A parser worker in an OS process of its own, shaped like the `Worker` the
 * pools used to hold.
 *
 * The reason the boundary is a process and not a thread: tree-sitter is native
 * code, and a SIGSEGV inside it kills the process it runs in. As a
 * `worker_threads` thread that process was the Electron main process, so a
 * malformed file took the whole app down with no `error` and no `exit` event —
 * nothing the pools' restart machinery could see. A child process dies alone,
 * and its death arrives as the `exit` event the pools already know how to
 * recover from.
 *
 * Everything else is deliberately unchanged, so the pools keep their timeouts,
 * their restart caps and their failure classification.
 */
export class ForkedWorker {
  private readonly child: ChildProcess;
  private exited = false;
  private exitCode = 0;

  constructor(scriptPath: string) {
    this.child = fork(scriptPath, [], {
      // The V8 structured-clone serializer, so a semantic model crosses the
      // boundary with the fidelity `postMessage` gave it. The default JSON
      // serializer would flatten cycles, Maps and Sets.
      serialization: 'advanced',
      // Nothing reads the child's pipes, and an unread pipe fills up and blocks
      // the writer mid-parse; the parent's own streams are where a worker's
      // logging belongs anyway.
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      execArgv: [`--max-old-space-size=${MAX_OLD_SPACE_MB}`],
      // Under Electron `process.execPath` is the app binary, and only this says
      // "run as plain Node". Harmless outside Electron.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });

    this.child.on('exit', (code) => {
      this.exited = true;
      this.exitCode = code ?? 0;
    });
  }

  postMessage(value: unknown): void {
    // A failed send means the channel is gone, which means the child is gone —
    // and that arrives as `exit`, where the in-flight request is settled. The
    // callback is here only so the failure does not also surface as an
    // unhandled `error` event.
    this.child.send(value as object, () => {});
  }

  on(event: 'message', listener: (message: any) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    this.child.on(event, listener);
    return this;
  }

  /** Kill the child, resolving once it is actually gone. */
  terminate(): Promise<number> {
    if (this.exited) return Promise.resolve(this.exitCode);

    const gone = new Promise<number>((resolve) => {
      this.child.once('exit', (code) => resolve(code ?? 0));
    });
    // SIGKILL rather than SIGTERM: a worker wedged inside a native parse is the
    // case this exists for, and it cannot run a handler to honour anything else.
    this.child.kill('SIGKILL');
    return gone;
  }
}

/** How a worker's death is described to the user, signal included. */
export function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return signal ? `killed by ${signal}` : `exit code ${code}`;
}
