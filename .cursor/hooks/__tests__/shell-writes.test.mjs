import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DENIED_CASES } from '../shell-guard-cases.utils.mjs';
import { shellGuardFailure } from '../shell-guard-stop.utils.mjs';
import { changedFiles, isSanctionedWriter, snapshotProject } from '../shell-writes.utils.mjs';
import { runEditHook, runHook } from './run-hook.utils.mjs';

let repo = '';
let stateDir = '';

const readState = () => JSON.parse(readFileSync(path.join(stateDir, 'c1.json'), 'utf8'));

/** Runs `command` the way Cursor does: the guard, then (if allowed) `write`, then the after-hook. */
function runShell(params) {
  const { command, write } = params;
  const decision = runHook({
    script: 'guard-shell-commands.mjs',
    cwd: repo,
    input: { conversation_id: 'c1', command, cwd: repo },
    stateDir,
  });

  if (decision.permission !== 'allow') return { decision };
  write?.();

  return {
    decision,
    after: runHook({
      script: 'record-shell-writes.mjs',
      cwd: repo,
      input: { conversation_id: 'c1', tool_input: { command }, cwd: repo },
      stateDir,
    }),
  };
}

beforeEach(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'shell-writes-repo-'));
  stateDir = mkdtempSync(path.join(os.tmpdir(), 'shell-writes-state-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  spawnSync('git', ['add', '.'], { cwd: repo });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], {
    cwd: repo,
  });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

describe('changedFiles', () => {
  it('lists edited, created and deleted files, and nothing once HEAD moved', () => {
    const before = snapshotProject(repo);

    writeFileSync(path.join(repo, 'a.ts'), 'export const a = 2;\n');
    writeFileSync(path.join(repo, 'b.ts'), '');
    const after = snapshotProject(repo);

    expect(changedFiles({ before, after })).toEqual(['a.ts', 'b.ts']);
    expect(changedFiles({ before, after: { ...after, head: 'other' } })).toEqual([]);
  });

  it('sees a second edit of a file that was already dirty', () => {
    writeFileSync(path.join(repo, 'a.ts'), 'export const a = 2;\n');
    const before = snapshotProject(repo);

    writeFileSync(path.join(repo, 'a.ts'), 'export const a = 3;\n');

    expect(changedFiles({ before, after: snapshotProject(repo) })).toEqual(['a.ts']);
  });
});

describe('isSanctionedWriter', () => {
  it.each([
    'npm run format',
    'cd x && npx prettier --write a.ts',
    'git stash',
    'rg a | head',
    // A `|` inside a quoted pattern is the pattern's, not a pipe into another program.
    `npm run check 2>&1 | rg -v "npm notice" | rg "Tasks:|Failed:|ERROR  run"`,
    // Nor are `(`, `)` or `$` in a quoted regex.
    `git diff docs/README.md | rg "^[+-]" | rg -v "^(\\+\\+\\+|---)$" | head -30`,
    // A launcher runs the sanctioned writer after it.
    'timeout 120 npm test -w @sheavly/server 2>&1 | rg -v "npm notice" | head -14',
    // Status reads, chained with a search.
    `stat -c '%y %n' package.json; rg -n "restore|revert" .cursor/hooks/x.mjs | head`,
    // A `\` continuation is one command; a heredoc body is input, not commands.
    'npm run check \\\n  --workspace @sheavly/server',
    "git commit -q -F - <<'EOF'\nfix: x\n\ncp a b\nEOF",
    // A loop runs its body's commands: `for`, `do` and `done` aren't programs.
    'for p in protocol server; do npx tsc --noEmit -p packages/$p 2>&1 | head -5; done',
    // `cut` only prints what it is given, like `head` and `tail`.
    'npm run check 2>&1 | rg "Tasks:|Failed:" | cut -c1-200 | head -30',
    'npm run schema -w @sheavly/protocol 2>&1 | rg -v "npm notice" | tail -2; npm run check 2>&1 | cut -c1-200 | head',
  ])('trusts %s', (command) => expect(isSanctionedWriter(command)).toBe(true));

  it.each([
    'python3 -c "x"',
    'cat x > a.ts',
    'npm run format && cp b a',
    'echo x > a.ts',
    // Inline code is never trusted: the recorder can't tell what it wrote.
    `node -e "console.log(1)"`,
    // A quoted `>` is masked, but a real redirect after it still counts.
    `rg "a>b" README.md > a.ts`,
    // A launcher doesn't make what it runs trusted.
    'timeout 5 cp /tmp/x a.ts',
    // A newline ends a command: a writer on a later line isn't trusted for the first one.
    'echo go\ncp /tmp/x a.ts',
    "npm test\nsed -i 's/a/b/' README.md",
    // Nor is a loop body that writes.
    'for f in a b; do cp /tmp/x $f; done',
    // `cut` prints, but a redirect after it writes, and a writer chained to it still counts.
    'npm run check 2>&1 | cut -c1-200 > a.ts',
    'cut -c1-5 README.md; cp /tmp/x a.ts',
  ])('does not trust %s', (command) => expect(isSanctionedWriter(command)).toBe(false));
});

describe('a shell workaround', () => {
  // A write the guard doesn't know yet (it denies inline-script writes such as `python3 -c`).
  const command = 'echo x | tee a.ts';
  const write = () => writeFileSync(path.join(repo, 'a.ts'), 'x');

  it('is reported, recorded for the gate, and holds the stop hook until the guard learns it', async () => {
    const { after } = runShell({ command, write });

    expect(after.additional_context).toMatch(/changed project files without the edit tools: a\.ts/);
    expect(after.additional_context).toContain('DENIED_CASES');
    const state = readState();

    expect(state.editedProjectSource).toBe(true);
    expect(Object.keys(state.editedFiles)).toEqual(['a.ts']);
    expect(state.unguardedCommands).toEqual([
      { command, cwd: repo, files: ['a.ts'], at: expect.any(Number) },
    ]);
    expect(state.shellSnapshots).toEqual({});

    const failure = await shellGuardFailure({
      state,
      projectRoot: repo,
      othersEditedSince: () => new Set(),
    });

    expect(failure).toContain('the guard still allows it; DENIED_CASES lacks it');
  });

  it("drops it at stop when another chat recorded editing the file after the command's after-hook", async () => {
    runShell({ command, write });
    const state = readState();
    const [{ at }] = state.unguardedCommands;
    const othersEditedSince = ({ since }) => new Set(since <= at ? ['a.ts'] : []);

    expect(await shellGuardFailure({ state, projectRoot: repo, othersEditedSince })).toBeNull();
  });

  it('passes the stop hook once the guard denies it and DENIED_CASES lists it', async () => {
    const learned = {
      unguardedCommands: [{ command: DENIED_CASES[1], cwd: repo, files: ['README.md'] }],
    };

    expect(await shellGuardFailure({ state: learned, projectRoot: repo })).toBeNull();
  });

  it('lets go of a command recorded before the recorder knew it for a known writer', async () => {
    const misread = {
      unguardedCommands: [
        {
          command: 'for p in a b; do npm run schema -w $p; done',
          cwd: repo,
          files: ['contract.schema.json'],
        },
      ],
    };

    expect(await shellGuardFailure({ state: misread, projectRoot: repo })).toBeNull();
  });

  it('fails the stop hook when a case committed at HEAD left DENIED_CASES', async () => {
    const casesDir = path.join(repo, '.cursor', 'hooks');

    mkdirSync(casesDir, { recursive: true });
    writeFileSync(
      path.join(casesDir, 'shell-guard-cases.utils.mjs'),
      `export const DENIED_CASES = ${JSON.stringify([...DENIED_CASES, 'tee a.ts'])};\n`,
    );
    spawnSync('git', ['add', '.'], { cwd: repo });
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'cases'], {
      cwd: repo,
    });

    expect(await shellGuardFailure({ state: {}, projectRoot: repo })).toContain(
      '`tee a.ts` was removed from DENIED_CASES',
    );
  });

  it('is not reported when the command changed nothing', () => {
    expect(runShell({ command }).after).toEqual({});
    expect(readState().unguardedCommands).toBeUndefined();
  });

  it('records a sanctioned writer for the gate without reporting it', () => {
    expect(runShell({ command: 'npm run format', write }).after).toEqual({});
    expect(readState()).toMatchObject({ editedProjectSource: true, shellSnapshots: {} });
    expect(Object.keys(readState().editedFiles)).toEqual(['a.ts']);
  });

  it("leaves out a file another chat edited while the command ran, so it isn't blamed for it", () => {
    const otherChatEdits = () => {
      write();
      runEditHook({ cwd: repo, file: 'a.ts', chat: 'other', stateDir });
    };

    expect(runShell({ command, write: otherChatEdits }).after).toEqual({});
    expect(readState().unguardedCommands).toBeUndefined();
    expect(readState().editedFiles).toBeUndefined();
  });
});
