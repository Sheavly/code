import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONVERSATION, READER, entry, indexOf } from '@sheavly/testing/store/store-contract.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { FileProblem } from '../../listing/listing.types.js';
import { expectPrivate, useTempFolder } from '../../testing/temp-folder.fake.js';
import { FileConversationStore } from '../conversation-store.service.js';

const temp = useTempFolder('file-conversations-');
const OTHER = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');
const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;
const RECORD = { seq: 0, entry: { role: 'user' as const, content: 'hi' } };

/** A store on the temp folder, and the problems its listing reported. */
function open() {
  const problems: FileProblem[] = [];
  const store = new FileConversationStore({
    folder: temp.path(),
    onProblem: (problem) => problems.push(problem),
  });

  return { store, problems, conversations: path.join(temp.path(), 'conversations') };
}

async function drain(source: AsyncIterable<{ seq: number }>) {
  const seqs: number[] = [];

  for await (const each of source) seqs.push(each.seq);

  return seqs;
}

describe('FileConversationStore on disk', () => {
  it('keeps a conversation as a folder named by its id, with each part in its own file', async () => {
    const { store, conversations } = open();
    const folder = path.join(conversations, CONVERSATION);

    await store.writeIndex(indexOf(CONVERSATION, 1));
    await store.entries(CONVERSATION).append(entry(0));
    await store.history({ id: CONVERSATION }).append([RECORD]);
    await store.history({ id: CONVERSATION, session: READER }).append([RECORD]);

    expect((await readdir(folder)).sort()).toEqual([
      'agents',
      'history.jsonl',
      'index.json',
      'stream.jsonl',
    ]);
    expect(await readdir(path.join(folder, 'agents'))).toEqual([`${READER}.history.jsonl`]);
  });

  it.skipIf(!canChmod)('keeps what it writes private to the user', async () => {
    const { store, conversations } = open();

    await store.writeIndex(indexOf(CONVERSATION, 1));
    await store.entries(CONVERSATION).append(entry(0));
    await store.history({ id: CONVERSATION }).append([RECORD]);

    for (const name of ['index.json', 'stream.jsonl', 'history.jsonl']) {
      await expectPrivate(path.join(conversations, CONVERSATION, name));
    }
  });

  it('writes the stream a line an entry, so it can be followed with a pager', async () => {
    const { store, conversations } = open();

    await store.entries(CONVERSATION).append(entry(0));
    await store.entries(CONVERSATION).append(entry(1));

    const lines = (await readFile(path.join(conversations, CONVERSATION, 'stream.jsonl'), 'utf8'))
      .trim()
      .split('\n');

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({ seq: 1 });
  });

  it('carries on after a restart: a new store counts the stream from the file', async () => {
    const first = open().store;

    await first.entries(CONVERSATION).append(entry(0));
    await first.entries(CONVERSATION).append(entry(1));

    const second = open().store;

    await expect(second.entries(CONVERSATION).append(entry(1))).rejects.toMatchObject({
      reason: 'out_of_order',
    });
    await second.entries(CONVERSATION).append(entry(2));
    expect(await drain(open().store.entries(CONVERSATION).read())).toEqual([0, 1, 2]);
  });

  it('cuts a line a crash left half-written, so the next entry does not join onto it', async () => {
    const { store, conversations } = open();
    const stream = path.join(conversations, CONVERSATION, 'stream.jsonl');

    await store.entries(CONVERSATION).append(entry(0));
    await appendFile(stream, '{"seq":1,"sessionId":"ma');

    const restarted = open().store;

    expect(await drain(restarted.entries(CONVERSATION).read())).toEqual([0]);
    await restarted.entries(CONVERSATION).append(entry(1));
    expect(await drain(open().store.entries(CONVERSATION).read())).toEqual([0, 1]);
  });

  it.skipIf(!canChmod)(
    'counts the stream again after a write that failed, since the line may have reached the file',
    async () => {
      const { store, conversations } = open();
      const stream = path.join(conversations, CONVERSATION, 'stream.jsonl');

      await store.entries(CONVERSATION).append(entry(0));
      // A file that cannot be appended to: the write fails, and the count must not move on.
      await chmod(stream, 0o400);

      await expect(store.entries(CONVERSATION).append(entry(1))).rejects.toMatchObject({
        name: 'StoreError',
        reason: 'failed',
      });

      await chmod(stream, 0o600);
      // Entry 1 never landed, so it is still the next one; had the failed write moved the count on,
      // 2 would be accepted here and the stream would skip an entry.
      await expect(store.entries(CONVERSATION).append(entry(2))).rejects.toMatchObject({
        reason: 'out_of_order',
      });
      await store.entries(CONVERSATION).append(entry(1));
      expect(await drain(store.entries(CONVERSATION).read())).toEqual([0, 1]);
    },
  );

  it('serialises appends sent together, so each lands in order and none is lost', async () => {
    const { store } = open();
    const stream = store.entries(CONVERSATION);
    const sent = Array.from({ length: 25 }, (_, seq) => stream.append(entry(seq)));

    await Promise.all(sent);

    expect(await drain(stream.read())).toEqual(Array.from({ length: 25 }, (_, seq) => seq));
  });

  it('refuses a stream with a gap in it, naming the file and not what it holds', async () => {
    const { conversations } = open();
    const folder = path.join(conversations, CONVERSATION);

    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'stream.jsonl'),
      `${JSON.stringify(entry(0))}\n${JSON.stringify(entry(2))}\n`,
    );

    const append = open().store.entries(CONVERSATION).append(entry(3));

    await expect(append).rejects.toMatchObject({ name: 'StoreError', reason: 'failed' });
    await expect(append).rejects.toThrow(/stream\.jsonl/);
    await expect(append).rejects.not.toThrow(/t0/);
  });

  it('refuses a session id that is not safe to name a file after, and makes nothing', async () => {
    const { store, conversations } = open();
    const unsafe = ['main', '../../x', '', 'a/b', READER.toUpperCase()];

    for (const session of unsafe) {
      const log = () =>
        store.history({ id: CONVERSATION, session: sessionIdSchema.parse(session) });

      expect(log).toThrow(expect.objectContaining({ name: 'StoreError' }));
    }

    await expect(readdir(conversations)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes a conversation’s folder and starts a new one under that id from its first entry', async () => {
    const { store, conversations } = open();

    await store.writeIndex(indexOf(CONVERSATION, 1));
    await store.entries(CONVERSATION).append(entry(0));
    await store.entries(OTHER).append(entry(0));
    await store.delete(CONVERSATION);

    expect(await readdir(conversations)).toEqual([OTHER]);
    await store.entries(CONVERSATION).append(entry(0));
    expect(await drain(store.entries(CONVERSATION).read())).toEqual([0]);
  });

  it.skipIf(process.platform === 'win32')(
    'deletes a conversation that is a link as the link only, never what it points to',
    async () => {
      const { store, conversations } = open();
      const elsewhere = path.join(temp.path(), 'elsewhere');

      await mkdir(conversations, { recursive: true });
      await mkdir(elsewhere);
      await writeFile(path.join(elsewhere, 'precious.txt'), 'x');
      await symlink(elsewhere, path.join(conversations, CONVERSATION), 'dir');

      await store.delete(CONVERSATION);

      expect((await stat(path.join(elsewhere, 'precious.txt'))).isFile()).toBe(true);
      expect(await readdir(conversations)).toEqual([]);
    },
  );
});

describe('FileConversationStore listing', () => {
  it('lists the rest and reports a problem for each folder that is not a usable conversation', async () => {
    const { store, problems, conversations } = open();

    await store.writeIndex(indexOf(OTHER, 20));
    await store.writeIndex(indexOf(CONVERSATION, 10));
    await mkdir(path.join(conversations, 'not-an-id'));
    await mkdir(path.join(conversations, '3b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a99'));
    await writeFile(
      path.join(conversations, '3b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a99', 'index.json'),
      '{ not json',
    );
    await mkdir(path.join(conversations, '5b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a98'));
    await writeFile(
      path.join(conversations, '5b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a98', 'index.json'),
      JSON.stringify(indexOf(CONVERSATION, 5)),
    );

    expect((await store.list()).map((c) => c.id)).toEqual([CONVERSATION, OTHER]);
    expect(
      problems.map((p) => path.basename(path.dirname(p.file)) + '/' + path.basename(p.file)),
    ).toEqual(
      expect.arrayContaining([
        `${path.basename(conversations)}/not-an-id`,
        '3b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a99/index.json',
        '5b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a98/index.json',
      ]),
    );
    expect(problems).toHaveLength(3);
  });

  it('does not quote a damaged index in what it reports: a conversation is private', async () => {
    const { store, problems, conversations } = open();
    const folder = path.join(conversations, CONVERSATION);

    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'index.json'), '{ "title": "my private plan" ');
    await store.list();

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).not.toContain('private plan');
  });

  it('skips litter and a folder whose stream has started but whose index is not written yet', async () => {
    const { store, problems, conversations } = open();

    await store.entries(CONVERSATION).append(entry(0));
    await writeFile(path.join(conversations, '.DS_Store'), 'x');
    await mkdir(path.join(conversations, '.hidden'));
    await writeFile(path.join(conversations, 'Thumbs.db'), 'x');

    expect(await store.list()).toEqual([]);
    // Litter and a conversation still being written are neither listed nor a problem.
    expect(problems).toEqual([]);
  });

  it('lists nothing before anything is stored', async () => {
    expect(await open().store.list()).toEqual([]);
  });

  it.skipIf(!canChmod)(
    'fails the list when the folder cannot be read, not as an empty one',
    async () => {
      const { store, conversations } = open();

      await store.writeIndex(indexOf(CONVERSATION, 1));
      await chmod(conversations, 0o000);

      try {
        await expect(store.list()).rejects.toMatchObject({ name: 'StoreError', reason: 'failed' });
      } finally {
        await chmod(conversations, 0o700);
      }
    },
  );
});
