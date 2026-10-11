/**
 * The BVH worker's construction, alone in a module.
 *
 * `new Worker(new URL(…, import.meta.url))` is the form Vite recognises for
 * bundling a worker, and `import.meta` cannot be parsed by the CommonJS
 * transform the Jest suite runs under. Keeping it here leaves `BvhBuilder`
 * itself importable by a test, which is what lets the dispose path be held.
 */
export const createBvhWorker = (): Worker =>
  new Worker(new URL('./bvh.worker.ts', import.meta.url), { type: 'module' });
