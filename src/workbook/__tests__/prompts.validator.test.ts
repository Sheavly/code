import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePromptFile } from '../workbook.validator.js';

// A stored prompt's check runs when the branch touches one of its `areas`. An area that no longer
// exists (its code moved to a package) matches nothing, so the check would silently stop running.
const ROOT = path.resolve(import.meta.dirname, '../../..');
const PROMPTS = path.join(ROOT, 'workbook/prompts');

const checks = readdirSync(PROMPTS)
  .filter((file) => file.endsWith('.md'))
  .map((file) => {
    const name = path.basename(file, '.md');

    return parsePromptFile({ name, source: readFileSync(path.join(PROMPTS, file), 'utf8') });
  })
  .flatMap(({ name, check }) => (check ? [{ name, areas: check.areas }] : []));

describe('the stored checks', () => {
  it('exist', () => {
    expect(checks.length).toBeGreaterThan(0);
  });

  it.each(checks)(
    '$name names only areas that exist, so it still runs when they change',
    ({ areas }) => {
      expect(areas.filter((area) => !existsSync(path.join(ROOT, area)))).toEqual([]);
    },
  );
});
