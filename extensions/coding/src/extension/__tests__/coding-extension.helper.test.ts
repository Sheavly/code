import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentsExtension } from '@sheavly/agents/agents/agents.helper';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import { runServices } from '@sheavly/host/run-services/run-services.helper';
import { noSubAgentRuns } from '@sheavly/host/testing/run-loop.fake';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { memoryShellStore } from '@sheavly/workspace/working-root/memory-shell.helper';
import { createCodingHarness } from '../../preset/coding.helper.js';
import { testPermissions } from '../../testing/permissions.fake.js';
import { memoryTrust } from '../../testing/trust.fake.js';
import { TrustStore } from '../../trust/trust.service.js';
import { createCodingExtension } from '../coding-extension.helper.js';
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
async function activate(outputs?: MemoryOutputStore) {
  const harness = await createCodingHarness({
    provider: routedProvider({ go: [say('ok')] }),
    title: 'go',
    workspaceRoot: project,
    scratchRoot: path.join(base, 'scratch'),
    env: {},
  });
  const host = new ExtensionHost({
    extensions: [
      createAgentsExtension(),
      createCodingExtension({
        harness,
        env: {},
        permissions: testPermissions(),
        trustStore: new TrustStore({
          persistence: memoryTrust({ file: path.join(base, 'trusted.json') }),
        }),
        trustWorkspace: true,
        shell: memoryShellStore(),
      }),
    ],
    services: runServices({ harness, outputs, runSession: noSubAgentRuns }),
  });
  const result = await host.activate({ signal: new AbortController().signal });

  await host.deactivate();

  return result;
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
    expect(manifest.grants).toEqual(['output:capture']);
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
});
