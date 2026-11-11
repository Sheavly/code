import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONVERSATION, indexOf } from '@sheavly/testing/store/store-contract.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { FileConversationStore } from '../conversation-store.service.js';

const temp = useTempFolder('file-conversation-shell-');
const OTHER = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');

function open() {
  return new FileConversationStore({ folder: temp.path(), onProblem: () => undefined });
}

describe('FileConversationStore shell.json', () => {
  it('has nothing stored until an agent sets something', async () => {
    await expect(open().shell(CONVERSATION).load()).resolves.toBeUndefined();
  });

  it('keeps the document in the conversation folder, and across a restart', async () => {
    await open()
      .shell(CONVERSATION)
      .update(() => ({ workingRoot: '/work/tree' }));

    const file = path.join(temp.path(), 'conversations', CONVERSATION, 'shell.json');

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ workingRoot: '/work/tree' });
    await expect(open().shell(CONVERSATION).load()).resolves.toEqual({ workingRoot: '/work/tree' });
  });

  it('shares one document between every caller for a conversation', async () => {
    const store = open();

    await store.shell(CONVERSATION).update(() => ({ workingRoot: '/a' }));

    await expect(store.shell(CONVERSATION).load()).resolves.toEqual({ workingRoot: '/a' });
  });

  it('keeps conversations apart', async () => {
    const store = open();

    await store.shell(CONVERSATION).update(() => ({ workingRoot: '/a' }));

    await expect(store.shell(OTHER).load()).resolves.toBeUndefined();
  });

  it('applies two changes made at once one after the other, never erasing either', async () => {
    const shell = open().shell(CONVERSATION);

    await Promise.all([
      shell.update((current) => ({ ...(current as object), first: 1 })),
      shell.update((current) => ({ ...(current as object), second: 2 })),
    ]);

    await expect(shell.load()).resolves.toEqual({ first: 1, second: 2 });
  });

  it('is removed with the conversation', async () => {
    const store = open();

    await store.writeIndex(indexOf(CONVERSATION, 1));
    await store.shell(CONVERSATION).update(() => ({ workingRoot: '/a' }));
    await store.delete(CONVERSATION);

    await expect(
      stat(path.join(temp.path(), 'conversations', CONVERSATION, 'shell.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.shell(CONVERSATION).load()).resolves.toBeUndefined();
  });

  it('reports a shell.json that is not JSON instead of taking it for empty', async () => {
    const store = open();

    await store.shell(CONVERSATION).update(() => ({}));
    const { writeFile } = await import('node:fs/promises');

    await writeFile(
      path.join(temp.path(), 'conversations', CONVERSATION, 'shell.json'),
      'not json',
    );

    await expect(store.shell(CONVERSATION).load()).rejects.toMatchObject({ name: 'StoreError' });
  });
});
