import { describe, expect, it } from 'vitest';
import { runCheckMessage, runSourceFiles } from '../run-check.utils.mjs';

describe('runSourceFiles', () => {
  it('keeps the source that changes what a run does', () => {
    expect(
      runSourceFiles([
        'packages/workspace/src/trust/trust.service.ts',
        'src/demo.ts',
        'packages/core/src/hook/hook.service.ts',
        'apps/workbook/src/workbook/run.helper.ts',
      ]),
    ).toEqual([
      'apps/workbook/src/workbook/run.helper.ts',
      'packages/core/src/hook/hook.service.ts',
      'packages/workspace/src/trust/trust.service.ts',
      'src/demo.ts',
    ]);
  });

  it('skips tests, fakes, lint rules, hooks, scripts and docs', () => {
    expect(
      runSourceFiles([
        'src/runtime/trust/__tests__/trust.service.test.ts',
        'src/testing/fake-fetch.fake.ts',
        'packages/eslint-config/src/rules/no-raw-error.js',
        '.cursor/hooks/check-on-stop.mjs',
        'scripts/jscpd-runner.mjs',
        'docs/hooks.md',
        'workbook/prompts/guards.md',
      ]),
    ).toEqual([]);
  });
});

describe('runCheckMessage', () => {
  it('names the command and every file, and says it is asked once', () => {
    const message = runCheckMessage(['src/demo.ts', 'src/host/host.service.ts']);

    expect(message).toContain('npm run workbook -- check');
    expect(message).toContain('- src/demo.ts\n- src/host/host.service.ts');
    expect(message).toContain("won't be asked again");
  });
});
