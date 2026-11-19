import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { FileConversationStore } from '../../conversation-store/conversation-store.service.js';
import { ProfileStore } from '../../profile-store/profile-store.service.js';

const temp = useTempFolder('legacy-effort-');
const MODEL = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
const PROFILE = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
const CONVERSATION = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const SESSION = '7c3e1a90-2b4d-4e6f-8a1c-3d5e7f9b0a12';

async function writeFileIn(params: { file: string; value: unknown }) {
  await mkdir(path.dirname(params.file), { recursive: true });
  await writeFile(params.file, JSON.stringify(params.value));
}

describe('files written before "mode" became "effort"', () => {
  it('reads an old profile.json, and saves it in the new form', async () => {
    const store = new ProfileStore({ root: temp.path() });
    const file = path.join(store.folderOf(PROFILE), 'profile.json');

    await writeFileIn({
      file,
      value: {
        id: PROFILE,
        name: 'Work',
        lastModelSelection: { modelId: MODEL, mode: 'high' },
        modelModes: { [MODEL]: 'high' },
      },
    });

    const profile = await store.get(PROFILE);

    expect(profile?.modelEfforts).toEqual({ [MODEL]: 'high' });
    expect(profile?.lastModelSelection).toEqual({ modelId: MODEL, effort: 'high' });

    if (profile) await store.put(profile);

    const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

    expect(saved).toEqual({
      id: PROFILE,
      name: 'Work',
      lastModelSelection: { modelId: MODEL, effort: 'high' },
      modelEfforts: { [MODEL]: 'high' },
    });
  });

  it('lists an old conversation index, and saves it in the new form', async () => {
    const folder = path.join(temp.path(), 'workspace');
    const store = new FileConversationStore({ folder, onProblem: () => undefined });
    const file = path.join(folder, 'conversations', CONVERSATION, 'index.json');
    const old = {
      id: CONVERSATION,
      title: 'Chat',
      modelId: MODEL,
      mode: 'low',
      workspace: '/work/repo',
      profile: PROFILE,
      status: 'closed',
      startedAt: 1,
      updatedAt: 2,
    };

    await writeFileIn({ file, value: old });

    const [listed] = await store.list();
    const { mode: _mode, ...rest } = old;

    expect(listed).toEqual({ ...rest, effort: 'low' });

    if (listed) await store.writeIndex(listed);

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ...rest, effort: 'low' });
  });

  it('reads an old stream.jsonl, so a conversation from before the rename can be reopened', async () => {
    const folder = path.join(temp.path(), 'workspace');
    const store = new FileConversationStore({ folder, onProblem: () => undefined });
    const session = {
      id: SESSION,
      rootId: SESSION,
      depth: 1,
      title: 'Chat',
      state: 'running',
      startedAt: 1,
      modelId: MODEL,
    };
    const line = (effort: Record<string, string>) => ({
      seq: 0,
      sessionId: SESSION,
      kind: 'update',
      update: {
        type: 'session_model',
        session: { ...session, ...effort },
        modelId: MODEL,
        ...effort,
      },
      at: 2,
    });
    const file = path.join(folder, 'conversations', CONVERSATION, 'stream.jsonl');

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(line({ mode: 'high' }))}\n`);

    const read = [];

    for await (const entry of store.entries(CONVERSATION).read()) read.push(entry);

    expect(read).toEqual([line({ effort: 'high' })]);
  });

  it('reports an old index with an invalid mode without showing what the conversation holds', async () => {
    const folder = path.join(temp.path(), 'workspace');
    const reported: string[] = [];
    const store = new FileConversationStore({
      folder,
      onProblem: (problem) => reported.push(problem.message),
    });
    const file = path.join(folder, 'conversations', CONVERSATION, 'index.json');

    await writeFileIn({
      file,
      value: {
        id: CONVERSATION,
        title: 'PRIVATE-TITLE',
        modelId: MODEL,
        mode: 'turbo',
        workspace: '/work/repo',
        profile: PROFILE,
        status: 'closed',
        startedAt: 1,
        updatedAt: 2,
      },
    });

    expect(await store.list()).toEqual([]);
    expect(reported).toHaveLength(1);
    expect(reported[0]).not.toContain('PRIVATE-TITLE');
  });
});
