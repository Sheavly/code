// A hint for a rule that is off is never shown, so it only misleads whoever reads the list.
import path from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';
import { RULE_HINTS } from '../rule-hints.js';

const WORKSPACE = path.resolve(import.meta.dirname, '../../../loop');
/**
 * Source files in a folder no workspace special-cases, one of each kind whose rules differ: a
 * helper has no line cap and a service has one, so a rule is live if either is checked with it.
 */
const PROBES = ['helper', 'service'].map((kind) =>
  path.join(WORKSPACE, `src/zz-probe/zz-probe.${kind}.ts`),
);

const isOn = (entry) => ![0, 'off'].includes(Array.isArray(entry) ? entry[0] : entry);

/** The rules that are on for `file`. */
async function rulesOn(file) {
  const config = await new ESLint({ cwd: WORKSPACE }).calculateConfigForFile(file);

  return Object.entries(config?.rules ?? {})
    .filter(([, entry]) => isOn(entry))
    .map(([rule]) => rule);
}

it('names only rules a workspace source file is checked with', async () => {
  const enabled = new Set((await Promise.all(PROBES.map(rulesOn))).flat());
  const stale = Object.keys(RULE_HINTS).filter((rule) => !enabled.has(rule));

  expect(stale).toEqual([]);
});
