// Stub worker: process.exit(1) when the payload signals a crash, otherwise echo.
// Crash is signalled with sourceCode/filePath === '__CRASH__' so a single stub
// can both kill its own thread and answer normal requests on other threads.
// '__EXIT0__' is the same thing with a *clean* exit code: a worker that walks
// off the end of its own event loop looks identical to the pool, and its
// pending request is just as unanswerable.
const { parentPort } = require('worker_threads');

function signals(msg, token) {
  return !!msg && (msg.sourceCode === token || msg.filePath === token);
}

parentPort.on('message', (msg) => {
  if (signals(msg, '__CRASH__')) {
    process.exit(1);
    return;
  }
  if (signals(msg, '__EXIT0__')) {
    process.exit(0);
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
