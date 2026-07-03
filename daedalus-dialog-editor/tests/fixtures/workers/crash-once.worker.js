// Stub worker: the first instance exits on its first message; a respawned
// instance replies normally. Coordination is via a marker file whose path is
// passed through the CRASH_ONCE_MARKER env var (worker threads inherit the
// parent's env at creation time). Used for retry-once / replacement assertions.
const fs = require('fs');
const { parentPort } = require('worker_threads');

const marker = process.env.CRASH_ONCE_MARKER;

parentPort.on('message', (msg) => {
  if (marker && !fs.existsSync(marker)) {
    try {
      fs.writeFileSync(marker, '1');
    } catch {
      // ignore
    }
    process.exit(1);
    return;
  }
  parentPort.postMessage({
    id: msg && msg.id,
    result: {},
    dialogs: [],
    instances: [],
    prototypes: [],
    isQuestFile: false,
    routines: [],
  });
});
