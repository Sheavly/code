import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isAllowed, matchesEntry, parseCommand } from '../allow-list.utils.js';

const argvs = (line: string) => {
  const parsed = parseCommand(line);

  return parsed.ok ? parsed.steps.map((step) => step.argv) : parsed;
};

describe('parseCommand', () => {
  it('splits words and honours quotes', () => {
    expect(argvs(`git commit -m "fix bug" --author 'A B'`)).toEqual([
      ['git', 'commit', '-m', 'fix bug', '--author', 'A B'],
    ]);
  });

  it('joins a quoted part to the word around it, and keeps an empty quoted word', () => {
    expect(argvs(`echo a"b c"d ''`)).toEqual([['echo', 'ab cd', '']]);
  });

  it('reads | && || and ; as the joins between commands, and what joins each', () => {
    expect(parseCommand('git log | head -5 && echo ok || echo no; pwd')).toEqual({
      ok: true,
      steps: [
        { argv: ['git', 'log'], joinedBy: '|' },
        { argv: ['head', '-5'], joinedBy: '&&' },
        { argv: ['echo', 'ok'], joinedBy: '||' },
        { argv: ['echo', 'no'], joinedBy: ';' },
        { argv: ['pwd'] },
      ],
    });
  });

  it('needs no spaces around a join', () => {
    expect(argvs('ls|head')).toEqual([['ls'], ['head']]);
    expect(argvs('ls&&pwd')).toEqual([['ls'], ['pwd']]);
  });

  it('leaves a join inside quotes in its word', () => {
    expect(argvs(`rg 'a|b; c && d' src`)).toEqual([['rg', 'a|b; c && d', 'src']]);
  });

  it('ends the last command at a trailing ;', () => {
    expect(parseCommand('ls;')).toEqual({ ok: true, steps: [{ argv: ['ls'] }] });
  });

  it.each([
    ['ls > out', 'redirects'],
    ['ls < in', 'redirects'],
    ['ls 2>&1', 'redirects'],
    ['echo $HOME', 'variables'],
    ['echo `id`', 'backticks'],
    ['echo $(id)', 'variables'],
    ['(ls)', 'subshells'],
    ['ls\nrm x', 'newlines'],
    ['ls &', 'background'],
    ['echo a\\ b', 'backslash'],
    ['echo "$HOME"', 'inside double quotes'],
    ['echo "`id`"', 'inside double quotes'],
    ['echo "a\\\nb"', 'before a newline'],
  ])('refuses %j for its %s', (line, why) => {
    const parsed = parseCommand(line);

    expect(parsed).toMatchObject({ ok: false });
    expect(parsed.ok ? '' : parsed.reason).toContain(why);
  });

  it('names the character and shows the rewrite when it refuses', () => {
    const reason = (line: string) => {
      const parsed = parseCommand(line);

      return parsed.ok ? '' : parsed.reason;
    };

    expect(reason('echo "cost $5"')).toContain('`$`');
    expect(reason('echo "cost $5"')).toContain("e.g. 'cost $5'");
    expect(reason('grep -rn a\\|b src')).toContain("e.g. 'a\\|b'");
    expect(reason('echo "a`b"')).toContain('backticks');
  });

  // The words `sh` itself would hand the program, for the same text after `printf`.
  const shWords = (text: string) =>
    execFileSync('sh', ['-c', `printf '%s\\0' ${text}`], { encoding: 'utf8' })
      .split('\0')
      .slice(0, -1);

  it.each([
    String.raw`"a\|b"`,
    String.raw`"a\\b"`,
    String.raw`"a\$b"`,
    String.raw`"a\"b"`,
    'a"\\`"b',
    String.raw`"a\nb" "c\*d" "e\ f"`,
    String.raw`"\\\|" x"\q"y`,
  ])('reads the double-quoted %s as sh does', (text) => {
    expect(argvs(`printf '%s\\0' ${text}`)).toEqual([['printf', '%s\\0', ...shWords(text)]]);
  });

  it('carries grep -rnE "a\\|b" src out as the program would get it', () => {
    expect(argvs('grep -rnE "a\\|b" src')).toEqual([['grep', '-rnE', 'a\\|b', 'src']]);
  });

  it('reads what a single-quoted word holds as it is', () => {
    expect(argvs(`echo '$HOME \`id\` > x'`)).toEqual([['echo', '$HOME `id` > x']]);
  });

  it.each(['| ls', 'ls &&', 'ls ||', 'ls |', '; ls', 'ls && && pwd'])(
    'refuses a join with no command on one side: %j',
    (line) => expect(parseCommand(line)).toMatchObject({ ok: false }),
  );

  it('rejects unbalanced quotes and empty commands', () => {
    expect(parseCommand(`echo "oops`)).toMatchObject({ ok: false, reason: 'unbalanced quotes' });
    expect(parseCommand(`echo 'oops`)).toMatchObject({ ok: false, reason: 'unbalanced quotes' });
    expect(parseCommand('   ')).toMatchObject({ ok: false, reason: 'empty command' });
    expect(parseCommand('')).toMatchObject({ ok: false, reason: 'empty command' });
  });
});

describe('matchesEntry', () => {
  it('an exact: array names a base command whose words contain spaces', () => {
    const entry = 'exact:["echo","a b","*"]';

    expect(matchesEntry({ argv: ['echo', 'a b', '*'], entry })).toBe(true);
    expect(matchesEntry({ argv: ['echo', 'a', 'b', '*'], entry })).toBe(true);
    expect(matchesEntry({ argv: ['echo', 'a b', 'other'], entry })).toBe(true);
    expect(matchesEntry({ argv: ['echo', 'a b', '*', 'extra'], entry })).toBe(true);
    expect(matchesEntry({ argv: ['printf', 'a b'], entry })).toBe(false);
    expect(matchesEntry({ argv: ['echo'], entry: 'exact:broken' })).toBe(false);
  });
  it('prefixed scope strings are ordinary entries and match no command', () => {
    expect(matchesEntry({ argv: ['sed', '-n'], entry: 'read:sed *' })).toBe(false);
    expect(matchesEntry({ argv: ['npx', 'eslint'], entry: 'tool:npx eslint check *' })).toBe(false);
    expect(matchesEntry({ argv: ['node', 'a.mjs'], entry: 'script:node tmp/probe.mjs *' })).toBe(
      false,
    );
  });

  it('an entry also matches its base command with different arguments', () => {
    expect(matchesEntry({ argv: ['git', 'status'], entry: 'git status' })).toBe(true);
    expect(matchesEntry({ argv: ['git', 'status', '--short'], entry: 'git status' })).toBe(true);
    expect(matchesEntry({ argv: ['git'], entry: 'git status' })).toBe(false);
  });

  it('entries ending in * allow any extra arguments', () => {
    expect(matchesEntry({ argv: ['git', 'diff'], entry: 'git diff *' })).toBe(true);
    expect(matchesEntry({ argv: ['git', 'diff', 'src/'], entry: 'git diff *' })).toBe(true);
    expect(matchesEntry({ argv: ['git', 'push'], entry: 'git diff *' })).toBe(false);
  });

  it('checks the whole list', () => {
    expect(isAllowed({ argv: ['pwd'], allowList: ['ls *', 'pwd'] })).toBe(true);
    expect(isAllowed({ argv: ['rm', '-rf', '/'], allowList: ['ls *', 'pwd'] })).toBe(false);
  });
});
