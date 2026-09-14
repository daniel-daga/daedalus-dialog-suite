// Stub worker: the first instance exits on its first message; a respawned
// instance replies normally. Coordination is via a marker file whose path is
// passed through the CRASH_ONCE_MARKER env var (forked children inherit the
// parent's env at creation time). Used for retry-once / replacement assertions.
const fs = require('fs');

const marker = process.env.CRASH_ONCE_MARKER;

process.on('message', (msg) => {
  if (marker && !fs.existsSync(marker)) {
    try {
      fs.writeFileSync(marker, '1');
    } catch {
      // ignore
    }
    process.exit(1);
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
