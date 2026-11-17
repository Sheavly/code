import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';

const REPO = path.resolve(import.meta.dirname, '../../../..');

const WORKSPACE = 'packages/workspace';
const CODING = 'extensions/coding';
const CORE = 'packages/core';
const FACTORY = 'src/instruction-context/instruction-source.helper.ts';

const on = (params) => ruleIsErrorOn({ folder: CODING, ...params });
const onWorkspace = (params) => ruleIsErrorOn({ folder: WORKSPACE, ...params });

// The two rules hold only where they are meant to: the factory file (in core) is the one exception
// to the import ban, and the skills source the one to the `node:fs` ban. A renamed file or a
// widened override changes these answers, so the exceptions are pinned, not just configured.
describe('no-direct-instruction-context', () => {
  it('is on for the instruction sources', async () => {
    for (const file of ['src/agents-md/agents-md.helper.ts', 'src/skills/skills.helper.ts']) {
      expect(await on({ rule: 'harness/no-direct-instruction-context', file })).toBe(true);
    }

    for (const file of [
      'src/scratch/scratch-hook.helper.ts',
      'src/instruction-context/confined-read.helper.ts',
    ]) {
      expect(await onWorkspace({ rule: 'harness/no-direct-instruction-context', file })).toBe(true);
    }
  });

  it('is off only for the factory in core, which exists', async () => {
    expect(
      await ruleIsErrorOn({
        folder: CORE,
        rule: 'harness/no-direct-instruction-context',
        file: FACTORY,
      }),
    ).toBe(false);
    expect(existsSync(path.join(REPO, CORE, FACTORY))).toBe(true);
  });

  it('is on for the rest of core, and for a factory-named file in the workspace', async () => {
    expect(
      await ruleIsErrorOn({
        folder: CORE,
        rule: 'harness/no-direct-instruction-context',
        file: 'src/instruction-context/instruction-context.prompt.ts',
      }),
    ).toBe(true);
    expect(
      await onWorkspace({ rule: 'harness/no-direct-instruction-context', file: FACTORY }),
    ).toBe(true);
  });

  it('is on in another workspace, so a hook there cannot append by hand', async () => {
    expect(
      await ruleIsErrorOn({
        rule: 'harness/no-direct-instruction-context',
        file: 'src/working-root/working-root-hook.helper.ts',
      }),
    ).toBe(true);
  });
});

describe('no-raw-fs-in-instruction-source', () => {
  it('is on for the AGENTS.md source, the factory in core, and in other workspaces', async () => {
    expect(
      await on({
        rule: 'harness/no-raw-fs-in-instruction-source',
        file: 'src/agents-md/agents-md.helper.ts',
      }),
    ).toBe(true);
    expect(
      await ruleIsErrorOn({
        folder: CORE,
        rule: 'harness/no-raw-fs-in-instruction-source',
        file: FACTORY,
      }),
    ).toBe(true);

    expect(
      await ruleIsErrorOn({
        rule: 'harness/no-raw-fs-in-instruction-source',
        file: 'src/working-root/working-root-hook.helper.ts',
      }),
    ).toBe(true);
  });

  it('is off only for the skills source, which reads fixed folders', async () => {
    expect(
      await on({
        rule: 'harness/no-raw-fs-in-instruction-source',
        file: 'src/skills/skills.helper.ts',
      }),
    ).toBe(false);
  });

  it('is off for tests, which write their fixtures', async () => {
    expect(
      await on({
        rule: 'harness/no-raw-fs-in-instruction-source',
        file: 'src/agents-md/__tests__/agents-md.helper.test.ts',
      }),
    ).toBe(false);
  });
});
