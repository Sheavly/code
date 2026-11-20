import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '@sheavly/protocol/api/api.constants';
import { newNonce } from '@sheavly/protocol/handshake/handshake.utils';
import { testApi } from '../../testing/api.fake.js';
import { TEST_TOKEN } from '../../testing/testing.constants.js';
import { honoPath } from '../api.utils.js';

const UNAUTHORIZED = {
  error: { code: 'unauthorized', message: 'A valid bearer token is required' },
};

/** The credentials a caller may present: none, a wrong token, and a near miss of the real one. */
const CALLERS: { label: string; headers: Record<string, string> }[] = [
  { label: 'no token', headers: {} },
  { label: 'a wrong token', headers: { authorization: 'Bearer wrong' } },
  {
    label: 'a token with one character too many',
    headers: { authorization: `Bearer ${TEST_TOKEN}x` },
  },
];

/** A path of `route` with a sample for each parameter, so the router finds it. */
function samplePath(path: string): string {
  return honoPath(path).replaceAll(/:\w+/g, 'sample');
}

describe('which routes answer without the token', () => {
  it('pins the public set to the health and handshake routes', () => {
    const marked = Object.entries(API_ROUTES).flatMap(([name, route]) =>
      'public' in route ? [name] : [],
    );

    // A literal, not derived: adding a public route has to change this line.
    expect(marked).toEqual(['getHealth', 'queryHandshake']);
  });

  it('answers a public route with no token or a wrong one, and every other route with 401', async () => {
    const { app, conversations } = testApi({});
    let exercised = 0;

    for (const caller of CALLERS) {
      for (const [name, route] of Object.entries(API_ROUTES)) {
        const isPublic = 'public' in route;
        const response = await app.request(samplePath(route.path), {
          method: route.method.toUpperCase(),
          headers: {
            ...caller.headers,
            ...('body' in route && { 'content-type': 'application/json' }),
          },
          ...('body' in route && {
            body: JSON.stringify(isPublic ? { nonce: newNonce() } : {}),
          }),
        });

        expect({ name, caller: caller.label, status: response.status }).toEqual({
          name,
          caller: caller.label,
          status: isPublic ? 200 : 401,
        });

        if (!isPublic) expect(await response.json()).toEqual(UNAUTHORIZED);

        exercised += 1;
      }
    }

    expect(exercised).toBe(CALLERS.length * Object.keys(API_ROUTES).length);
    await conversations.closeAll();
  });

  it('answers OPTIONS, another method on a public path and an unknown path with 401', async () => {
    const { app, conversations } = testApi({});
    const attempts = [
      { method: 'OPTIONS', path: '/health' },
      { method: 'OPTIONS', path: '/handshake' },
      { method: 'OPTIONS', path: '/conversations' },
      { method: 'POST', path: '/health' },
      { method: 'GET', path: '/handshake' },
      { method: 'GET', path: '/health/' },
      { method: 'GET', path: '/nowhere' },
      { method: 'QUERY', path: '/nowhere' },
    ];

    for (const attempt of attempts) {
      const response = await app.request(attempt.path, { method: attempt.method });

      expect({ ...attempt, status: response.status }).toEqual({ ...attempt, status: 401 });
      expect(await response.json()).toEqual(UNAUTHORIZED);
    }

    await conversations.closeAll();
  });
});
