import { describe, expect, it } from 'vitest';
import { reply, testApi } from '../../testing/api.fake.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('yield over HTTP', () => {
  it('reports not accepted when no prompt runs', async () => {
    const api = testApi({ go: [reply('ok')] });
    const id = await api.start();
    const response = await api.request(`/conversations/${id}/yield`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: false });
  });

  it('refuses an unknown conversation', async () => {
    const api = testApi({ go: [reply('ok')] });
    const response = await api.request(`/conversations/${UNKNOWN_ID}/yield`, { method: 'POST' });

    expect(response.status).toBe(404);
  });
});
