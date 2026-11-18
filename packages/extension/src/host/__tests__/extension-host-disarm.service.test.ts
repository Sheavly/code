import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ExtensionEmission, ExtensionEmit } from '../../emit/emit.types.js';
import { ExtensionEmitError } from '../../errors/emit.errors.js';
import type { Contributions, Extension } from '../../extension/extension.types.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const shape = z.object({ done: z.number() });
const notesContribution: Contributions = {
  events: [{ kind: 'notes.progress', version: 1, schema: shape }],
  notices: [{ topic: 'notes.reminder', version: 1, schema: shape }],
};
const progress = { kind: 'notes.progress', data: { done: 1 }, text: 'one done' };
const reminder = { topic: 'notes.reminder', data: { done: 1 }, text: 'remember' };

type Captured = Map<string, ExtensionEmit>;
type NotesFields = { throws?: boolean; returns?: Contributions };

/** `notes`, which keeps its `context.emit`, as a tool or task would, and returns what it is told. */
function notes(captured: Captured, fields: NotesFields = {}): Extension {
  return fakeExtension({
    name: 'notes',
    contributes: notesContribution,
    activate: (context) => {
      captured.set('notes', context.emit);

      if (fields.throws === true) throw new Error('activate failed');

      return fields.returns ?? notesContribution;
    },
  });
}

/** A host over the extensions `build` makes, with the capabilities they kept and the sink's log. */
function rig(build: (captured: Captured) => Extension[]) {
  const captured: Captured = new Map();
  const sent: ExtensionEmission[] = [];
  const host = new ExtensionHost({
    extensions: build(captured),
    emit: (emission) => void sent.push(emission),
  });

  return { host, captured, sent };
}

/** A host whose `notes` changes its list after the check, so it is rolled back with `extra`'s. */
function rolledBack(extra: (captured: Captured) => Extension[] = () => []) {
  return rig((captured) => {
    const list = [...(notesContribution.events ?? [])];

    return [
      notes(captured, { returns: { events: list } }),
      ...extra(captured),
      fakeExtension({
        name: 'late',
        activate: () => {
          list.length = 0;

          return {};
        },
      }),
    ];
  });
}

/** Asserts that both kinds of emit are refused as `deactivated` and nothing reaches the sink. */
function expectDisarmed(params: {
  emit: ExtensionEmit | undefined;
  sent: ExtensionEmission[];
  extension?: string;
}) {
  const { emit, sent, extension = 'notes' } = params;

  if (emit === undefined) throw new Error('the extension never received its capability');

  for (const call of [
    () => emit.event({ ...progress, kind: `${extension}.progress` }),
    () => emit.notice({ ...reminder, topic: `${extension}.reminder` }),
  ]) {
    expect(call).toThrow(ExtensionEmitError);
    expect(call).toThrow(expect.objectContaining({ failure: 'deactivated' }));
  }

  expect(sent).toEqual([]);
}

describe('ExtensionHost emit after the host stops an extension', () => {
  it('works while the extension is active, and not after deactivate()', async () => {
    const { host, captured, sent } = rig((kept) => [notes(kept)]);

    await host.activate({ signal });
    captured.get('notes')?.event(progress);

    expect(sent).toHaveLength(1);

    sent.length = 0;
    await host.deactivate();

    expectDisarmed({ emit: captured.get('notes'), sent });
  });

  it('is disarmed before the extension deactivate() runs', async () => {
    let duringDeactivate: unknown;
    const { host, captured } = rig((kept) => [
      fakeExtension({
        name: 'notes',
        activate: (context) => {
          kept.set('notes', context.emit);

          return notesContribution;
        },
        deactivate: () => {
          try {
            kept.get('notes')?.event(progress);
          } catch (caughtError) {
            duringDeactivate = caughtError;
          }
        },
      }),
    ]);

    await host.activate({ signal });
    await host.deactivate();

    expect(captured.has('notes')).toBe(true);
    expect(duringDeactivate).toMatchObject({ failure: 'deactivated' });
  });

  it('is disarmed for an extension rolled back because its contribution changed', async () => {
    const { host, captured, sent } = rolledBack();
    const result = await host.activate({ signal });

    expect(result.failed.map((failure) => failure.extension)).toEqual(['notes']);
    expectDisarmed({ emit: captured.get('notes'), sent });
  });

  it('is disarmed for the whole roll-back, not only once each one is stopped', async () => {
    let whileDependentStops: unknown;
    const { host, captured } = rolledBack((kept) => [
      fakeExtension({
        name: 'dep',
        dependsOn: ['notes'],
        // A dependent is stopped before what it depends on: `notes` must already be unable to emit.
        deactivate: () => {
          try {
            kept.get('notes')?.event(progress);
          } catch (caughtError) {
            whileDependentStops = caughtError;
          }
        },
      }),
    ]);

    await host.activate({ signal });

    expect(captured.has('notes')).toBe(true);
    expect(whileDependentStops).toMatchObject({ failure: 'deactivated' });
  });

  it('is disarmed for a dependent of a rolled-back extension', async () => {
    const { host, captured, sent } = rolledBack((kept) => [
      fakeExtension({
        name: 'dep',
        dependsOn: ['notes'],
        contributes: { events: [{ kind: 'dep.progress', version: 1, schema: shape }] },
        activate: (context) => {
          kept.set('dep', context.emit);

          return { events: [{ kind: 'dep.progress', version: 1, schema: shape }] };
        },
      }),
    ]);
    const result = await host.activate({ signal });

    expect(result.skipped).toEqual([{ extension: 'dep', reason: 'dependency' }]);
    expect(() => captured.get('dep')?.event({ ...progress, kind: 'dep.progress' })).toThrow(
      expect.objectContaining({ failure: 'deactivated' }),
    );
    expect(sent).toEqual([]);
  });

  it.each([
    ['activate threw after keeping the capability', { throws: true }],
    [
      'the contribution failed the manifest check',
      { returns: { events: [{ kind: 'notes.secret', version: 1, schema: shape }] } },
    ],
  ])('is disarmed when %s', async (_name, fields: NotesFields) => {
    const { host, captured, sent } = rig((kept) => [notes(kept, fields)]);
    const result = await host.activate({ signal });

    expect(result.failed).toHaveLength(1);
    expectDisarmed({ emit: captured.get('notes'), sent });
  });

  it('is disarmed when a collision aborts the activation', async () => {
    const twice = {
      events: [...(notesContribution.events ?? []), ...(notesContribution.events ?? [])],
    };
    const { host, captured, sent } = rig((kept) => [notes(kept, { returns: twice })]);

    await expect(host.activate({ signal })).rejects.toMatchObject({
      name: 'ContributionCollisionError',
    });
    expectDisarmed({ emit: captured.get('notes'), sent });
  });

  it('is disarmed for an extension that finished activating after deactivate()', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, captured, sent } = rig((kept) => [
      fakeExtension({
        name: 'notes',
        activate: async (context) => {
          kept.set('notes', context.emit);
          await gate;

          return notesContribution;
        },
      }),
    ]);
    const activating = host.activate({ signal });

    await vi.waitFor(() => expect(captured.has('notes')).toBe(true));
    await host.deactivate();
    release();
    await activating;

    expectDisarmed({ emit: captured.get('notes'), sent });
  });
});
