import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { runAgent } from '../../loop/stream-agent/stream-agent.helper.js';
import { TaskRegistry } from '../../runtime/tasks/tasks.service.js';
import { calls, routedProvider, say, toolCall } from '../../testing/routed-provider.fake.js';
import { createHarness } from '../host.helper.js';

const extract = defineTool({
  name: 'extract',
  description: 'Pull the amount out of an invoice line',
  inputSchema: z.object({ line: z.string() }),
  execute: async ({ input: { line } }) => line.replace(/[^\d.]/g, ''),
});

/** The model calls the custom tool once, then answers. */
const provider = () =>
  routedProvider({
    'parse it': [
      calls(toolCall({ id: 'c1', name: 'extract', input: { line: 'Total: $42.50' } })),
      say('42.50'),
    ],
  });

// A run with no workspace must not look at the directory it runs in: this one has an AGENTS.md
// and `.sheavly/` hooks a coding harness would load.
let project: string;
let cwd: string;

beforeEach(async () => {
  cwd = process.cwd();
  project = await mkdtemp(path.join(tmpdir(), 'generic-harness-'));
  await writeFile(path.join(project, 'AGENTS.md'), 'AGENTS NOTE\n');
  await mkdir(path.join(project, '.sheavly'));
  await writeFile(path.join(project, '.sheavly', 'hooks.json'), '{ not json');
  process.chdir(project);
});

afterEach(async () => {
  process.chdir(cwd);
  await rm(project, { recursive: true, force: true });
});

describe('createHarness without a workspace', () => {
  it('runs a scripted provider with a custom tool, and reads no AGENTS.md or .sheavly/', async () => {
    const requests: ProviderRequest[] = [];
    const harness = createHarness({
      provider: provider(),
      title: 'parse it',
      tools: [extract],
      onModelCall: (request) => requests.push(request),
    });

    const messages = await runAgent({
      provider: harness.provider,
      tools: harness.tools,
      hooks: harness.hooks,
      messages: [{ role: 'user', content: 'parse it' }],
      tasks: harness.tasks,
      session: { registry: harness.sessions, ref: harness.mainSession },
    });

    expect(messages[2]).toMatchObject({ role: 'tool', toolCallId: 'c1', content: '42.50' });
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: '42.50' });
    expect(harness).not.toHaveProperty('workspace');
    expect(harness.hooks).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.instructions === undefined)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain('AGENTS NOTE');
  });

  it('adds the task and sub-agent tools after the caller’s own, and no file or command tools', () => {
    const harness = createHarness({ provider: provider(), title: 'parse it', tools: [extract] });

    expect(harness.tools.map((tool) => tool.name)).toEqual([
      'extract',
      'task_status',
      'cancel_task',
      'start_agent',
      'message_agent',
    ]);
  });

  it('runs the caller’s hooks, and uses the registries passed in', async () => {
    const seen: string[] = [];
    const note = defineHook({
      name: 'note',
      sessionStart: async () => {
        seen.push('start');
      },
    });
    const tasks = new TaskRegistry();
    const harness = createHarness({
      provider: provider(),
      title: 'parse it',
      hooks: [note],
      tasks,
    });

    await runAgent({
      provider: harness.provider,
      tools: harness.tools,
      hooks: harness.hooks,
      messages: [{ role: 'user', content: 'parse it' }],
    });

    expect(harness.tasks).toBe(tasks);
    expect(seen).toEqual(['start']);
  });
});
