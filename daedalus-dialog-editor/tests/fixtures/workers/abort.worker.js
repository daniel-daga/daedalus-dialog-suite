// Stub worker: signals its own process to death on '__ABORT__', otherwise
// echoes. A fatal signal raised at the process is the reachable stand-in for one
// raised inside tree-sitter: no JS runs afterwards, so nothing can report it.
// (`process.abort()` would not do — a worker thread refuses it, which is exactly
// the cooperation a real native crash does not offer.)
//
// Back when the pools ran worker threads this killed the *host* process — the
// Electron main process in production, the Jest runner here. That it now kills
// only the child is the whole point of the process boundary.
//
// SIGSEGV is the signal this exists for; Windows has no such thing, and libuv
// only terminates on SIGTERM/SIGINT/SIGKILL there, so the platform picks one it
// can actually die from. Either way the host is untouched and the child is gone.
const FATAL = process.platform === 'win32' ? 'SIGKILL' : 'SIGSEGV';

process.on('message', (msg) => {
  if (msg && (msg.sourceCode === '__ABORT__' || msg.filePath === '__ABORT__')) {
    process.kill(process.pid, FATAL);
    return;
  }
  process.send({
    id: msg && msg.id,
    result: {},
    dialogs: [],
    instances: [],
    prototypes: [],
    isQuestFile: false,
    routines: [],
  });
});
