// Stub worker: process.exit(1) when the payload signals a crash, otherwise echo.
// Crash is signalled with sourceCode/filePath === '__CRASH__' so a single stub
// can both kill its own thread and answer normal requests on other threads.
const { parentPort } = require('worker_threads');

function isCrash(msg) {
  return !!msg && (msg.sourceCode === '__CRASH__' || msg.filePath === '__CRASH__');
}

parentPort.on('message', (msg) => {
  if (isCrash(msg)) {
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
