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
    ['echo "a\\nb"', 'inside double quotes'],
  ])('refuses %j for its %s', (line, why) => {
    const parsed = parseCommand(line);

    expect(parsed).toMatchObject({ ok: false });
    expect(parsed.ok ? '' : parsed.reason).toContain(why);
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
  it('exact entries match only the exact command', () => {
    expect(matchesEntry({ argv: ['git', 'status'], entry: 'git status' })).toBe(true);
    expect(matchesEntry({ argv: ['git', 'status', '--short'], entry: 'git status' })).toBe(false);
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
