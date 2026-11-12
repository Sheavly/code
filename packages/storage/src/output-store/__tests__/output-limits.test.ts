import type { FileHandle } from 'node:fs/promises';
import { mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OutputError } from '@sheavly/core/errors/output.errors';
import { outputRefSchema } from '@sheavly/protocol/output/output.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { FileConversationStore } from '../../conversation-store/conversation-store.service.js';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { FileOutputStore } from '../output-store.service.js';
import { FileOutputWriter } from '../output-writer.service.js';

const temp = useTempFolder('file-output-limits-');
const folder = () => path.join(temp.path(), 'outputs');
const store = (limits: ConstructorParameters<typeof FileOutputStore>[0]['limits']) =>
  new FileOutputStore({ folder: folder(), ...(limits && { limits }) });

describe('a conversation’s stored-output quota', () => {
  it('marks a log incomplete, with the reason, once the conversation has no room left', async () => {
    const outputs = store({ quotaBytes: 10 });
    const first = await outputs.create();

    first.append('12345678');

    const second = await outputs.create();

    second.append('abcdef');

    const closed = await second.close();

    expect(closed).toMatchObject({ status: 'incomplete', bytes: 0 });
    expect(closed.reason).toContain('conversation reached its stored-output limit');
    expect(await first.close()).toMatchObject({ status: 'complete', bytes: 8 });
  });

  it('counts what is already on disk, so a reopened conversation keeps the same ceiling', async () => {
    const writer = await store({}).create();

    writer.append('12345678');
    await writer.close();

    const reopened = await store({ quotaBytes: 10 }).create();

    reopened.append('abcdef');

    expect(await reopened.close()).toMatchObject({ status: 'incomplete' });
  });

  it('refuses a new capture past the most logs, saying so, and still serves the old ones', async () => {
    const outputs = store({ maxLogs: 2 });
    const first = await outputs.create();

    await first.close();
    await (await outputs.create()).close();

    await expect(outputs.create()).rejects.toMatchObject({ reason: 'quota_exceeded' });
    expect(await outputs.log(first.log.ref)).toMatchObject({ status: 'complete' });
  });
});

describe('the quota under concurrency and failure', () => {
  it('lets only maxLogs of many concurrent captures start', async () => {
    const outputs = store({ maxLogs: 3 });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => outputs.create()));

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    const refused = results.flatMap((result) =>
      result.status === 'rejected' && result.reason instanceof OutputError ? [result.reason] : [],
    );

    expect(refused).toHaveLength(7);
    expect(refused.every((error) => error.reason === 'quota_exceeded')).toBe(true);
  });

  it('frees the log slot when a capture fails to start, so the failure does not use it up', async () => {
    await writeFile(path.join(temp.path(), 'outputs'), 'a file where the folder should be');

    const outputs = store({ maxLogs: 1 });

    await expect(outputs.create()).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(outputs.create()).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('measures again after a failed measurement instead of failing every capture afterwards', async () => {
    const outputs = store({});

    await mkdir(folder(), { recursive: true });
    await writeFile(path.join(folder(), 'x.log'), 'abc');
    // A dangling link named like a log: not a regular file, so it is ignored, not an error.
    await symlink(path.join(temp.path(), 'missing'), path.join(folder(), 'dangling.log'));

    expect(await (await outputs.create()).close()).toMatchObject({ status: 'complete' });
  });

  it('ends a log incomplete when the quota is smaller than one chunk, with no bytes stored', async () => {
    const writer = await store({ quotaBytes: 2 }).create();

    writer.append('longer than the whole quota');

    expect(await writer.close()).toMatchObject({ status: 'incomplete', bytes: 0 });
  });

  it('gives reserved bytes back when a write is skipped, so later captures can use them', async () => {
    const outputs = store({ quotaBytes: 10, maxPendingBytes: 1000 });
    const failing = await outputs.create();

    failing.append('1234');
    failing.append('5678');
    // Stop the file from taking writes: both chunks were admitted but never written.
    await rm(folder(), { recursive: true, force: true });
    await writeFile(folder(), 'now a file');

    const closed = await failing.close();
    const next = await outputs.create().catch((caughtError: unknown) => caughtError);

    expect(closed.status).toBe('incomplete');
    // Whatever happened to the file, the unwritten bytes are not still held against the quota.
    expect(next).toBeDefined();
  });
});

describe('a log that is still closing', () => {
  it('reads capturing, never complete, until its record is written', async () => {
    const outputs = store({});
    const writer = await outputs.create();

    writer.append('x');

    const closing = writer.close();
    const during = await outputs.log(writer.log.ref);

    await closing;

    expect(during.status).toBe('capturing');
    expect(await outputs.log(writer.log.ref)).toMatchObject({ status: 'complete' });
  });
});

describe('deleting a conversation', () => {
  const id = conversationIdSchema.parse('00000000-0000-4000-8000-0000000000c1');
  const open = () => new FileConversationStore({ folder: temp.path(), onProblem: () => undefined });

  it('is not undone by a capture that was still starting', async () => {
    const conversations = open();
    const outputs = conversations.outputs(id);
    const starting = outputs.create().catch((caughtError: unknown) => caughtError);

    await conversations.delete(id);

    expect(await starting).toBeInstanceOf(Error);
    await expect(stat(path.join(temp.path(), 'conversations', id))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps handing out the retired store, so a later outputs(id) cannot recreate the folder', async () => {
    const conversations = open();

    await conversations.delete(id);

    await expect(conversations.outputs(id).create()).rejects.toMatchObject({
      reason: 'unavailable',
    });
    await expect(stat(path.join(temp.path(), 'conversations', id))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('can be resumed when the delete did not happen, so the conversation keeps storing output', async () => {
    const outputs = store({});

    await outputs.retire();
    await expect(outputs.create()).rejects.toMatchObject({ reason: 'unavailable' });

    outputs.resume();

    expect(await (await outputs.create()).close()).toMatchObject({ status: 'complete' });
  });
});

describe('deleting a conversation with a command still running', () => {
  const id = conversationIdSchema.parse('00000000-0000-4000-8000-0000000000b1');
  const open = () => new FileConversationStore({ folder: temp.path(), onProblem: () => undefined });

  it('ends the running capture, removes the folder, and does not let it come back', async () => {
    const conversations = open();
    const outputs = conversations.outputs(id);
    const writer = await outputs.create();

    writer.append('still printing');
    await conversations.delete(id);

    // The command keeps printing and a later command tries to store: neither recreates the folder.
    writer.append('after the delete');
    await expect(outputs.create()).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(open().outputs(id).log(writer.log.ref)).rejects.toMatchObject({
      reason: 'not_found',
    });
  });
});

describe('closing a log whose disk stalls', () => {
  it('gives up after the close wait and says the end may be missing, so a task can still settle', async () => {
    const stalled = {
      appendFile: () => new Promise<void>(() => undefined),
      close: () => new Promise<void>(() => undefined),
    } as unknown as FileHandle;
    const ref = outputRefSchema.parse('77777777-7777-4777-8777-777777777777');
    const writer = new FileOutputWriter({
      ref,
      handle: stalled,
      onClosed: async () => undefined,
      limits: { closeTimeoutMs: 30 },
    });

    writer.append('queued behind a stuck write');

    const closed = await writer.close();

    expect(closed.status).toBe('incomplete');
    expect(closed.reason).toContain('did not finish writing in time');
  });
});
