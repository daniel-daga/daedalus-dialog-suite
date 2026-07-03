// Stub worker: receives messages but never replies (simulates a hung parse).
const { parentPort } = require('worker_threads');

parentPort.on('message', () => {
  // Intentionally never respond.
});
