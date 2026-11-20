import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../../vitest.config.ts';
import { REPO_ROOT } from './temp-repo.utils.mjs';

const WHAT_TO_DO =
  "the gate's parallelism is uncapped: restore the cap and read 'How much of the machine the gate uses' in .agents/skills/sheavly/quality-gate.md";

/** What turbo accepts for `concurrency`: an integer from 1 or a percentage (`50%`), as a string. */
const CAP_STRING = /^[1-9]\d*%?$/;

function readTurboConfig() {
  const file = path.join(REPO_ROOT, 'turbo.json');
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));

  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));

  return config;
}

/** The config vitest builds for a mode: the file exports a function of vitest's env argument. */
function vitestConfigFor(mode) {
  return vitestConfig({ mode, command: 'serve' });
}

function isCap(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1;

  return typeof value === 'string' && CAP_STRING.test(value);
}

describe('the gate caps how much of the machine it uses', () => {
  it("caps turbo's concurrent tasks with a count or a percentage", () => {
    const { concurrency } = readTurboConfig();

    expect(typeof concurrency === 'string' && CAP_STRING.test(concurrency), WHAT_TO_DO).toBe(true);
  });

  it("caps vitest's workers per test run", () => {
    expect(isCap(vitestConfigFor('test').test.maxWorkers), WHAT_TO_DO).toBe(true);
  });

  it('keeps the worker cap for the watcher over every workspace', () => {
    expect(isCap(vitestConfigFor('all').test.maxWorkers), WHAT_TO_DO).toBe(true);
  });
});
