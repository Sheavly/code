import { describe, expect, it, vi } from 'vitest';
import { promptReviewFailure } from '../prompt-review.utils.mjs';

const failed = () => ({
  ok: false,
  output: 'packages/host/src/instructions/instructions.prompt.ts: unreviewed tool changes',
});
const scopeFor = (file) => ({ files: new Set([file]) });

describe('the stop-hook prompt review', () => {
  it.each([
    'packages/new-tools/src/action/action.tool.ts',
    'packages/new-tools/src/action/action.constants.ts',
    'packages/summary/src/model/summary.prompt.ts',
    'packages/new-tools/src/action/action.prompt.ts',
    'packages/host/src/instructions/instructions.prompt.ts',
    'packages/new-tools/package.json',
    'package.json',
    'packages/eslint-config/src/rules/system-prompt-review.js',
    'turbo.json',
    '.cursor/hooks/check-on-stop.mjs',
    '.cursor/hooks/prompt-review.utils.mjs',
    'packages\\new-tools\\src\\action\\action.tool.ts',
  ])('runs independently for %s, even without the host in scope', (file) => {
    const run = vi.fn(failed);
    const scope = scopeFor(file);
    const report = promptReviewFailure({ scope, run });

    expect(run).toHaveBeenCalledExactlyOnceWith('lint:prompt');
    expect(report).toContain('System prompt review');
    expect(report).toContain('unreviewed tool changes');
    expect(report).toContain('packages/host/src/instructions/instructions.prompt.ts');
  });

  it('also checks deleted tool paths without needing the file to exist', () => {
    const run = vi.fn(failed);

    expect(
      promptReviewFailure({ scope: scopeFor('packages/deleted/src/old/old.tool.ts'), run }),
    ).toContain('unreviewed tool changes');
    expect(run).toHaveBeenCalledOnce();
  });

  it('runs when older chat state has no file scope', () => {
    const run = vi.fn(failed);

    expect(promptReviewFailure({ scope: null, run })).toContain('unreviewed tool changes');
    expect(run).toHaveBeenCalledOnce();
  });

  it('does not report a passing check', () => {
    const run = vi.fn(() => ({ ok: true, output: '' }));

    expect(promptReviewFailure({ scope: null, run })).toBeNull();
  });

  it.each([
    'packages/tools/src/action/action.helper.ts',
    'packages/tools/src/action/__tests__/action.tool.test.ts',
    'packages/testing/src/testing/action.tool.ts',
    'packages/tools/src/action/README.md',
  ])('does not attribute unrelated tool drift to a chat changing %s', (file) => {
    const run = vi.fn(failed);

    expect(promptReviewFailure({ scope: scopeFor(file), run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
