// The dev guardrails as Sheavly project hooks (`.sheavly/`): each runs the real Cursor hook script
// against a throwaway project, so what is tested is the bridge and the translation, not a copy of
// the checks. Tests live here, not in `.sheavly/`, so editing one does not change the trust
// fingerprint of the folder.
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFiles } from '../../packages/eslint-config/src/testing/workspace.fake.js';
import { CursorBridgeError, runCursorHook } from '../../.sheavly/hooks/cursor-bridge.mjs';
import { createEditFeedbackHook } from '../../.sheavly/hooks/edit-feedback.mjs';
import { createSessionStartHook } from '../../.sheavly/hooks/session-start.mjs';
import { createShellGuardHook } from '../../.sheavly/hooks/shell-guard.mjs';
import { REPO_ROOT } from './temp-repo.utils.mjs';

const HOOKS_DIR = path.join(REPO_ROOT, '.cursor', 'hooks');
let project = '';
let stateDir = '';

/** Options that run the real scripts against the temp project, with their state in a temp folder. */
const options = () => ({
  root: project,
  hooksDir: HOOKS_DIR,
  env: { SHEAVLY_HOOK_STATE_DIR: stateDir },
});

const write = (files) => writeFiles({ root: project, files });

beforeEach(() => {
  project = mkdtempSync(path.join(os.tmpdir(), 'sheavly-hooks-project-'));
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'sheavly-hooks-state-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

/**
 * Runs `hook.aroundToolCall` for a call, with a tool that returns `result`; `ran.tool` says whether
 * the hook let the tool run.
 */
function around(params) {
  const { hook, name, input, result = { content: 'done', isError: false }, ran = {} } = params;

  ran.tool = false;

  return hook.aroundToolCall({
    call: { id: 'c1', name, input },
    description: 'a call',
    signal: new AbortController().signal,
    next: async () => {
      ran.tool = true;

      return result;
    },
  });
}

describe('the edit feedback hook', () => {
  const skillFiles = {
    // The post-edit script reads the workspaces from the root package.json for its layout note.
    'package.json': { name: 'monorepo', workspaces: ['packages/*'] },
    '.agents/skills/zz/SKILL.md': '---\nname: zz\n---\n',
    '.agents/skills/zz/harness.json': { governs: ['docs/**'] },
    'docs/zz.md': '',
  };

  it('appends what the Cursor post-edit hook says to a file tool result', async () => {
    write(skillFiles);

    const result = await around({
      hook: createEditFeedbackHook(options()),
      name: 'edit_file',
      input: { path: 'docs/zz.md' },
    });

    expect(result.content).toContain('done');
    expect(result.content).toContain('governed by the `zz` skill');
  });

  it('reports a file that needs formatting without rewriting it', async () => {
    const unformatted = 'const   a  =   1\n';

    write({
      'package.json': { name: 'monorepo', workspaces: ['packages/*'] },
      'a.js': unformatted,
    });
    // The real Prettier, from this repo, as a Cursor chat would run it.
    symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(project, 'node_modules'));

    const result = await around({
      hook: createEditFeedbackHook(options()),
      name: 'edit_file',
      input: { path: 'a.js' },
    });

    expect(result.content).toContain('Prettier would reformat the file');
    expect(readFileSync(path.join(project, 'a.js'), 'utf8')).toBe(unformatted);
  });

  it('does not call a missing Prettier a formatting problem', async () => {
    write({
      'package.json': { name: 'monorepo', workspaces: ['packages/*'] },
      'a.js': 'const   a  =   1\n',
    });

    const result = await around({
      hook: createEditFeedbackHook(options()),
      name: 'edit_file',
      input: { path: 'a.js' },
    });

    expect(result.content).not.toContain('would reformat');
  });

  it('leaves a tool result alone when the hook has nothing to add', async () => {
    write({ ...skillFiles, 'notes/zz.md': '' });

    const result = await around({
      hook: createEditFeedbackHook(options()),
      name: 'write_file',
      input: { path: 'notes/zz.md' },
    });

    expect(result).toEqual({ content: 'done', isError: false });
  });

  it('ignores tools that are not file tools, and failed edits', async () => {
    write(skillFiles);
    const hook = createEditFeedbackHook(options());

    expect(await around({ hook, name: 'read_file', input: { path: 'docs/zz.md' } })).toEqual({
      content: 'done',
      isError: false,
    });
    expect(
      await around({
        hook,
        name: 'edit_file',
        input: { path: 'docs/zz.md' },
        result: { content: 'refused', isError: true },
      }),
    ).toEqual({ content: 'refused', isError: true });
  });

  it('says so when the script cannot run, and keeps the edit', async () => {
    const result = await around({
      hook: createEditFeedbackHook({ ...options(), hooksDir: path.join(project, 'missing') }),
      name: 'edit_file',
      input: { path: 'docs/zz.md' },
    });

    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/^done\n\nThe lint-edited-file\.mjs hook could not run/);
  });
});

describe('the shell guard hook', () => {
  const ran = { content: 'out', isError: false };

  it('blocks a command that edits a project file past the edit tools, without running it', async () => {
    write({ 'a.txt': 'a\n' });
    const seen = {};
    const result = await around({
      hook: createShellGuardHook(options()),
      name: 'run_command',
      input: { command: "sed -i 's/a/b/' a.txt" },
      result: ran,
      ran: seen,
    });

    expect(seen.tool).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/sed|in-place|edit tools/i);
  });

  it('lets a harmless command through and returns its own result', async () => {
    write({ 'a.txt': 'a\n' });

    const result = await around({
      hook: createShellGuardHook(options()),
      name: 'run_command',
      input: { command: 'ls' },
      result: ran,
    });

    expect(result).toEqual(ran);
  });

  it('does not look at tools other than run_command', async () => {
    const result = await around({
      hook: createShellGuardHook({ ...options(), hooksDir: path.join(project, 'missing') }),
      name: 'read_file',
      input: { path: 'a.txt' },
      result: ran,
    });

    expect(result).toEqual(ran);
  });

  it('fails closed: a guard that cannot run blocks the command, and says why', async () => {
    const seen = {};
    const result = await around({
      hook: createShellGuardHook({ ...options(), hooksDir: path.join(project, 'missing') }),
      name: 'run_command',
      input: { command: 'ls' },
      result: ran,
      ran: seen,
    });

    expect(seen.tool).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('could not run');
    expect(result.content).toContain('was not run');
  });
});

/** A hooks folder whose scripts print `answers[script]` (a JSON string) or run `bodies[script]`. */
function fakeHooks(scripts) {
  const dir = path.join(project, 'fake-hooks');

  writeFiles({ root: dir, files: scripts });

  return dir;
}

/** What `promise` rejects with; a promise that resolves fails the test instead of passing it. */
async function rejection(promise) {
  try {
    await promise;
  } catch (caughtError) {
    return caughtError;
  }

  throw new Error('Expected the promise to reject, and it resolved.');
}

/** Long enough for a grandchild that was left running to write its marker (700 ms). */
const wait = () => new Promise((resolve) => setTimeout(resolve, 1200));

const GUARDS = ['guard-shell-commands.mjs', 'guard-git-workflow.mjs'];
const allowing = (answer) => Object.fromEntries(GUARDS.map((name) => [name, answer]));

describe('the shell guard fails closed', () => {
  const ran = { content: 'out', isError: false };
  const run = async (scripts, input = { command: 'ls' }, extra = {}) => {
    const seen = {};
    const result = await around({
      hook: createShellGuardHook({ ...options(), hooksDir: fakeHooks(scripts), ...extra }),
      name: 'run_command',
      input,
      result: ran,
      ran: seen,
    });

    return { result, seen };
  };
  const printing = (json) => `console.log(${JSON.stringify(JSON.stringify(json))});`;

  it('runs the command only when both guards explicitly allow it', async () => {
    const { result, seen } = await run({
      ...allowing(printing({ permission: 'allow' })),
      'record-shell-writes.mjs': printing({}),
    });

    expect(seen.tool).toBe(true);
    expect(result).toEqual(ran);
  });

  it.each([
    ['a deny with no message', { permission: 'deny' }],
    ['a deny with an empty message', { permission: 'deny', agent_message: '' }],
    ['a deny with blank messages', { permission: 'deny', agent_message: ' ', user_message: '' }],
    ['an answer that is JSON null', null],
    ['an empty answer', {}],
    ['an answer that is not allow or deny', { permission: 'ask' }],
  ])('blocks the command on %s', async (_, answer) => {
    const { result, seen } = await run(allowing(printing(answer)));

    expect(seen.tool).toBe(false);
    expect(result.isError).toBe(true);
    // A `null` answer never reaches the guard's own check: the bridge refuses it as not an object.
    expect(result.content).toMatch(/did not allow|not an object/);
  });

  it('blocks the command when the second guard denies, with its reason', async () => {
    const { result, seen } = await run({
      'guard-shell-commands.mjs': printing({ permission: 'allow' }),
      'guard-git-workflow.mjs': printing({ permission: 'deny', agent_message: 'no pushes' }),
    });

    expect(seen.tool).toBe(false);
    expect(result.content).toBe('no pushes');
  });

  it('blocks a guard that exits non-zero, that prints no JSON, or that outlives the timeout', async () => {
    const failing = await run(allowing('process.exit(3);'));
    const garbage = await run(allowing("console.log('not json');"));
    const slow = await run(allowing('setTimeout(() => {}, 60000);'), undefined, { timeoutMs: 200 });

    for (const { result, seen } of [failing, garbage, slow]) {
      expect(seen.tool).toBe(false);
      expect(result.content).toContain('was not run');
    }

    expect(slow.result.content).toContain('timed out after 200 ms');
  });

  it('blocks a run_command that has no command string', async () => {
    const { result, seen } = await run(allowing(printing({ permission: 'allow' })), {});

    expect(seen.tool).toBe(false);
    expect(result.isError).toBe(true);
  });

  describe('the record script after a command', () => {
    const calls = () => path.join(project, 'record-calls.txt');
    const scripts = () => ({
      ...allowing(printing({ permission: 'allow' })),
      'record-shell-writes.mjs': `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(calls())}, 'x'); ${printing({})}`,
    });

    it('runs after a foreground command (the control for the next test)', async () => {
      const { seen } = await run(scripts(), { command: 'ls' });

      expect(seen.tool).toBe(true);
      expect(existsSync(calls())).toBe(true);
    });

    it('does not run after a background command, which has not run yet', async () => {
      const { seen } = await run(scripts(), { command: 'sleep 5', background: true });

      expect(seen.tool).toBe(true);
      expect(existsSync(calls())).toBe(false);
    });
  });

  it('stops a guard when the run is aborted, and blocks the command', async () => {
    const controller = new AbortController();
    const pending = createShellGuardHook({
      ...options(),
      hooksDir: fakeHooks(allowing('setTimeout(() => {}, 60000);')),
    }).aroundToolCall({
      call: { id: 'c1', name: 'run_command', input: { command: 'ls' } },
      description: 'list',
      signal: controller.signal,
      next: async () => ran,
    });

    setTimeout(() => controller.abort(), 100);

    expect((await pending).content).toContain('aborted');
  });
});

describe('the bridge runs scripts with a narrow environment', () => {
  it('keeps API keys and other secrets out of the child, and passes what the caller adds', async () => {
    const dir = fakeHooks({
      'env.mjs':
        'console.log(JSON.stringify({ key: process.env.OPENAI_API_KEY ?? null, state: process.env.SHEAVLY_HOOK_STATE_DIR ?? null }));',
    });
    const before = process.env.OPENAI_API_KEY;

    process.env.OPENAI_API_KEY = 'sk-test-not-real';

    try {
      const answer = await runCursorHook({
        script: 'env.mjs',
        input: {},
        root: project,
        hooksDir: dir,
        env: { SHEAVLY_HOOK_STATE_DIR: stateDir },
      });

      expect(answer).toEqual({ key: null, state: stateDir });
    } finally {
      if (before === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = before;
    }
  });

  it('rejects an answer that is not an object', async () => {
    const dir = fakeHooks({
      'null.mjs': "console.log('null');",
      'list.mjs': "console.log('[1]');",
    });

    for (const script of ['null.mjs', 'list.mjs']) {
      const error = await runCursorHook({ script, input: {}, root: project, hooksDir: dir }).catch(
        (caughtError) => caughtError,
      );

      expect(error).toBeInstanceOf(CursorBridgeError);
      expect(error.message).toContain('not an object');
    }
  });

  it('rejects, instead of hanging, when the script cannot even start', async () => {
    const error = await runCursorHook({
      script: 'x.mjs',
      input: {},
      root: path.join(project, 'no-such-folder'),
      hooksDir: project,
    }).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(CursorBridgeError);
  });

  it('rejects at once for a signal that is already aborted, and never runs the script', async () => {
    const marker = path.join(project, 'ran.txt');
    const dir = fakeHooks({
      'mark.mjs': `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'x'); console.log('{}');`,
    });
    const error = await runCursorHook({
      script: 'mark.mjs',
      input: {},
      root: project,
      hooksDir: dir,
      signal: AbortSignal.abort(),
    }).catch((caughtError) => caughtError);

    expect(error.message).toContain('aborted');
    // The child may have started; what is held is that the caller is not kept waiting.
    expect(error).toBeInstanceOf(CursorBridgeError);
  });

  describe('what a script starts', () => {
    const marker = () => path.join(project, 'grandchild.txt');
    // The grandchild is a file of its own, so no quoting can break the script it is started from.
    const scripts = (tail) => ({
      'grandchild.mjs': `import { writeFileSync } from 'node:fs'; setTimeout(() => writeFileSync(${JSON.stringify(marker())}, 'x'), 700);`,
      'spawner.mjs': `
        import { spawn } from 'node:child_process';
        import path from 'node:path';
        spawn(process.execPath, [path.join(import.meta.dirname, 'grandchild.mjs')], { stdio: 'ignore' });
        ${tail}
      `,
    });

    it('is left running when the script finishes normally (the control for the next test)', async () => {
      await runCursorHook({
        script: 'spawner.mjs',
        input: {},
        root: project,
        hooksDir: fakeHooks(scripts("console.log('{}');")),
      });
      await wait();

      expect(existsSync(marker())).toBe(true);
    });

    it('is killed with the script on a timeout', async () => {
      const error = await rejection(
        runCursorHook({
          script: 'spawner.mjs',
          input: {},
          root: project,
          hooksDir: fakeHooks(scripts('setTimeout(() => {}, 60000);')),
          timeoutMs: 300,
        }),
      );

      expect(error.message).toContain('timed out after 300 ms');
      await wait();

      expect(existsSync(marker())).toBe(false);
    });
  });

  it('cuts a long failure reason before it reaches the model', async () => {
    const dir = fakeHooks({ 'loud.mjs': "console.error('x'.repeat(5000)); process.exit(1);" });
    const error = await runCursorHook({
      script: 'loud.mjs',
      input: {},
      root: project,
      hooksDir: dir,
    }).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(CursorBridgeError);
    expect(error.message.length).toBeLessThan(600);
  });
});

describe('the session start hook', () => {
  /** What the hook adds, for an opening prompt. */
  async function added(prompt, hookOptions = options()) {
    const context = [];

    await createSessionStartHook(hookOptions).sessionStart({
      messages: [{ role: 'user', content: prompt }],
      signal: new AbortController().signal,
      addContext: (text) => context.push(text),
    });

    return context;
  }

  it('always points at the sheavly skill and says to extend, not modify', async () => {
    const [pointer] = await added('#123: fix it');

    expect(pointer).toContain('.agents/skills/sheavly/SKILL.md');
    expect(pointer).toContain('never modify its core');
  });

  it('says nothing more when the opening prompt names an issue', async () => {
    expect(await added('#123: add export')).toHaveLength(1);
  });

  it('adds the issue rule when the opening prompt names none', async () => {
    const context = await added('fix the bug');

    expect(context).toHaveLength(2);
    expect(context[1]).toContain('Name the GitHub issue');
  });

  it('adds the bridge error when the issue script cannot run', async () => {
    const context = await added('fix it', {
      ...options(),
      hooksDir: path.join(project, 'missing'),
    });

    expect(context[1]).toContain('require-issue.mjs hook could not run');
  });
});
