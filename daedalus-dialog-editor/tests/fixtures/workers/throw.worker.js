// Stub worker: throws an uncaught exception when the payload signals a crash,
// otherwise echo. Uses setImmediate so the throw escapes the message handler
// and reaches the default uncaught handler, which ends the process with code 1.

function isCrash(msg) {
  return !!msg && (msg.sourceCode === '__CRASH__' || msg.filePath === '__CRASH__');
}

process.on('message', (msg) => {
  if (isCrash(msg)) {
    setImmediate(() => {
      throw new Error('boom');
    });
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
