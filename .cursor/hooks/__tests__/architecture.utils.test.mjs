import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  architectureRule,
  coveredByRule,
  sectionOf,
  WHERE_CODE_GOES,
  whereCodeGoes,
} from '../architecture.utils.mjs';
import { runEditHook } from './run-hook.utils.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SKILL = '.cursor/skills/working-in-sheavly-harness/SKILL.md';
let stateDir = '';
let project = '';

/**
 * Runs the postToolUse hook for an edit of `file`, in chat `chat`; returns its response. It runs
 * in a throwaway project holding only the skill and the edited file, so it never formats or lints
 * the real repo, and stays fast: without node_modules there, Prettier and ESLint don't start.
 */
function edited(params) {
  return runEditHook({ cwd: project, stateDir, ...params });
}

beforeEach(() => {
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'hook-state-'));
  project = mkdtempSync(path.join(os.tmpdir(), 'hook-project-'));
  mkdirSync(path.join(project, path.dirname(SKILL)), { recursive: true });
  copyFileSync(path.join(ROOT, SKILL), path.join(project, SKILL));

  for (const file of ['packages/host/src/host/x.service.ts', 'docs/x.md']) {
    mkdirSync(path.join(project, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(project, file), '');
  }
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('the architecture rule', () => {
  it('is read from the project skill, whole section and nothing after it', () => {
    const rule = architectureRule();

    expect(rule).toContain('## Backend only: typed events, no UI');
    expect(rule).toContain('only when the chat');
    expect(rule).toContain('harness/no-terminal-io');
    expect(rule).not.toContain('## Packages');
  });

  it('cuts a section at the next heading, or the end', () => {
    const markdown = '# T\n\n## A\none\n\n## B\ntwo\n';

    expect(sectionOf({ markdown, heading: '## A' })).toBe('## A\none');
    expect(sectionOf({ markdown, heading: '## B' })).toBe('## B\ntwo');
    expect(sectionOf({ markdown, heading: '## C' })).toBeNull();
  });

  it.each([
    ['packages/host/src/host/host.service.ts', true],
    ['apps/terminal/src/workbook/run.helper.ts', true],
    ['packages/core/src/tool/tool.types.ts', true],
    ['packages/coding/src/run-command/__tests__/arguments.service.test.ts', false],
    ['src/loop/turn.helper.ts', false],
    ['docs/tools.md', false],
    ['.cursor/hooks/hooks.utils.mjs', false],
  ])('covers %s: %s', (file, covered) => {
    expect(coveredByRule(file)).toBe(covered);
  });

  it('is injected on a chat’s first edit of harness source, then not again', () => {
    const first = edited({ file: 'packages/host/src/host/x.service.ts' });
    const second = edited({ file: 'packages/host/src/host/x.service.ts' });
    const otherChat = edited({ file: 'packages/host/src/host/x.service.ts', chat: 'c2' });

    expect(first.additional_context).toContain('Architecture rule for this project');
    expect(second.additional_context ?? '').not.toContain('Architecture rule');
    expect(otherChat.additional_context).toContain('Architecture rule for this project');
  });

  it('is not injected for edits outside harness source', () => {
    expect(edited({ file: 'docs/x.md' }).additional_context ?? '').not.toContain(
      'Architecture rule',
    );
  });
});

describe('"Where code goes"', () => {
  it('is read from the project skill: the decision rules and the new-package criteria', () => {
    const guide = whereCodeGoes();

    expect(guide).toContain(WHERE_CODE_GOES);
    expect(guide).toContain('Would a non-coding LLM project');
    expect(guide).toContain('A new package, instead of a folder');
    expect(guide).not.toContain('## Backend only');
  });

  it('routes to the generated workspace list instead of keeping its own', () => {
    const guide = whereCodeGoes() ?? '';

    expect(guide).toContain('sheavly-packages');
    // A row per workspace here would be a hand-kept copy of the router, which drifts.
    expect(guide).not.toMatch(/^\| `@sheavly\//m);
  });

  it('is injected once per chat, on its first edit of harness source', () => {
    const first = edited({ file: 'packages/host/src/host/x.service.ts' });
    const second = edited({ file: 'packages/host/src/host/x.service.ts' });

    expect(first.additional_context).toContain('Where code goes in this project');
    expect(second.additional_context ?? '').not.toContain('Where code goes');
    expect(edited({ file: 'docs/x.md', chat: 'c3' }).additional_context ?? '').not.toContain(
      'Where code goes',
    );
  });
});
