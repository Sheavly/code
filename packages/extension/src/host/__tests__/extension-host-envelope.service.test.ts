import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ExtensionHost } from '../extension-host.service.js';
import { ExtensionEmitError } from '../../errors/emit.errors.js';
import type { ExtensionEmission, ExtensionEmit } from '../../emit/emit.types.js';
import type { Contributions } from '../../extension/extension.types.js';
import type { FakeExtensionFields } from '../../testing/extension-fake.types.js';
import { fakeExtension } from '../../testing/extension.fake.js';

const anything = z.any();
const shape = z.object({ done: z.number() });
const signal = new AbortController().signal;

/** Activates one `notes` extension with `contributes`; returns its capability and what the sink got. */
async function activateNotes(params: {
  contributes: Contributions;
  emits?: FakeExtensionFields['emits'] | undefined;
}) {
  const sent: ExtensionEmission[] = [];
  let emit: ExtensionEmit | undefined;
  const host = new ExtensionHost({
    extensions: [
      fakeExtension({
        name: 'notes',
        contributes: params.contributes,
        emits: params.emits ?? {},
        activate: (context) => {
          emit = context.emit;

          return params.contributes;
        },
      }),
    ],
    emit: (emission) => void sent.push(emission),
  });
  const result = await host.activate({ signal });

  if (emit === undefined) throw new Error('the extension never activated');

  return { result, emit, sent };
}

const open: Contributions = {
  events: [{ kind: 'notes.any', version: 1, schema: anything }],
  notices: [{ topic: 'notes.any', version: 1, schema: anything }],
};

/** A failure of one emit: the error it threw, or undefined if it did not throw. */
function thrownBy(call: () => void): unknown {
  try {
    call();
  } catch (caughtError) {
    return caughtError;
  }

  return undefined;
}

describe('emit: the finished envelope is validated before the sink', () => {
  it.each([
    ['an empty string', ''],
    ['a string over the cap', 'x'.repeat(2001)],
    ['an array-like with a length', { length: 5 }],
    ['a number', 5],
    ['null', null],
  ])('refuses a text that is %s, for an event and a notice', async (_name, text) => {
    const { emit, sent } = await activateNotes({ contributes: open });
    const bad = text as string;

    for (const call of [
      () => emit.event({ kind: 'notes.any', data: {}, text: bad }),
      () => emit.notice({ topic: 'notes.any', data: {}, text: bad }),
    ]) {
      expect(thrownBy(call)).toMatchObject({
        name: 'ExtensionEmitError',
        failure: 'invalid-envelope',
      });
      expect(thrownBy(call)).toHaveProperty('message', expect.stringContaining('text ('));
    }

    expect(sent).toEqual([]);
  });

  it('refuses data over the byte cap, naming the path and not the value', async () => {
    const { emit, sent } = await activateNotes({ contributes: open });
    const error = thrownBy(() =>
      emit.event({ kind: 'notes.any', data: { blob: 'secret'.repeat(5000) }, text: 'ok' }),
    );

    expect(error).toMatchObject({ failure: 'invalid-envelope' });
    expect((error as Error).message).toContain('data (custom)');
    expect((error as Error).message).not.toContain('secret');
    expect(sent).toEqual([]);
  });

  it('sends the parsed envelope, with only the protocol fields', async () => {
    const { emit, sent } = await activateNotes({ contributes: open });

    emit.notice({ topic: 'notes.any', data: { a: [1, 'b'] }, text: 'hello' });

    expect(sent).toEqual([
      {
        kind: 'notice',
        session: undefined,
        notice: {
          kind: 'extension-notice',
          extension: 'notes',
          topic: 'notes.any',
          version: 1,
          data: { a: [1, 'b'] },
          text: 'hello',
        },
      },
    ]);
  });
});

describe('emit: a contribution with a bad name or version fails the activation', () => {
  // Event kinds are listed one by one in the manifest, whose own validation refuses a malformed
  // one; a notice topic is covered by a `notes.*` wildcard, so only the host can refuse it.
  const badTopics = ['notes.', 'notes..x', 'notes.Bad Topic', `notes.${'x'.repeat(5000)}`];

  it.each(badTopics)('fails a notice topic %#', async (topic) => {
    const { result } = await activateNotes({
      contributes: { notices: [{ topic, version: 1, schema: shape }] },
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.cause).toBeInstanceOf(ExtensionEmitError);
    expect(result.failed[0]?.cause).toMatchObject({
      extension: 'notes',
      failure: 'invalid-contribution',
    });
    expect(result.failed[0]?.message).toContain('notes');
    expect(result.active).toEqual([]);
  });

  it.each([0, 1.5, Number.NaN, -1, Number.POSITIVE_INFINITY])(
    'fails a version of %s, for an event and a notice',
    async (version) => {
      const event = await activateNotes({
        contributes: { events: [{ kind: 'notes.any', version, schema: shape }] },
      });
      const notice = await activateNotes({
        contributes: { notices: [{ topic: 'notes.any', version, schema: shape }] },
      });

      expect(event.result.failed[0]?.cause).toMatchObject({ failure: 'invalid-contribution' });
      expect(notice.result.failed[0]?.cause).toMatchObject({ failure: 'invalid-contribution' });
    },
  );
});

describe('emit: the armed copy is taken from the recorded names and version', () => {
  it('ignores a kind and a version that change after the check', async () => {
    let live = false;
    const event = {
      get kind() {
        return live ? 'notes.other' : 'notes.progress';
      },
      get version() {
        return live ? 9 : 3;
      },
      schema: shape,
    };
    const { result, emit, sent } = await activateNotes({
      contributes: { events: [event] },
      emits: { events: ['notes.progress', 'notes.other'] },
    });

    expect(result.failed).toEqual([]);

    live = true;
    emit.event({ kind: 'notes.progress', data: { done: 1 }, text: 'ok' });

    expect(sent[0]).toMatchObject({ event: { kind: 'notes.progress', version: 3 } });
    expect(() => emit.event({ kind: 'notes.other', data: { done: 1 }, text: 'ok' })).toThrow(
      expect.objectContaining({ failure: 'not-contributed' }),
    );
  });
});

describe('emit: hostile data becomes an ExtensionEmitError', () => {
  /** An object nested `depth` levels deep, built without recursion. */
  function nested(depth: number): unknown {
    let value: unknown = 'leaf';

    for (let level = 0; level < depth; level += 1) value = [value];

    return value;
  }

  const cyclic: { name: string; self?: unknown } = { name: 'loop' };

  cyclic.self = cyclic;

  const throwingGetter = {
    get boom(): string {
      throw new TypeError('secret getter detail');
    },
  };
  const throwingToJson = {
    toJSON(): never {
      throw new TypeError('secret toJSON detail');
    },
  };

  it.each([
    ['a cycle', cyclic],
    ['very deep nesting', nested(200_000)],
    ['a throwing getter', throwingGetter],
    ['a throwing toJSON', throwingToJson],
  ])('refuses %s, for an event and a notice, without echoing what threw', async (_name, data) => {
    const { emit, sent } = await activateNotes({ contributes: open });

    for (const call of [
      () => emit.event({ kind: 'notes.any', data, text: 'ok' }),
      () => emit.notice({ topic: 'notes.any', data, text: 'ok' }),
    ]) {
      const error = thrownBy(call);

      expect(error).toBeInstanceOf(ExtensionEmitError);
      expect((error as Error).message).not.toContain('secret');
    }

    expect(sent).toEqual([]);
  });

  it('refuses a schema that throws', async () => {
    const throwing = z.any().refine(() => {
      throw new RangeError('secret schema detail');
    });
    const { emit } = await activateNotes({
      contributes: { events: [{ kind: 'notes.any', version: 1, schema: throwing }] },
    });
    const error = thrownBy(() => emit.event({ kind: 'notes.any', data: 1, text: 'ok' }));

    expect(error).toMatchObject({ failure: 'invalid-data' });
    expect((error as Error).message).not.toContain('secret');
  });
});

describe('emit: caller strings in error messages', () => {
  it('quotes a kind with a newline and an escape so it cannot forge a log line', async () => {
    const { emit } = await activateNotes({ contributes: open });
    const hostile = 'notes.any\nFAKE LOG LINE\u001b[31m';
    const error = thrownBy(() => emit.event({ kind: hostile, data: {}, text: 'ok' }));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('\n');
    expect((error as Error).message).not.toContain('\u001b');
    expect((error as Error).message).toContain(String.raw`notes.any\nFAKE LOG LINE`);
  });

  it('truncates a very long kind, in the emit error and the undeclared error', async () => {
    const { emit } = await activateNotes({
      contributes: open,
      emits: { events: ['notes.any', 'notes.declared'] },
    });
    const long = `notes.${'x'.repeat(5000)}`;
    const undeclared = thrownBy(() => emit.event({ kind: long, data: {}, text: 'ok' }));
    const notContributed = thrownBy(() =>
      emit.event({ kind: 'notes.declared', data: {}, text: 'ok' }),
    );

    expect((undeclared as Error).message.length).toBeLessThan(400);
    expect((notContributed as Error).message).toContain('"notes.declared"');
  });
});
