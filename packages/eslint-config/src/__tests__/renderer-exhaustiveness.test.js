import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const terminal = path.resolve(import.meta.dirname, '../../../../apps/terminal');
const file = path.join(terminal, 'src/render/render.service.ts');
const source = fs.readFileSync(file, 'utf8');
const eslint = new ESLint({ cwd: terminal });
const RULE = '@typescript-eslint/switch-exhaustiveness-check';

/** The rule's messages for the Renderer's source after `change`. */
async function exhaustivenessErrors(change) {
  const [result] = await eslint.lintText(change(source), { filePath: file });

  return result.messages.filter((message) => message.ruleId === RULE);
}

describe('the Renderer handles every event and session update kind', () => {
  it('passes as written', async () => {
    expect(await exhaustivenessErrors((text) => text)).toEqual([]);
  });

  it.each([
    ['an event', "      case 'usage':\n"],
    ['a session update', "      case 'session_released':\n"],
  ])('fails when %s kind is left out of its switch', async (_name, line) => {
    expect(source).toContain(line);

    const errors = await exhaustivenessErrors((text) => text.replace(line, ''));

    expect(errors).toHaveLength(1);
  });
});
