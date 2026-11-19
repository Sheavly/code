import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentsExtension } from '@sheavly/agents/agents/agents.helper';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { ExtensionUndeclaredError } from '@sheavly/extension/errors/manifest.errors';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { CODING_INSTRUCTIONS } from '../../instructions/coding-instructions.prompt.js';
import { codingRun } from '../../testing/coding-run.fake.js';
import { testPermissions } from '../../testing/permissions.fake.js';
import type { CodingRunParams } from '../../testing/testing.types.js';
import { CODING_HOOK_NAMES } from '../coding-hook-names.constants.js';

const manifest = readManifest(new URL('../../../sheavly.json', import.meta.url));
// The manifest is JSON and cannot import the constant: the assertions below keep them in step.
const INSTRUCTION_HOOKS = Object.values(CODING_HOOK_NAMES);

let base: string;
let project: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'coding-extension-')));
  project = path.join(base, 'project');
  await mkdir(project);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Gives the workspace one project hook, named whatever the user chose. */
async function addProjectHook(name: string) {
  await mkdir(path.join(project, '.sheavly', 'hooks'), { recursive: true });
  await writeFile(
    path.join(project, '.sheavly', 'hooks.json'),
    JSON.stringify({ version: 1, hooks: [{ path: 'hooks/mine.mjs' }] }),
  );
  await writeFile(
    path.join(project, '.sheavly', 'hooks', 'mine.mjs'),
    `export default { name: ${JSON.stringify(name)}, beforeTurn: async () => {} };\n`,
  );
}

/** Activates `agents` and `coding` over the test project, trusting it so its own hooks load. */
async function activate(outputs?: MemoryOutputStore, adjust?: CodingRunParams['adjust']) {
  const run = await codingRun({
    project,
    scratchRoot: path.join(base, 'scratch'),
    outputs,
    adjust,
  }).activate();

  await run.deactivate();

  return run.result;
}

/** The coding extension with `grant` struck from its manifest, as a third party might declare it. */
function withoutGrant(grant: string): NonNullable<CodingRunParams['adjust']> {
  return (coding) => ({
    ...coding,
    manifest: {
      ...coding.manifest,
      grants: (coding.manifest.grants ?? []).filter((one) => one !== grant),
    },
  });
}

describe('the coding extension and its manifest', () => {
  it('activates in a workspace with no .sheavly/ hooks, contributing the instruction hooks', async () => {
    const { failed, active, contributions } = await activate();

    expect(failed).toEqual([]);
    expect(active).toEqual(['agents', 'coding']);
    expect(contributions.hooks.map((hook) => hook.name)).toEqual(INSTRUCTION_HOOKS);
  });

  it('activates in a workspace whose .sheavly/ hook has a name the user chose, after the instruction hooks', async () => {
    await addProjectHook('whatever-the-user-called-it');

    const { failed, contributions } = await activate();

    expect(failed).toEqual([]);
    expect(contributions.hooks.map((hook) => hook.name)).toEqual([
      ...INSTRUCTION_HOOKS,
      'whatever-the-user-called-it',
    ]);
  });

  it('captures command output only through the optional output-capture service and its grant', async () => {
    const runCommand = (tools: { name: string; description: string }[]) =>
      tools.find((tool) => tool.name === 'run_command')?.description ?? '';
    const without = await activate();
    const withStore = await activate(new MemoryOutputStore());

    expect(manifest.services.optional).toEqual(['output-capture']);
    expect(manifest.grants).toContain('output:capture');
    expect(withStore.failed).toEqual([]);
    expect(runCommand([...without.contributions.tools])).not.toContain('read_output');
    expect(runCommand([...withStore.contributions.tools])).toContain('read_output');
  });

  it('declares exactly the tools it contributes and the instruction hooks it always has', async () => {
    const { contributions } = await activate();
    const agentTools = createAgentsExtension().manifest.tools;
    const coding = contributions.tools
      .map((tool) => tool.name)
      .filter((name) => !agentTools.includes(name));

    expect(coding).toEqual(manifest.tools);
    expect(manifest.hooks).toEqual([...INSTRUCTION_HOOKS, '*']);
  });

  it('asks only for the services and grants its call sites use', () => {
    expect(manifest.services.requires).toEqual([
      'sub-agents',
      'session-info',
      'background-tasks',
      'approvals',
      'main-session',
    ]);
    expect(manifest.grants).toEqual([
      'output:capture',
      'session:read',
      'task:start',
      'approval:request',
      'approval:as-tool',
      'approval:keep',
      'system-prompt:extend',
    ]);
  });

  it('contributes its guidance as the one declared section, with the text of its prompt file', async () => {
    const { failed, contributions } = await activate();

    expect(failed).toEqual([]);
    expect(manifest.instructions).toEqual(['coding']);
    expect(contributions.instructions).toEqual([{ name: 'coding', text: CODING_INSTRUCTIONS }]);
    expect(contributions.baseInstructions).toBeUndefined();
  });

  it('fails to activate when its manifest lacks system-prompt:extend, and adds no section', async () => {
    const { failed, active, contributions } = await activate(
      undefined,
      withoutGrant('system-prompt:extend'),
    );

    expect(active).toEqual(['agents']);
    expect(failed).toHaveLength(1);
    expect(String(failed[0]?.cause)).toContain('system-prompt:extend');
    expect(contributions.instructions).toEqual([]);
  });

  it('fails to activate when its manifest lacks session:read, which it needs to hear the sessions', async () => {
    const { failed, active } = await activate(undefined, withoutGrant('session:read'));

    expect(active).toEqual(['agents']);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.cause).toBeInstanceOf(ExtensionUndeclaredError);
    expect(String(failed[0]?.cause)).toContain('session:read');
  });

  it('refuses a background command when its manifest lacks task:start', async () => {
    const coding = codingRun({
      project,
      permissions: testPermissions({ mode: 'allow_all' }),
      adjust: withoutGrant('task:start'),
    });
    const run = await coding.activate();
    const result = await runTool({
      tools: [run.tool('run_command')],
      call: {
        id: callIdSchema.parse('c1'),
        name: 'run_command',
        input: { description: 'echo', command: 'echo hi', background: true },
      },
      signal: new AbortController().signal,
      session: coding.harness.mainSession,
    });

    await run.deactivate();

    expect(result.isError).toBe(true);
    expect(result.content).toContain('task:start');
  });
});
