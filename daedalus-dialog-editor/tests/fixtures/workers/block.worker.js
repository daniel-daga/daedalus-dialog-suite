// Stub worker: synchronously blocks its thread on a '__SLOW__' payload
// (simulating one big file head-of-line blocking a worker), otherwise echoes.
// Messages posted to a blocked worker queue behind the block and are never
// answered in time, which is exactly the round-robin failure mode.
const { parentPort } = require('worker_threads');

function isSlow(msg) {
  return !!msg && (msg.sourceCode === '__SLOW__' || msg.filePath === '__SLOW__');
}

parentPort.on('message', (msg) => {
  if (isSlow(msg)) {
    // Synchronous block; long enough to outlive any test timeout in play.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
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
