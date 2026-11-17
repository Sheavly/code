import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { testWorkingRoots } from '@sheavly/workspace/testing/working-root-store.fake';
import { createCodingHarness } from '../../preset/coding.helper.js';
import { CODING_HOOK_NAMES } from '../coding-hook-names.constants.js';
import { createInstructionHooks } from '../coding-hooks.helper.js';

let base: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'coding-hook-names-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('the coding extension hook names', () => {
  it('are the names third parties place hooks against, in run order: renaming any one fails here', async () => {
    const harness = await createCodingHarness({
      provider: routedProvider({ hi: [say('hello')] }),
      title: 'hi',
      workspaceRoot: base,
      scratchRoot: path.join(base, 'scratch'),
      env: {},
    });
    const hooks = createInstructionHooks({
      harness,
      workingRoots: testWorkingRoots({ workspace: harness.workspace }),
      skillRoots: { root: harness.workspace.root, home: undefined },
    });

    // Object.values keeps insertion order: the order the instruction sources declare.
    expect(hooks.map((hook) => hook.name)).toEqual(Object.values(CODING_HOOK_NAMES));
  });

  it('are written out here too, so changing the constant itself is also a visible break', () => {
    expect(CODING_HOOK_NAMES).toEqual({
      agentsMd: 'agents-md',
      skills: 'skills',
      scratch: 'scratch',
      workingRoot: 'working-root',
    });
  });
});
