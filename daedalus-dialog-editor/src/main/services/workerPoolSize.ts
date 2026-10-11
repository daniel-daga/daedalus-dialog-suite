/**
 * The one worker-count rule both pools follow (docs/architecture/
 * worker-reliability.md, "Worker count caps"): leave one core for the main
 * thread/event loop, and cap at 8 to bound native parser instances — each
 * loads the parser and uses tens of MB.
 */
export function workerPoolSize(cpuCount: number): number {
  return Math.max(1, Math.min(cpuCount - 1, 8));
}
