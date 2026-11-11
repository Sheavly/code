import { expect, it } from 'vitest';
import { DEFAULT_PROMPT } from '../demo.prompt.js';

it('keeps the demo fallback question unchanged without starting the CLI', () => {
  expect(DEFAULT_PROMPT).toBe('Read package.json and tell me the project name.');
});
