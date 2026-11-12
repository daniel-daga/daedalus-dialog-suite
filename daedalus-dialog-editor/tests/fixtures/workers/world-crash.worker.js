// Stub zenkit worker for WorldService's process boundary (#543). Speaks the
// worker's protocol over the fork's IPC channel: answers every request, except
// an `open` of a path named `crash`, which reports its phase the way
// `zenkit.worker`'s `phase()` does and then dies of a fatal signal — the
// reachable stand-in for a segfault inside ZenKit's `loadWorld`, after which no
// JS runs and nothing can report it. See `abort.worker.js` for why the signal
// differs on Windows.
const FATAL = process.platform === 'win32' ? 'SIGKILL' : 'SIGSEGV';

process.on('message', (msg) => {
  if (msg.op === 'open' && msg.payload && msg.payload.worldPath === 'crash') {
    process.send({ id: msg.id, type: 'phase', phase: 'loadWorld' });
    // Let the phase message leave before the signal ends the process, as it
    // does in the real worker: `phase()` posts, then enters the native call.
    setTimeout(() => process.kill(process.pid, FATAL), 50);
    return;
  }
  if (msg.op === 'worldMesh') {
    // A payload of real buffers, so the test sees them survive the copy.
    const positions = new Float32Array([1, 2, 3]).buffer;
    process.send({ id: msg.id, ok: true, result: { groups: [{ positions }], bbox: [0, 0, 0, 1, 1, 1] } });
    return;
  }
  process.send({ id: msg.id, ok: true, result: { worldPath: msg.payload && msg.payload.worldPath } });
});
