import { describe, expect, it, vi } from 'vitest';
import { fakeServer } from '@sheavly/client/testing/fake-server.fake';
import { API_ROUTES } from '@sheavly/protocol/api/api.constants';
import type { FakeHandlers } from '@sheavly/client/testing/testing.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { FAKE_CONVERSATION, fakeConversationDetails } from '../../testing/workbook-run.fake.js';
import { connectBackend } from '../backend.helper.js';
import { openSession } from '../session.helper.js';

vi.mock('../backend.helper.js', () => ({ connectBackend: vi.fn() }));

const WORK = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const HOME = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
const GHOST = profileIdSchema.parse('c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53');
const SPOOFED = profileIdSchema.parse('5d0f8b36-9c14-4e72-a3b8-7e1c2d4f6a90');
const SPOOFED_UNREADY = profileIdSchema.parse('6e1a9c47-0d25-4f83-b4c9-8f2d3e5a7b01');
const ESCAPES = 'x\u001b]0;pwned\u0007\u001b[2Jy';
const NAMES = new Map([
  [WORK, { name: 'Work', ready: true }],
  [HOME, { name: 'Home', ready: false }],
  [SPOOFED, { name: ESCAPES, ready: true }],
  [SPOOFED_UNREADY, { name: ESCAPES, ready: false }],
]);
const STORED = conversationIdSchema.parse('7a1c0e55-2b3d-4c8e-9f60-1d2e3f4a5b6c');
// Every route that changes data, derived so a new write route is covered; a start itself opens a
// conversation, and a failed start closes it.
const OPENING = ['startConversation', 'reopenConversation', 'closeConversation'];
const WRITES = Object.entries(API_ROUTES)
  .filter(([name, route]) => route.effect === 'change' && !OPENING.includes(name))
  .map(([name]) => name);

/** A backend that knows `WORK` (ready) and `HOME` (not ready), and one stored conversation on `HOME`. */
function session(overrides: FakeHandlers = {}) {
  const server = fakeServer({
    getProfile: ({ params }) => {
      const id = profileIdSchema.parse(params.profile);
      const found = NAMES.get(id);

      if (!found) return { refuse: { status: 404, code: 'not_found', message: 'No profile' } };

      return { id, name: found.name, ready: found.ready, models: [] };
    },
    startConversation: () => ({ id: FAKE_CONVERSATION }),
    reopenConversation: () => ({ id: STORED }),
    getConversation: () => ({ ...fakeConversationDetails('/work'), profile: WORK }),
    queryStoredConversations: () => ({
      conversations: [
        {
          id: STORED,
          title: 'old',
          modelId: modelIdSchema.parse('00000000-0000-4000-8000-000000000002'),
          effort: 'medium',
          workspace: '/work',
          profile: HOME,
          status: 'closed',
          startedAt: 0,
          updatedAt: 0,
        },
      ],
    }),
    closeConversation: () => undefined,
    ...overrides,
  });

  vi.mocked(connectBackend).mockResolvedValue({
    url: 'http://backend.test',
    token: 'test',
    fetch: server.fetch,
    stop: async () => undefined,
  });

  const names = () => server.calls.map(({ name }) => name);
  const open = (args: string[], prepare = vi.fn(async () => undefined)) => {
    const written: string[] = [];

    return {
      prepare,
      written,
      started: openSession({ env: {}, args, write: (text) => written.push(text), prepare }),
    };
  };

  return { calls: server.calls, names, open };
}

describe('a session on a chosen profile', () => {
  it('starts on it, names it in the banner and keeps the flag out of the prompt', async () => {
    const run = session();
    const { started, written } = run.open(['hello', '--profile', WORK, 'there']);
    const opened = await started;

    expect(opened.prompt).toBe('hello there');
    expect(run.calls.find(({ name }) => name === 'startConversation')?.call.body).toEqual({
      profile: WORK,
    });
    expect(written.join('')).toContain(`→ profile Work (${WORK})`);
  });

  it('changes nothing and never asks setup or the workspace binding: it is for this run only', async () => {
    const run = session();
    const { started, prepare } = run.open(['--profile', WORK]);

    await started;
    expect(prepare).not.toHaveBeenCalled();
    expect(run.names().filter((name) => WRITES.includes(name))).toEqual([]);
    expect(run.names()).not.toContain('queryWorkspaceProfile');
    expect(run.names()).not.toContain('getSetup');
  });

  it('leaves the choice to the backend and to setup when no profile is named', async () => {
    const run = session();
    const { started, prepare } = run.open(['hello']);

    await started;
    expect(prepare).toHaveBeenCalledOnce();
    expect(run.calls.find(({ name }) => name === 'startConversation')?.call.body).toEqual({});
  });

  it('refuses an unknown profile before a conversation starts, never falling back', async () => {
    const run = session();

    await expect(run.open(['--profile', GHOST]).started).rejects.toThrow(
      `There is no profile ${GHOST}`,
    );
    expect(run.names()).not.toContain('startConversation');
  });

  it('refuses a profile that is not ready, naming it, before a conversation starts', async () => {
    const run = session();

    await expect(run.open(['--profile', HOME]).started).rejects.toThrow(
      `Home (${HOME}) is not ready`,
    );
    expect(run.names()).not.toContain('startConversation');
  });

  it('shows a profile name as plain text in the banner: no escape sequence reaches the terminal', async () => {
    const run = session({
      getConversation: () => ({ ...fakeConversationDetails('/work'), profile: SPOOFED }),
    });
    const { started, written } = run.open(['--profile', SPOOFED]);

    await started;
    expect(written.join('')).not.toContain('\u001b');
    expect(written.join('')).not.toContain('\u0007');
    expect(written.join('')).toContain(`(${SPOOFED})`);
  });

  it('shows a profile name as plain text when it is not ready', async () => {
    const run = session();
    const failure = await run
      .open(['--profile', SPOOFED_UNREADY])
      .started.catch((caughtError: unknown) => caughtError);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain('\u001b');
    expect((failure as Error).message).toContain('is not ready');
  });

  it('refuses a malformed id before a backend is started', async () => {
    vi.mocked(connectBackend).mockClear();
    await expect(
      openSession({ env: {}, args: ['--profile', 'work'], write: () => undefined }),
    ).rejects.toThrow('--profile requires a profile id');
    expect(connectBackend).not.toHaveBeenCalled();
  });
});

describe('--resume with --profile', () => {
  it('runs on the conversation’s own profile and says a differing --profile was ignored', async () => {
    const run = session();
    const { started, written } = run.open(['--resume', STORED, '--profile', WORK]);

    await started;
    expect(written.join('')).toContain(
      `runs on its own profile Home (${HOME}); --profile ${WORK} ignored`,
    );
    expect(run.names()).toContain('reopenConversation');
    expect(run.names()).not.toContain('startConversation');
  });

  it('says nothing when --profile is the conversation’s own', async () => {
    const run = session();
    const { started, written } = run.open(['--resume', STORED, '--profile', HOME]);

    await started;
    expect(written.join('')).not.toContain('ignored');
    expect(run.names()).toContain('reopenConversation');
  });

  it('does not check the ignored profile: an unready or unknown one cannot fail a resume', async () => {
    const run = session();

    await run.open(['--resume', STORED, '--profile', GHOST]).started;
    expect(
      run.calls.filter(({ name }) => name === 'getProfile').map(({ call }) => call.params.profile),
    ).not.toContain(GHOST);
  });
});
