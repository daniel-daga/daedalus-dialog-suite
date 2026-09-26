// Stub worker: answers every request with the request itself, so a test can
// see exactly what the service posted.

process.on('message', (msg) => {
  process.send({ id: msg && msg.id, result: msg });
});
