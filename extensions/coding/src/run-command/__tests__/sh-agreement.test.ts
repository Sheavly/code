import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseCommand } from '../allow-list.utils.js';

/**
 * The words `sh` gives a program for `line`, each printed in brackets on its own line so an empty
 * word is told from no word. This is the ground truth: what the approval step reads must be what a
 * shell would run, or a command could pass the check as one thing and mean another.
 */
function shWords(line: string): string[] {
  const script = `set -- ${line}; for word in "$@"; do printf '[%s]\\n' "$word"; done`;
  const out = execFileSync('sh', ['-c', script], { encoding: 'utf8' });

  return out
    .split('\n')
    .filter(Boolean)
    .map((word) => word.slice(1, -1));
}

const oursFor = (line: string): string[] | undefined => {
  const parsed = parseCommand(line);

  return parsed.ok && parsed.steps.length === 1 ? [...(parsed.steps[0]?.argv ?? [])] : undefined;
};

// Plain words, quotes and backslashes: nothing a shell would expand, so `sh` and the parser must
// agree on every word.
const AGREED = [
  String.raw`a "b c" d`,
  String.raw`a 'b c' d`,
  String.raw`a "x\|y"`,
  String.raw`a "x\.y"`,
  String.raw`a "x\\y"`,
  String.raw`a "x\$y"`,
  String.raw`a "x\"y"`,
  'a "x\\`y"',
  String.raw`a "x\ty"`,
  String.raw`a "x\'y"`,
  String.raw`a 'x\y'`,
  String.raw`a "" b`,
  String.raw`a '' b`,
  String.raw`a "p""q"`,
  String.raw`a "p"'q'r`,
  String.raw`a -n "x y" --flag="v w"`,
  String.raw`a "\\\|"`,
  String.raw`grep -rnE "a\|b" src`,
];

describe('parseCommand against a real sh', () => {
  it.each(AGREED)('gives a program the same words as sh does for %s', (line) => {
    expect(oursFor(line)).toEqual(shWords(line));
  });
});
