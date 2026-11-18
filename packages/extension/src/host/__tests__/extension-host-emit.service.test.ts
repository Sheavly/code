import { MAX_EXTENSION_DATA_BYTES } from '@sheavly/protocol/extension/extension.constants';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ExtensionEmission, ExtensionEmit } from '../../emit/emit.types.js';
import {
  ExtensionActivationError,
  ExtensionContributionChangedError,
} from '../../errors/extension.errors.js';
import { ExtensionEmitError } from '../../errors/emit.errors.js';
import { ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import type { Contributions } from '../../extension/extension.types.js';
import type { FakeExtensionFields } from '../../testing/extension-fake.types.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const shape = z.object({ done: z.number() });
const contributes: Contributions = {
  events: [{ kind: 'notes.progress', version: 3, schema: shape }],
  notices: [{ topic: 'notes.reminder', version: 2, schema: shape }],
};

/** A host with one extension; `emit` is its capability, `sent` what the sink received. */
async function runNotes(params: { fields?: Partial<FakeExtensionFields>; sink?: boolean } = {}) {
  const sent: ExtensionEmission[] = [];
  let emit: ExtensionEmit | undefined;
  const host = new ExtensionHost({
    extensions: [
      fakeExtension({
        name: 'notes',
        contributes,
        ...params.fields,
        activate: (context) => {
          emit = context.emit;

          return params.fields?.activate?.(context) ?? params.fields?.contributes ?? contributes;
        },
      }),
    ],
    emit: params.sink === false ? undefined : (emission) => void sent.push(emission),
  });
  const result = await host.activate({ signal });

  if (emit === undefined) throw new Error('the extension never activated');

  return { host, result, sent, emit };
}

const progress = { kind: 'notes.progress', data: { done: 1 }, text: 'one done' };
const reminder = { topic: 'notes.reminder', data: { done: 1 }, text: 'remember' };

describe('ExtensionHost emit', () => {
  it('sends a declared event to the sink with the extension name and the contributed version', async () => {
    const { emit, sent } = await runNotes();

    emit.event(progress);

    expect(sent).toEqual([
      {
        kind: 'event',
        session: undefined,
        event: {
          type: 'extension_event',
          extension: 'notes',
          kind: 'notes.progress',
          version: 3,
          data: { done: 1 },
          text: 'one done',
        },
      },
    ]);
  });

  it('sends a notice with its topic and the contributed version, for the given session', async () => {
    const { emit, sent } = await runNotes();
    const id = sessionIdSchema.parse('main');
    const session: SessionRef = { id, rootId: id, depth: 1 };

    emit.notice({ ...reminder, session });

    expect(sent).toEqual([
      {
        kind: 'notice',
        session: 'main',
        notice: {
          kind: 'extension-notice',
          extension: 'notes',
          topic: 'notes.reminder',
          version: 2,
          data: { done: 1 },
          text: 'remember',
        },
      },
    ]);
  });

  it('merges the contributions of the activated extensions', async () => {
    const { result } = await runNotes();

    expect(result.contributions.events.map((event) => event.kind)).toEqual(['notes.progress']);
    expect(result.contributions.notices.map((notice) => notice.topic)).toEqual(['notes.reminder']);
  });

  it('refuses an emit of a kind it did not contribute, even if the manifest declares it', async () => {
    const { emit, sent } = await runNotes({ fields: { emits: { events: ['notes.other'] } } });

    expect(() => emit.event({ ...progress, kind: 'notes.other' })).toThrow(ExtensionEmitError);
    expect(() => emit.event({ ...progress, kind: 'notes.other' })).toThrow(/notes.*notes\.other/);
    expect(sent).toEqual([]);
  });

  it('refuses a kind the manifest does not declare, naming the extension', async () => {
    const { emit } = await runNotes();

    expect(() => emit.event({ ...progress, kind: 'notes.secret' })).toThrow(
      ExtensionUndeclaredError,
    );
    expect(() => emit.event({ ...progress, kind: 'other.progress' })).toThrow(/Extension notes/);
  });

  it('refuses a notice topic outside its namespace', async () => {
    const { emit } = await runNotes();

    expect(() => emit.notice({ ...reminder, topic: 'other.reminder' })).toThrow(
      ExtensionUndeclaredError,
    );
  });

  it('refuses a notice when the manifest does not set modelFacingNotices', async () => {
    const { emit, sent } = await runNotes({
      fields: { contributes: { events: contributes.events }, emits: { modelFacingNotices: false } },
    });

    expect(() => emit.notice(reminder)).toThrow(/emits\.modelFacingNotices/);
    expect(() => emit.notice(reminder)).toThrow(ExtensionUndeclaredError);
    expect(sent).toEqual([]);
  });

  it('throws on data that fails its schema, naming the paths and never the values', async () => {
    const { emit, sent } = await runNotes();
    const secret = 'sk-very-secret-value';
    let message = '';

    try {
      emit.event({ ...progress, data: { done: secret } });
    } catch (caughtError) {
      expect(caughtError).toBeInstanceOf(ExtensionEmitError);
      message = (caughtError as Error).message;
    }

    expect(message).toContain('Extension notes');
    expect(message).toContain('notes.progress');
    expect(message).toContain('done');
    expect(message).not.toContain(secret);
    expect(sent).toEqual([]);
  });

  it('throws on text that is empty or over the cap, and on data over the byte cap', async () => {
    const big = z.object({ blob: z.string() });
    const { emit } = await runNotes({
      fields: {
        contributes: { events: [{ kind: 'notes.progress', version: 1, schema: big }] },
      },
    });
    const call = (extra: object) => () =>
      emit.event({ kind: 'notes.progress', data: { blob: 'x' }, text: 'ok', ...extra });

    expect(call({ text: 'x'.repeat(2001) })).toThrow(/text \(too_big\)/);
    expect(call({ text: '' })).toThrow(/text \(too_small\)/);
    expect(call({ data: { blob: 'x'.repeat(MAX_EXTENSION_DATA_BYTES) } })).toThrow(
      /invalid at data \(custom\)/,
    );
    expect(call({})).not.toThrow();
  });

  it('throws before activate returned', async () => {
    let early: unknown;

    await runNotes({
      fields: {
        activate: (context) => {
          try {
            context.emit.event(progress);
          } catch (caughtError) {
            early = caughtError;
          }

          return contributes;
        },
      },
    });

    expect(early).toBeInstanceOf(ExtensionEmitError);
    expect((early as Error).message).toMatch(/not activated yet/);
  });

  it('throws when the host has no sink', async () => {
    const { emit } = await runNotes({ sink: false });

    expect(() => emit.event(progress)).toThrow(/no emit sink/);
  });

  it('fails the activation of an extension that contributes an undeclared event kind', async () => {
    const { result } = await runNotes({
      fields: {
        contributes: {},
        activate: () => ({ events: [{ kind: 'notes.secret', version: 1, schema: shape }] }),
      },
    });

    const [failed] = result.failed;

    expect(failed).toBeInstanceOf(ExtensionActivationError);
    expect(failed?.cause).toMatchObject({ extension: 'notes', use: 'event' });
    expect(result.active).toEqual([]);
  });

  it('fails the activation of an extension that contributes a notice without modelFacingNotices', async () => {
    const { result } = await runNotes({
      fields: {
        contributes: {},
        activate: () => ({ notices: contributes.notices }),
      },
    });

    expect(result.failed[0]?.cause).toMatchObject({ extension: 'notes', use: 'notice' });
  });

  it('merges the events of two extensions in activation order', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({ name: 'notes', contributes }),
        fakeExtension({
          name: 'other',
          contributes: { events: [{ kind: 'other.progress', version: 1, schema: shape }] },
        }),
      ],
    });
    const { contributions } = await host.activate({ signal });

    expect(contributions.events.map((event) => event.kind)).toEqual([
      'notes.progress',
      'other.progress',
    ]);
  });

  // Names are namespaced by the extension, so only one extension can repeat its own.
  it.each([
    ['event', { events: [...(contributes.events ?? []), ...(contributes.events ?? [])] }],
    ['notice', { notices: [...(contributes.notices ?? []), ...(contributes.notices ?? [])] }],
  ])('throws a collision for a %s contributed twice', async (contribution, twice) => {
    const host = new ExtensionHost({
      extensions: [fakeExtension({ name: 'notes', contributes: twice })],
    });

    await expect(host.activate({ signal })).rejects.toMatchObject({
      name: 'ContributionCollisionError',
      contribution,
    });
  });

  it('fails an extension whose event list changed after the check', async () => {
    const list = [...(contributes.events ?? [])];
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'notes',
          activate: () => ({ events: list }),
          emits: { events: ['notes.progress', 'notes.more'] },
        }),
        fakeExtension({
          name: 'late',
          activate: () => {
            list.push({ kind: 'notes.more', version: 1, schema: shape });

            return {};
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed[0]?.cause).toBeInstanceOf(ExtensionContributionChangedError);
    expect(result.failed[0]?.cause).toMatchObject({ contribution: 'event' });
    expect(result.contributions.events).toEqual([]);
  });

  it('fails an extension whose notice list changed after the check', async () => {
    const list = [...(contributes.notices ?? [])];
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'notes',
          emits: { modelFacingNotices: true },
          activate: () => ({ notices: list }),
        }),
        fakeExtension({
          name: 'late',
          activate: () => {
            list.length = 0;

            return {};
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed[0]?.cause).toMatchObject({ contribution: 'notice' });
  });
});
