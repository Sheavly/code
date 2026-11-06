import path from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const terminal = path.resolve(import.meta.dirname, '../../../../apps/terminal');
const eslint = new ESLint({ cwd: terminal });

it.each([
  ['src/react-screen/activity.component.tsx', true],
  ['src/react-screen/activity.helper.ts', true],
  ['src/react-screen/__tests__/activity.component.test.tsx', true],
  ['src/react-screen/__tests__/activity.helper.test.ts', false],
  ['src/testing/clock.fake.ts', false],
])('scopes React hook rules correctly for %s', async (file, enabled) => {
  const { rules } = await eslint.calculateConfigForFile(path.join(terminal, file));

  for (const name of ['react-hooks/rules-of-hooks', 'react-hooks/exhaustive-deps']) {
    expect(rules[name]?.[0] === 2).toBe(enabled);
  }
});
