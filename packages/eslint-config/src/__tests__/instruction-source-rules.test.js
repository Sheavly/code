import { describe, expect, it } from 'vitest';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';

const WORKSPACE = 'packages/workspace';
const FACTORY = 'src/instruction-context/instruction-source.helper.ts';

const on = (params) => ruleIsErrorOn({ folder: WORKSPACE, ...params });

// The two rules hold only where they are meant to: the factory file is the one exception to the
// import ban, and the skills source the one to the `node:fs` ban. A renamed file or a widened
// override changes these answers, so the exceptions are pinned, not just configured.
describe('no-direct-instruction-context', () => {
  it('is on for the instruction sources', async () => {
    for (const file of [
      'src/agents-md/agents-md.helper.ts',
      'src/skills/skills.helper.ts',
      'src/scratch/scratch-hook.helper.ts',
      'src/instruction-context/confined-read.helper.ts',
    ]) {
      expect(await on({ rule: 'harness/no-direct-instruction-context', file })).toBe(true);
    }
  });

  it('is off only for the factory, which exists', async () => {
    expect(await on({ rule: 'harness/no-direct-instruction-context', file: FACTORY })).toBe(false);
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
  it('is on for the AGENTS.md source and the factory, and in other workspaces', async () => {
    for (const file of ['src/agents-md/agents-md.helper.ts', FACTORY]) {
      expect(await on({ rule: 'harness/no-raw-fs-in-instruction-source', file })).toBe(true);
    }

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
