/**
 * Both worker pools size themselves from one rule (docs/architecture/
 * worker-reliability.md, "Worker count caps"): one core is left for the main
 * thread and the count is capped at 8.
 *
 * @jest-environment node
 */

import * as path from 'path';

let cpuCount = 1;

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  cpus: () => Array.from({ length: cpuCount }, () => ({ model: 'stub' })),
}));

// No child is ever forked: a fake keeps the count test cheap at 32 cores.
jest.mock('child_process', () => {
  const { EventEmitter } = jest.requireActual('events');
  class FakeChild extends EventEmitter {
    send() {}
    kill() {
      this.emit('exit', 0, null);
      return true;
    }
  }
  return { ...jest.requireActual('child_process'), fork: () => new FakeChild() };
});

import { ParserService } from '../../src/main/services/ParserService';
import { MetadataWorkerPool } from '../../src/main/services/MetadataWorkerPool';
import { workerPoolSize } from '../../src/main/services/workerPoolSize';

const workerFixture = path.join(__dirname, '../fixtures/workers/echo.worker.js');

describe('workerPool.count', () => {
  it.each([
    [1, 1],
    [2, 1],
    [4, 3],
    [32, 8],
  ])('both pools agree for %i cores', async (cores, expected) => {
    cpuCount = cores;

    const parser = new ParserService({ workerPath: workerFixture });
    const metadata = new MetadataWorkerPool({ workerPath: workerFixture, forceWorkerMode: true });
    try {
      expect(workerPoolSize(cores)).toBe(expected);
      expect(parser.poolSize).toBe(expected);
      expect(metadata.poolSize).toBe(expected);
    } finally {
      await parser.dispose();
      await metadata.terminate();
    }
  });
});
