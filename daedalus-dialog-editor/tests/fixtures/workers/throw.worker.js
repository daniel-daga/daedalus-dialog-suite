// Stub worker: throws an uncaught exception (fires the 'error' event) when the
// payload signals a crash, otherwise echo. Uses setImmediate so the throw
// escapes the message handler and reaches the worker's uncaught handler.
const { parentPort } = require('worker_threads');

function isCrash(msg) {
  return !!msg && (msg.sourceCode === '__CRASH__' || msg.filePath === '__CRASH__');
}

parentPort.on('message', (msg) => {
  if (isCrash(msg)) {
    setImmediate(() => {
      throw new Error('boom');
    });
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
