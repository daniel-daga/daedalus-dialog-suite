/**
 * A throw while sending a result must not kill the parser worker (#571).
 *
 * The forked channel serialises with V8's structured clone, which throws
 * synchronously inside `process.send` for a value it cannot clone. That throw
 * has to come back as the request's `{ id, error }` reply: an unhandled
 * rejection exits the child, which `ParserService` reports as a crashed worker
 * and counts toward the crash-loop limit.
 *
 * Drives the worker's real `message` listener, with `process.send` stubbed.
 *
 * @jest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type Reply = { id: string; result?: unknown; error?: string };
type Listener = (message: unknown) => void;

const realSend = process.send;
let listener: Listener | undefined;
let unhandled: unknown[];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

/** Load the worker with `send` as its IPC channel and return its `message` listener. */
function loadWorker(send: (reply: Reply) => void): Listener {
  const before = new Set(process.listeners('message'));
  process.send = send as unknown as typeof process.send;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded for its side effect, after process.send is stubbed
    require('../src/main/workers/parser.worker');
  });
  const added = process.listeners('message').filter((l) => !before.has(l));
  expect(added).toHaveLength(1);
  listener = added[0] as Listener;
  return listener;
}

/** Long enough for the request's promise chain and Node's unhandled-rejection check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  if (listener) process.off('message', listener);
  listener = undefined;
  process.send = realSend;
  jest.restoreAllMocks();
});

describe('parser worker replies (#571)', () => {
  it('answers with an error when sending the result throws', async () => {
    const replies: Reply[] = [];
    let failures = 1;
    const onMessage = loadWorker((reply) => {
      if (failures-- > 0) throw new Error('result could not be cloned');
      replies.push(reply);
    });

    onMessage({ id: 'r1', sourceCode: 'const int X = 1;' });
    await settle();

    expect(replies).toEqual([{ id: 'r1', error: 'result could not be cloned' }]);
    expect(unhandled).toEqual([]);
  });

  it('does not reject when the error reply cannot be sent either', async () => {
    const send = jest.fn((_reply: Reply) => { throw new Error('channel closed'); });
    const onMessage = loadWorker(send);

    onMessage({ id: 'r2', sourceCode: 'const int X = 1;' });
    await settle();

    expect(send.mock.calls.map(([reply]) => Object.keys(reply).sort())).toEqual([
      ['id', 'result'],
      ['error', 'id'],
    ]);
    expect(unhandled).toEqual([]);
  });

  it('still answers a request that itself fails', async () => {
    const replies: Reply[] = [];
    const onMessage = loadWorker((reply) => { replies.push(reply); });

    onMessage({ id: 'r3', sourceCode: 42 });
    await settle();

    expect(replies).toEqual([{ id: 'r3', error: 'Invalid sourceCode type: number' }]);
    expect(unhandled).toEqual([]);
  });
});
