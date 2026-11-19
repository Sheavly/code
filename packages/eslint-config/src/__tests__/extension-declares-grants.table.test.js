// The rule over the REAL mapping and keys of this repo: for every service in the mapping, a call of
// a method per distinct grant is reported without the grant and accepted with it.
import { describe, expect, it } from 'vitest';
import { readRunServiceGrants } from '../run-service-grants.utils.js';
import { harnessPlugin } from '../plugin.js';
import { REPO_ROOT } from '../testing/extension-rule.fake.js';
import { grantCase, KEYS, missing } from '../testing/grant-calls.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { readRunServices } from '../run-service-types.utils.js';

const rule = harnessPlugin.rules['extension-declares-grants'];
const tester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

const { grants } = readRunServiceGrants(REPO_ROOT);
const { keys } = readRunServices(REPO_ROOT);
const keyOf = (service) => [...keys].find(([, { name }]) => name === service)?.[0];

/** One sample per (service, distinct grant): the first method that needs it. */
const samples = [...grants].flatMap(([service, members]) => {
  const seen = new Map();

  for (const [method, entry] of members) {
    if (!seen.has(entry.grant)) seen.set(entry.grant, method);
  }

  return [...seen].map(([grant, method]) => ({ service, grant, method, key: keyOf(service) }));
});

// The scope is read once and called later, as a tool's `execute` or a hook handler would.
const codeFor = ({ key, method }) => `import { ${key} } from '${KEYS}';
export const activate = (services) => {
  const scope = services.get(${key});

  return { execute: async () => scope.${method}() };
};`;

tester.run('extension-declares-grants: every service of the real mapping', rule, {
  valid: samples.map((sample) =>
    grantCase({ code: codeFor(sample), grants: ['unrelated:grant', sample.grant] }),
  ),
  invalid: samples.map((sample) =>
    grantCase({
      code: codeFor(sample),
      grants: ['unrelated:grant'],
      errors: [missing(`${sample.service}.${sample.method}`, sample.grant)],
    }),
  ),
});

describe('the real mapping', () => {
  it('names only services that have a key, so no sample above is skipped', () => {
    expect(grants.size).toBeGreaterThan(0);
    expect([...grants.keys()].filter((service) => keyOf(service) === undefined)).toEqual([]);
  });

  it('has a sample for each distinct grant of a service with several', () => {
    const grantsOf = (service) =>
      samples.filter((sample) => sample.service === service).map((sample) => sample.grant);

    expect(grantsOf('background-tasks').length).toBeGreaterThan(1);
    expect(grantsOf('child-sessions').length).toBeGreaterThan(1);
    expect(grantsOf('approvals')).toEqual(['approval:request']);
  });
});
