import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  conversationDetailsSchema,
  conversationIdSchema,
} from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { connectBackend } from '../client/backend.helper.js';

/** The conversation and main session a fake backend answers with. */
export const FAKE_CONVERSATION = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
export const FAKE_MAIN_SESSION = sessionIdSchema.parse('main');

/** A run request for a fixture prompt, with the given text. */
export function fakeRunRequest(text: string) {
  return { name: 'fixture', text, keep: false, trust: false, showModelCalls: false };
}

/**
 * Test-only: what every workbook run test needs around a fake backend. Call it once in a test
 * file, whose own `vi.mock` replaces `connectBackend`: it makes `BACKEND_URL` empty, silences
 * stdout, and after each test restores mocks and removes the folders `keep` was given.
 */
export function useWorkbookRunEnvironment() {
  const roots: string[] = [];

  beforeEach(() => {
    vi.stubEnv('BACKEND_URL', '');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(connectBackend).mockReset();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  return { keep: (root: string) => roots.push(root) };
}

/** The details a fake backend returns for its conversation, running in `workspace`. */
export function fakeConversationDetails(workspace: string) {
  return conversationDetailsSchema.parse({
    id: FAKE_CONVERSATION,
    title: 'fixture',
    session: FAKE_MAIN_SESSION,
    running: false,
    startedAt: 0,
    workspace,
    profile: '00000000-0000-4000-8000-000000000003',
    model: {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Fake',
      adapter: 'openai',
      model: 'fake',
    },
    models: [],
    projectTrust: 'no_hooks',
    permissionMode: 'ask',
  });
}
