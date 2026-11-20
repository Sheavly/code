/**
 * Acceptance test: a third party extends the program without editing our source. Every extension
 * here uses only exports reachable from the monorepo (the packages are private workspaces; this
 * test lives in `apps/backend`; publishing and installing are #332): public exports (`@sheavly/extension`, including the run-service
 * keys, `@sheavly/runtime`, `@sheavly/core`, the testing fakes) and is added through
 * `createBackendHarness({ extensions })`, the one call an embedding app makes.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { Services } from '@sheavly/extension/extension/extension.types';
import {
  defineExtension,
  defineService,
  placeHook,
  settingKey,
} from '@sheavly/extension/extension/extension.utils';
import type { SessionInfoView } from '@sheavly/extension/run-services/run-services.types';
import {
  APPROVALS,
  BACKGROUND_TASKS,
  MAIN_SESSION,
  MODEL,
  OUTPUT_READER,
  SESSION_INFO,
} from '@sheavly/extension/run-services/run-services.utils';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import { finiteWork, startWork } from '@sheavly/runtime/tasks/work.utils';
import { calls, say, toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { manifestOf } from '../../testing/manifest.fake.js';

const open = useBackendRuns();

/** A `notes` manifest that declares the setting `notes.max-lines`, default 50. */
function notesManifest() {
  return manifestOf({
    name: 'notes',
    settings: [
      {
        name: 'notes.max-lines',
        type: 'number',
        default: 50,
        description: 'Lines',
        scope: 'user',
        restricted: false,
      },
    ],
  });
}

type OpenedRun = Awaited<ReturnType<typeof open>>;

/** Sends one prompt through the harness's tools and hooks, runs `meanwhile`, then closes. */
async function runPrompt(params: {
  harness: OpenedRun;
  prompt: string;
  meanwhile?: () => Promise<void>;
}) {
  const { harness, prompt, meanwhile } = params;
  const conversation = createConversation({
    harness,
    run: streamAgent,
    tools: harness.tools,
    hooks: harness.hooks,
  });

  for await (const _event of conversation.send(prompt));
  await meanwhile?.();
  await conversation.close();
}

/** The model calls `name` once, then answers `done`. */
const callsTool = (name: string): Script[] => [
  calls(toolCall({ id: 'c1', name, input: {} })),
  say('done'),
];

describe('a third party extends the program without editing our source', () => {
  it('(a) reads a setting it declared: the default, or the user’s value from extensionSettings', async () => {
    const manifest = notesManifest();
    const MAX_LINES = settingKey({ manifest, name: 'notes.max-lines', type: 'number' });
    const seen: number[] = [];
    const notes = defineExtension({
      manifest,
      activate: ({ settings }) => {
        seen.push(settings.get(MAX_LINES));

        return {};
      },
    });

    await open({ extensions: [notes] });
    const set = await open({ extensions: [notes], extensionSettings: { 'notes.max-lines': 7 } });

    expect(seen).toEqual([50, 7]);
    expect(set.settings).toContainEqual(
      expect.objectContaining({ name: 'notes.max-lines', value: 7 }),
    );
  });

  it('(b) places its hooks before and after a built-in hook', async () => {
    const named = (name: string) => defineHook({ name, sessionStart: async () => undefined });
    const placing = defineExtension({
      manifest: manifestOf({ name: 'placing', hooks: ['late-hint', 'early-hint'] }),
      activate: () => ({
        hooks: [
          placeHook({ hook: named('late-hint'), after: ['agents-md'] }),
          placeHook({ hook: named('early-hint'), before: ['agents-md'] }),
        ],
      }),
    });
    const names = (await open({ extensions: [placing] })).hooks.map((hook) => hook.name);

    expect(names.indexOf('early-hint')).toBeLessThan(names.indexOf('agents-md'));
    expect(names.indexOf('late-hint')).toBeGreaterThan(names.indexOf('agents-md'));
  });

  it('(c) lets one extension provide a typed service that a dependent one reads', async () => {
    const GREETING = defineService<string>('greeting');
    const read: string[] = [];
    const greeter = defineExtension({
      manifest: manifestOf({ name: 'greeter', services: { provides: [GREETING.name] } }),
      activate: ({ services }) => {
        services.provide(GREETING, 'hello');

        return {};
      },
    });
    const listener = defineExtension({
      manifest: manifestOf({
        name: 'listener',
        dependsOn: ['greeter'],
        services: { requires: [GREETING.name] },
      }),
      activate: ({ services }) => {
        read.push(services.get(GREETING));

        return {};
      },
    });

    await open({ extensions: [greeter, listener] });

    expect(read).toEqual(['hello']);
  });

  it('(d) starts background work of its own kind through BACKGROUND_TASKS and awaits its completion', async () => {
    const startIndex = (services: Services) =>
      defineTool({
        name: 'start_index',
        description: 'Indexes in the background',
        inputSchema: z.object({}),
        execute: async ({ context }) => {
          const sessionId = context.session?.id;

          if (!sessionId) throw new Error('called outside a session');

          startWork({
            tasks: services.get(BACKGROUND_TASKS),
            work: finiteWork({
              command: 'jobs.index',
              description: 'Indexes the notes',
              sessionId,
              run: async () => ({ exitCode: 0 }),
            }),
          });

          return 'index started';
        },
      });
    const jobs = defineExtension({
      manifest: manifestOf({
        name: 'jobs',
        services: { requires: [BACKGROUND_TASKS.name] },
        grants: ['task:start'],
        tools: ['start_index'],
        workKinds: ['jobs.index'],
      }),
      activate: ({ services }) => ({
        tools: [startIndex(services)],
        workKinds: [{ name: 'jobs.index', description: 'Indexes notes', completion: 'finite' }],
      }),
    });
    const harness = await open({ extensions: [jobs], scripts: { go: callsTool('start_index') } });

    const ended: { command: string; status: string }[] = [];

    harness.tasks.observe(({ update }) => {
      if (update.type === 'task_ended') ended.push(update.task);
    });
    await runPrompt({
      harness,
      prompt: 'go',
      meanwhile: () => until(() => ended.length > 0),
    });

    expect(harness.workKinds.map((kind) => kind.name)).toEqual(['jobs.index']);
    expect(ended).toEqual([
      expect.objectContaining({ command: 'jobs.index', status: 'completed' }),
    ]);
  });

  describe('(e) asks the user for approval through APPROVALS', () => {
    const purge = defineExtension({
      manifest: manifestOf({
        name: 'purge',
        services: { requires: [APPROVALS.name] },
        grants: ['approval:request'],
        tools: ['purge'],
      }),
      activate: ({ services }) => ({
        tools: [
          defineTool({
            name: 'purge',
            description: 'Removes the cache, with the user’s approval',
            inputSchema: z.object({}),
            execute: async ({ context, signal }) => {
              const answer = await services.get(APPROVALS).request({
                callId: context.callId,
                sessionId: context.session?.id,
                command: 'purge cache',
                concerns: [{ argument: 'cache', reason: 'removes files' }],
                signal,
              });

              return answer.decision === 'approve' ? 'PURGED' : 'REFUSED';
            },
          }),
        ],
      }),
    });

    /** Runs a prompt whose tool asks for approval; the user answers `decision`. */
    const askUser = async (decision: 'approve' | 'skip') => {
      const requests: ProviderRequest[] = [];
      const harness = await open({
        extensions: [purge],
        scripts: { go: callsTool('purge') },
        onModelCall: (request) => requests.push(request),
      });

      harness.approvals.subscribe((update) => {
        if (update.type !== 'approval_requested') return;
        harness.approvals.respond({ id: update.request.id, response: { decision } });
      });
      await runPrompt({ harness, prompt: 'go' });

      return JSON.stringify(requests.at(-1)?.messages);
    };

    it('runs the action when the user approves', async () => {
      expect(await askUser('approve')).toContain('PURGED');
    });

    it('refuses the action when the user skips', async () => {
      expect(await askUser('skip')).toContain('REFUSED');
    });

    it('cannot answer, listen to or read the requests: APPROVALS only requests', async () => {
      const held: object[] = [];
      const snoop = defineExtension({
        manifest: manifestOf({ name: 'snoop', services: { requires: [APPROVALS.name] } }),
        activate: ({ services }) => {
          held.push(services.get(APPROVALS));

          return {};
        },
      });
      const harness = await open({ extensions: [snoop] });
      const [approvals] = held;

      expect(approvals).not.toBe(harness.approvals);
      expect('request' in (approvals ?? {})).toBe(true);

      for (const name of ['respond', 'subscribe', 'observe', 'pending', 'screen']) {
        expect(name in (approvals ?? {})).toBe(false);
      }
    });
  });

  it('(g) finds OUTPUT_READER only when the app has an output store, and only to read', async () => {
    const found: unknown[] = [];
    const reader = defineExtension({
      manifest: manifestOf({ name: 'reader', services: { optional: [OUTPUT_READER.name] } }),
      activate: ({ services }) => {
        found.push(services.find(OUTPUT_READER));

        return {};
      },
    });
    const store = new MemoryOutputStore();

    await open({ extensions: [reader] });
    await open({ extensions: [reader], outputs: store });

    expect(found[0]).toBeUndefined();
    expect(found[1]).not.toBe(store);
    expect(Object.keys(found[1] ?? {}).sort()).toEqual(['log', 'read', 'search']);
  });

  it('(h) rejects a bad extensionSettings value: the wrong type, or a name nobody declares', async () => {
    const notes = defineExtension({ manifest: notesManifest(), activate: () => ({}) });

    await expect(
      open({ extensions: [notes], extensionSettings: { 'notes.max-lines': 'many' } }),
    ).rejects.toThrow(/notes\.max-lines/);
    await expect(
      open({ extensions: [notes], extensionSettings: { 'nobody.declares': 1 } }),
    ).rejects.toThrow(/nobody\.declares/);
  });

  it('(f) reads MAIN_SESSION as the run’s own object and SESSION_INFO and MODEL as scoped views, never the registry or the provider', async () => {
    const held: { info?: SessionInfoView; main?: SessionRef; model?: Provider } = {};
    const observer = defineExtension({
      manifest: manifestOf({
        name: 'observer',
        services: { requires: [SESSION_INFO.name, MAIN_SESSION.name, MODEL.name] },
        grants: ['session:read', 'model:call'],
      }),
      activate: ({ services }) => {
        held.info = services.get(SESSION_INFO);
        held.main = services.get(MAIN_SESSION);
        held.model = services.get(MODEL);

        return {};
      },
    });
    const harness = await open({ extensions: [observer] });
    const { info, main, model } = held;

    const before = harness.mainSession.id;

    expect(main).toEqual(harness.mainSession);
    expect(main).not.toBe(harness.mainSession);
    expect(Object.isFrozen(main)).toBe(true);
    expect(() => {
      (main as { id: string }).id = 'hijacked';
    }).toThrow(TypeError);
    expect(harness.mainSession.id).toBe(before);
    expect(info).not.toBe(harness.sessions);
    expect(info?.get(harness.mainSession.id)?.id).toBe(harness.mainSession.id);

    for (const name of ['publish', 'end', 'send', 'subscribeEntries', 'stream', 'queueNotice']) {
      expect(name in (info ?? {})).toBe(false);
    }

    expect(model).not.toBe(harness.provider);
    expect(typeof model?.stream).toBe('function');
  });

  it('keeps a service another extension provides out of reach without a dependency', async () => {
    const SECRET = defineService<string>('secret');
    const keeper = defineExtension({
      manifest: manifestOf({ name: 'keeper', services: { provides: [SECRET.name] } }),
      activate: ({ services }) => {
        services.provide(SECRET, 'x');

        return {};
      },
    });
    const nosy = defineExtension({
      // It declares the service, so the host's own dependency check is what refuses the read.
      manifest: manifestOf({ name: 'nosy', services: { optional: [SECRET.name] } }),
      activate: ({ services }) => {
        services.get(SECRET);

        return {};
      },
    });

    await expect(open({ extensions: [keeper, nosy] })).rejects.toThrow(/secret/);
  });
});
