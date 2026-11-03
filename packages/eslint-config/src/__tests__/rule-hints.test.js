// A hint for a rule that is off is never shown, so it only misleads whoever reads the list.
import path from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';
import { RULE_HINTS } from '../rule-hints.js';

const WORKSPACE = path.resolve(import.meta.dirname, '../../../loop');
/** A helper module in a folder no workspace special-cases: every source rule applies to it. */
const PROBE = path.join(WORKSPACE, 'src/zz-probe/zz-probe.helper.ts');

const isOn = (entry) => ![0, 'off'].includes(Array.isArray(entry) ? entry[0] : entry);

it('names only rules a workspace source file is checked with', async () => {
  const config = await new ESLint({ cwd: WORKSPACE }).calculateConfigForFile(PROBE);
  const enabled = new Set(
    Object.entries(config?.rules ?? {})
      .filter(([, entry]) => isOn(entry))
      .map(([rule]) => rule),
  );
  const stale = Object.keys(RULE_HINTS).filter((rule) => !enabled.has(rule));

  expect(stale).toEqual([]);
});
