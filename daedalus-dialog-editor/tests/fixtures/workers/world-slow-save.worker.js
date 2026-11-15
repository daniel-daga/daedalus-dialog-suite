// Stub zenkit worker whose `save` takes a moment (#566). Like the real worker
// it is synchronous: it reports its phase, blocks inside the "native" write,
// and only then puts the file on disk and answers — so a SIGKILL that lands
// mid-save leaves no file, exactly what a killed `saveWorld` loses. A target
// whose name contains `wedge` never comes back: the wedged native call that
// only the timeout's SIGKILL ends.
const fs = require('fs');

const block = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

process.on('message', (msg) => {
  if (msg.op === 'save') {
    const { targetPath } = msg.payload;
    process.send({ id: msg.id, type: 'phase', phase: 'save' });
    block(targetPath.includes('wedge') ? 60000 : 400);
    fs.writeFileSync(targetPath, 'saved');
    process.send({ id: msg.id, ok: true, result: null });
    return;
  }
  process.send({ id: msg.id, ok: true, result: { worldPath: msg.payload && msg.payload.worldPath } });
});
