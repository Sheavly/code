import { describe, expect, it } from 'vitest';
import type { HostService, ServiceKey } from '../../extension/extension.types.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../../host/extension-host.service.js';
import {
  APPROVALS,
  BACKGROUND_TASKS,
  CHILD_SESSIONS,
  INSTRUCTIONS,
  MAIN_SESSION,
  MODEL,
  OUTPUT_CAPTURE,
  OUTPUT_READER,
  SESSION_INFO,
  TASK_CONTROL,
} from '../run-services.utils.js';

const signal = new AbortController().signal;

/**
 * Every key with the name a manifest lists in `services.requires`. The names are the contract an
 * installer reads, so this table is data: a changed name fails here.
 */
const KEYS = [
  { export: 'INSTRUCTIONS', key: INSTRUCTIONS, name: 'instructions' },
  { export: 'MAIN_SESSION', key: MAIN_SESSION, name: 'main-session' },
  { export: 'APPROVALS', key: APPROVALS, name: 'approvals' },
  { export: 'SESSION_INFO', key: SESSION_INFO, name: 'session-info' },
  { export: 'CHILD_SESSIONS', key: CHILD_SESSIONS, name: 'child-sessions' },
  { export: 'BACKGROUND_TASKS', key: BACKGROUND_TASKS, name: 'background-tasks' },
  { export: 'TASK_CONTROL', key: TASK_CONTROL, name: 'task-control' },
  { export: 'OUTPUT_READER', key: OUTPUT_READER, name: 'output-reader' },
  { export: 'OUTPUT_CAPTURE', key: OUTPUT_CAPTURE, name: 'output-capture' },
  { export: 'MODEL', key: MODEL, name: 'model' },
] as const;

/**
 * Activates an extension that lists `key` as `listed` and reads it with `read`, against a host
 * that supplies a marker object under the key's name.
 */
async function readFromHost(params: {
  key: ServiceKey<unknown>;
  listed: 'requires' | 'optional';
  read: 'get' | 'find';
}) {
  const { key, listed, read } = params;
  const supplied = { marker: key.name };
  const service: HostService = { name: key.name, value: supplied };
  let seen: unknown;
  const host = new ExtensionHost({
    services: [service],
    extensions: [
      fakeExtension({
        name: 'reader',
        [listed]: [key.name],
        activate: ({ services }) => {
          seen = services[read](key);

          return {};
        },
      }),
    ],
  });
  const { active } = await host.activate({ signal });

  return { active, supplied, seen };
}

describe('run-service keys', () => {
  it.each(KEYS)('$export is named $name, the string a manifest requires', ({ key, name }) => {
    expect(key.name).toBe(name);
  });

  it('has no two keys with one name', () => {
    expect(new Set(KEYS.map(({ name }) => name)).size).toBe(KEYS.length);
  });

  it.each(KEYS)(
    '$export reads the host service of that name through get when required',
    async ({ key }) => {
      const { active, supplied, seen } = await readFromHost({
        key,
        listed: 'requires',
        read: 'get',
      });

      expect(active).toEqual(['reader']);
      expect(seen).toBe(supplied);
    },
  );

  it.each(KEYS)(
    '$export reads the host service of that name through find when optional',
    async ({ key }) => {
      const { active, supplied, seen } = await readFromHost({
        key,
        listed: 'optional',
        read: 'find',
      });

      expect(active).toEqual(['reader']);
      expect(seen).toBe(supplied);
    },
  );

  it('skips an extension that requires a key nobody supplies, naming its service', async () => {
    const host = new ExtensionHost({
      extensions: [fakeExtension({ name: 'reader', requires: [SESSION_INFO.name] })],
    });
    const result = await host.activate({ signal });

    expect(result.skipped).toEqual([
      { extension: 'reader', reason: 'service', missing: ['session-info'] },
    ]);
  });

  it('refuses get of a key the manifest does not list', async () => {
    const service: HostService = { name: SESSION_INFO.name, value: {} };
    const host = new ExtensionHost({
      services: [service],
      extensions: [
        fakeExtension({
          name: 'reader',
          activate: ({ services }) => {
            services.get(SESSION_INFO);

            return {};
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.active).toEqual([]);
    expect(result.failed).toHaveLength(1);
  });
});
