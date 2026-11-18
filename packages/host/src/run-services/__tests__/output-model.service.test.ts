import { describe, expect, it } from 'vitest';
import { ExtensionUndeclaredError } from '@sheavly/extension/errors/manifest.errors';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { ScopeDeactivatedError } from '../../errors/scopes.errors.js';
import { scopeRun } from '../../testing/scope-run.fake.js';
import { MODEL, OUTPUT_CAPTURE, OUTPUT_READER } from '../run-services.utils.js';

const outputs = [OUTPUT_READER.name, OUTPUT_CAPTURE.name];
const both = { name: 'a', requires: outputs, grants: ['output:read', 'output:capture'] };

/** A run whose app has an output store, with `extensions` activated over it. */
async function withStore(extensions: { name: string; requires: string[]; grants: string[] }[]) {
  const run = scopeRun({ outputs: new MemoryOutputStore() });

  await run.activate(extensions);

  return run;
}

describe('the output-reader and output-capture services', () => {
  it('captures through output-capture and reads what was stored through output-reader', async () => {
    const run = await withStore([both]);
    const services = run.servicesOf('a');
    const writer = await services.get(OUTPUT_CAPTURE).create();

    writer.append('hello output');
    await writer.close();

    const reader = services.get(OUTPUT_READER);

    await expect(reader.log(writer.log.ref)).resolves.toMatchObject({ status: 'complete' });
    await expect(
      reader.read({ ref: writer.log.ref, offset: 0, maxBytes: 100 }),
    ).resolves.toMatchObject({ text: 'hello output' });
    await expect(
      reader.search({ ref: writer.log.ref, query: 'output', fromOffset: 0, maxMatches: 5 }),
    ).resolves.toMatchObject({ matches: [{ offset: 6 }] });
  });

  it('gives the reader no way to create and the capture no way to read', async () => {
    const run = await withStore([both]);
    const services = run.servicesOf('a');

    expect('create' in services.get(OUTPUT_READER)).toBe(false);

    for (const name of ['log', 'read', 'search']) {
      expect(name in services.get(OUTPUT_CAPTURE)).toBe(false);
    }

    expect(Object.isFrozen(services.get(OUTPUT_READER))).toBe(true);
    expect(Object.isFrozen(services.get(OUTPUT_CAPTURE))).toBe(true);
  });

  it('checks output:read and output:capture separately, naming the extension and the grant', async () => {
    const run = await withStore([
      { name: 'reads', requires: outputs, grants: ['output:read'] },
      { name: 'captures', requires: outputs, grants: ['output:capture'] },
    ]);
    const reads = run.servicesOf('reads');
    const captures = run.servicesOf('captures');
    const ref = (await captures.get(OUTPUT_CAPTURE).create()).log.ref;

    await expect(reads.get(OUTPUT_CAPTURE).create()).rejects.toThrow(ExtensionUndeclaredError);
    await expect(reads.get(OUTPUT_CAPTURE).create()).rejects.toThrow(/reads.*output:capture/s);

    for (const call of [
      () => captures.get(OUTPUT_READER).log(ref),
      () => captures.get(OUTPUT_READER).read({ ref, offset: 0, maxBytes: 1 }),
      () => captures.get(OUTPUT_READER).search({ ref, query: 'x', fromOffset: 0, maxMatches: 1 }),
    ]) {
      await expect(call()).rejects.toThrow(/captures.*output:read/s);
    }
  });

  it('is not provided when the app has no output store, so find returns undefined', async () => {
    const run = scopeRun();

    await run.activate([{ name: 'a', requires: [], optional: outputs, grants: [] }]);

    const services = run.servicesOf('a');

    expect(services.find(OUTPUT_READER)).toBeUndefined();
    expect(services.find(OUTPUT_CAPTURE)).toBeUndefined();
  });

  it('rejects after the host stops the extension', async () => {
    const run = scopeRun({ outputs: new MemoryOutputStore() });
    const { deactivate } = await run.activate([
      { name: 'a', requires: outputs, grants: ['output:read', 'output:capture'] },
    ]);
    const services = run.servicesOf('a');

    await deactivate();

    await expect(services.get(OUTPUT_CAPTURE).create()).rejects.toThrow(ScopeDeactivatedError);
  });
});

describe('the model service', () => {
  it('needs model:call to stream, and forwards the provider’s stream and window', async () => {
    const run = scopeRun();

    await run.activate([
      { name: 'a', requires: [MODEL.name], grants: ['model:call'] },
      { name: 'b', requires: [MODEL.name], grants: [] },
    ]);

    const allowed = run.servicesOf('a').get(MODEL);
    const denied = run.servicesOf('b').get(MODEL);
    const request = {
      messages: [{ role: 'user' as const, content: 'go' }],
      tools: [],
      signal: new AbortController().signal,
    };
    const events: unknown[] = [];

    for await (const event of allowed.stream(request)) events.push(event);

    expect(events.length).toBeGreaterThan(0);
    expect(allowed.contextWindow).toBe(run.harness.provider.contextWindow);
    expect(() => denied.stream(request)).toThrow(ExtensionUndeclaredError);
    expect(() => denied.stream(request)).toThrow(/b.*model:call/s);
  });

  it('throws deactivated from stream after the host stops the extension', async () => {
    const run = scopeRun();
    const { deactivate } = await run.activate([
      { name: 'a', requires: [MODEL.name], grants: ['model:call'] },
    ]);
    const model = run.servicesOf('a').get(MODEL);

    await deactivate();

    expect(() =>
      model.stream({ messages: [], tools: [], signal: new AbortController().signal }),
    ).toThrow(ScopeDeactivatedError);
  });
});
