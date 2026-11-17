import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { say, toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { manifestOf } from '../../testing/manifest.fake.js';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { sendPromptAndSettle } from '../../testing/send-prompt.fake.js';

const jot = defineTool({
  name: 'jot',
  description: 'Jots a note down',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ input }) => `JOTTED ${input.text}`,
});

/**
 * An extension nothing in the harness knows about: a tool, a hook and a kind of background work,
 * added through `extensions`, with no core file edited.
 */
const notes = defineExtension({
  manifest: manifestOf({
    name: 'notes',
    tools: ['jot'],
    hooks: ['notes-hint'],
    workKinds: ['notes.sync'],
  }),
  activate: () => ({
    tools: [jot],
    hooks: [
      defineHook({
        name: 'notes-hint',
        sessionStart: async ({ addContext }) => addContext('NOTES HINT'),
      }),
    ],
    workKinds: [{ name: 'notes.sync', description: 'Syncs notes', completion: 'finite' }],
  }),
});

const open = useBackendRuns();

describe('a third-party extension on the backend run', () => {
  it('adds a tool, a hook and a work kind without editing a core file', async () => {
    const harness = await open({ extensions: [notes] });

    expect(harness.tools.map((tool) => tool.name)).toContain('jot');
    expect(harness.hooks.map((hook) => hook.name)).toContain('notes-hint');
    expect(harness.workKinds.map((kind) => kind.name)).toEqual(['notes.sync']);
  });

  it('runs its tool and its hook in the loop like a built-in one', async () => {
    const requests: ProviderRequest[] = [];
    const callJot: Script = () => [
      toolCall({ id: 'j1', name: 'jot', input: { text: 'buy milk' } }),
      { type: 'done', stopReason: 'tool_use' },
    ];
    const harness = await open({
      extensions: [notes],
      scripts: { go: [callJot, say('done')] },
      onModelCall: (request) => requests.push(request),
    });

    await sendPromptAndSettle({ harness, prompt: 'go' });

    const seen = JSON.stringify(requests.at(-1)?.messages);

    expect(seen).toContain('NOTES HINT');
    expect(seen).toContain('JOTTED buy milk');
  });

  it('fails loudly, naming both extensions, when it brings a tool a built-in one has', async () => {
    const clash = defineExtension({
      manifest: manifestOf({ name: 'clash', tools: ['read_file'] }),
      activate: () => ({
        tools: [defineTool({ ...jot, name: 'read_file' })],
      }),
    });

    await expect(open({ extensions: [clash] })).rejects.toThrow(
      /The tool "read_file" is contributed by both coding and clash/,
    );
  });

  it('stops the run with the failing extension’s own error and deactivates what activated before it', async () => {
    const log: string[] = [];
    const opened = defineExtension({
      manifest: manifestOf({ name: 'opened' }),
      activate: () => ({}),
      deactivate: () => void log.push('opened deactivated'),
    });
    const broken = defineExtension({
      manifest: manifestOf({ name: 'broken' }),
      activate: () => {
        throw new Error('hook file is broken');
      },
    });

    await expect(open({ extensions: [opened, broken] })).rejects.toThrow('hook file is broken');
    expect(log).toEqual(['opened deactivated']);
  });

  it('tells onExtensionProblem when an extension’s deactivate throws while the run is closed', async () => {
    const problems: unknown[] = [];
    const stuck = defineExtension({
      manifest: manifestOf({ name: 'stuck' }),
      activate: () => ({}),
      deactivate: () => {
        throw new Error('cannot close');
      },
    });
    const broken = defineExtension({
      manifest: manifestOf({ name: 'broken' }),
      activate: () => {
        throw new Error('boom');
      },
    });

    await expect(
      open({ extensions: [stuck, broken], onExtensionProblem: (error) => problems.push(error) }),
    ).rejects.toThrow('boom');
    expect(problems).toHaveLength(1);
    expect(String(problems[0])).toContain('cannot close');
  });

  it('keeps the activation error when the problem callback itself throws, and tells of further failures', async () => {
    const heard: unknown[] = [];
    const warnings: string[] = [];
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation((warning) => {
      warnings.push(String(warning));
    });
    const failing = (name: string) =>
      defineExtension({
        manifest: manifestOf({ name }),
        activate: () => {
          throw new Error(`${name} failed`);
        },
      });

    try {
      await expect(
        open({
          extensions: [failing('first-broken'), failing('second-broken')],
          onExtensionProblem: (error) => {
            heard.push(error);

            throw new Error('the callback is broken too');
          },
        }),
      ).rejects.toThrow('first-broken failed');
    } finally {
      warn.mockRestore();
    }

    expect(heard).toHaveLength(1);
    expect(String(heard[0])).toContain('second-broken failed');
    expect(warnings.join('\n')).toContain('Reporting an extension problem failed (Error)');
  });

  it('leaves out a project extension this backend does not trust, and names it', async () => {
    const fromRepo = defineExtension({
      manifest: manifestOf({ name: 'from-repo', tools: ['repo_tool'] }),
      origin: 'project',
      activate: () => ({ tools: [defineTool({ ...jot, name: 'repo_tool' })] }),
    });
    const harness = await open({ extensions: [fromRepo] });

    expect(harness.tools.map((tool) => tool.name)).not.toContain('repo_tool');
    expect(harness.skippedExtensions).toEqual([{ extension: 'from-repo', reason: 'untrusted' }]);
  });
});
