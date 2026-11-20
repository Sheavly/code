import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Impostor } from './testing.types.js';

/**
 * Test-only: a real HTTP server on a free local port that answers every request with `handle`,
 * as whatever sits on a stale port might. `requests` counts what reached it, and `close` stops
 * it and drops its connections.
 */
export async function startImpostor(
  handle: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Impostor> {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    handle(request, response);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    requestCount: () => requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Test-only: a JSON body of `totalBytes` that `response` writes in 1 MB chunks, waiting for the
 * socket to drain between them. `written()` says how many bytes it got out, and `ended()` whether
 * it finished: a client that stops reading and cancels leaves both far short of the total.
 */
export function streamHugeBody(params: { response: ServerResponse; totalBytes: number }) {
  const { response, totalBytes } = params;
  const chunk = Buffer.alloc(1 << 20, 0x20);
  let written = 0;
  let finished = false;

  response.writeHead(200, { 'content-type': 'application/json' });
  response.write('{"padding":"');

  const pump = (): void => {
    while (written < totalBytes && !response.destroyed) {
      written += chunk.length;

      if (!response.write(chunk)) {
        response.once('drain', pump);

        return;
      }
    }

    if (response.destroyed) return;

    finished = true;
    response.end('"}');
  };

  pump();

  return { written: () => written, ended: () => finished };
}
