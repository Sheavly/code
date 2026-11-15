// What the rules say about themselves has to match the repo: every rule is documented, and every
// file a message tells a reader to open exists.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const RULES_DOC = readFileSync(
  path.join(REPO_ROOT, 'packages/eslint-config/docs/rules.md'),
  'utf8',
);
/** A repo-relative file path in a message: folders, then a file with an extension we ship. */
const PATH_IN_MESSAGE = /(?<![\w@./<-])\.?[\w-][\w.-]*(?:\/[\w.-]+)+\.(?:js|mjs|ts|tsx|md|json)\b/g;

/** Every `[rule, path]` pair a rule's messages name. */
function pathsNamedBy(params) {
  const { name, rule } = params;
  const messages = Object.values(rule.meta?.messages ?? {});

  return messages.flatMap((message) =>
    (message.match(PATH_IN_MESSAGE) ?? []).map((file) => [name, file]),
  );
}

const named = Object.entries(harnessPlugin.rules).flatMap(([name, rule]) =>
  pathsNamedBy({ name, rule }),
);

/**
 * An entry opens with its rule IDs: a bullet or paragraph that starts with `harness/x`, or with a
 * bold label and then `(harness/x …)`. A passing mention inside another rule's text is not one.
 */
const ENTRY_START = /^(?:\s*- )?(?:\*\*[^*]+\*\*\s*\()?((?:`harness\/[a-z-]+`(?:,? and |, )?)+)/;
const PATH_IN_PROSE = /`([^`\s*]+\/[^`\s*]+\.(?:js|mjs|ts|tsx|md|json))`/g;
const PROSE_BASES = [
  path.join(REPO_ROOT, 'packages/eslint-config/docs'),
  path.join(REPO_ROOT, 'packages/eslint-config'),
  REPO_ROOT,
];

/** The rule IDs that have an entry in `markdown`. */
function documentedRules(markdown) {
  return markdown.split('\n').flatMap((line) => {
    const ids = ENTRY_START.exec(line)?.[1] ?? '';

    return [...ids.matchAll(/harness\/([a-z-]+)/g)].map((match) => match[1]);
  });
}

const existsFromAnyBase = (file) => PROSE_BASES.some((base) => existsSync(path.join(base, file)));

/** The paths `markdown` writes in backticks that exist under none of the bases. */
function missingPaths(markdown) {
  return [...markdown.matchAll(PATH_IN_PROSE)]
    .map((match) => match[1])
    .filter((file) => !existsFromAnyBase(file));
}

describe('docs/rules.md', () => {
  const documented = new Set(documentedRules(RULES_DOC));

  it.each(Object.keys(harnessPlugin.rules))('has its own entry for harness/%s', (name) => {
    expect(documented.has(name)).toBe(true);
  });

  it('does not count a passing mention as an entry', () => {
    const markdown = [
      '- **Other** (`harness/one`, `harness/two`): text',
      '- `harness/three` and `harness/four`: text',
      '  mentions `harness/five` in passing, and so does a line: `harness/six`',
      '  `harness/seven` starts a wrapped line of the entry above',
    ].join('\n');

    expect(documentedRules(markdown)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('points only at files that exist', () => {
    expect(missingPaths(RULES_DOC)).toEqual([]);
    expect(missingPaths('see `packages/nope/missing.md`')).toEqual(['packages/nope/missing.md']);
  });

  it('names only rules that exist', () => {
    // Rule IDs are written in backticks; `harness/agent/composition` in prose is not one.
    const named = [...RULES_DOC.matchAll(/`harness\/([a-z][a-z-]*[a-z])`/g)].map(
      (match) => match[1],
    );
    const known = new Set(Object.keys(harnessPlugin.rules));

    expect(named.filter((name) => !known.has(name))).toEqual([]);
  });
});

describe('rule messages', () => {
  it('name at least one path, so this check is not vacuous', () => {
    expect(named.length).toBeGreaterThan(0);
  });

  it.each(named)('harness/%s points at %s, which exists', (_name, file) => {
    expect(existsSync(path.join(REPO_ROOT, file))).toBe(true);
  });
});
