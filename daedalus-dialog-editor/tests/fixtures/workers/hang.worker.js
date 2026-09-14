// Stub worker: receives messages but never replies (simulates a hung parse).

process.on('message', () => {
  // Intentionally never respond.
});
