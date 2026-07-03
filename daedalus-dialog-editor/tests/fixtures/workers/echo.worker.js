// Stub worker: replies normally to every message.
// Speaks both the parser protocol ({ id, result }) and the metadata protocol
// ({ id, dialogs, ... }) so a single stub works for both services.
const { parentPort } = require('worker_threads');

parentPort.on('message', (msg) => {
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
