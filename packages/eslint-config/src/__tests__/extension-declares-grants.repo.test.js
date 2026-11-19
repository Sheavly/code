import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRuleLinter } from '../testing/coding-rule.fake.js';
import {
  describeRuleIsOnInExtensions,
  messagesOfText,
  REPO_ROOT,
  violationsInExtensions,
} from '../testing/extension-rule.fake.js';
import { readRunServiceGrants, RUN_SERVICE_GRANTS_FILE } from '../run-service-grants.utils.js';
import { readRunServices } from '../run-service-types.utils.js';

const RULE = 'harness/extension-declares-grants';

/**
 * The mapping as plain objects, counted from the file's text by indentation (the file is
 * formatted by Prettier) and not by the reader under test. The reader cannot import the table
 * (`@sheavly/extension` is no dependency of this package and the rule only parses it), and this
 * count shares none of its code.
 */
function mappingFromText(text) {
  const table = {};
  let members;
  let entry;

  for (const line of text.split('\n')) {
    const service = /^ {2}'?([\w-]+)'?: \{$/.exec(line);
    const plain = /^ {4}'?(\w+)'?: '([^']+)',$/.exec(line);
    const object = /^ {4}'?(\w+)'?: \{$/.exec(line);
    const grant = /^ {6}grant: '([^']+)',$/.exec(line);
    const argument = /^ {8}(\w+): '([^']+)',$/.exec(line);

    if (service) table[service[1]] = members = {};
    else if (plain) members[plain[1]] = { grant: plain[2], arguments: {} };
    else if (object) entry = members[object[1]] = { grant: undefined, arguments: {} };
    else if (grant) entry.grant = grant[1];
    else if (argument) entry.arguments[argument[1]] = argument[2];
  }

  return table;
}

/** The reader's map as the same plain objects. */
function plainMapping(grants) {
  return Object.fromEntries(
    [...grants].map(([service, members]) => [
      service,
      Object.fromEntries(
        [...members].map(([member, { grant, arguments: byArgument }]) => [
          member,
          { grant, arguments: Object.fromEntries(byArgument) },
        ]),
      ),
    ]),
  );
}

describe('the mapping and keys of this repo', () => {
  it('read every service, every member, every grant and every argument the file declares', () => {
    const text = readFileSync(path.join(REPO_ROOT, RUN_SERVICE_GRANTS_FILE), 'utf8');
    const expected = mappingFromText(text);
    const { state, grants } = readRunServiceGrants(REPO_ROOT);
    const members = Object.values(expected).flatMap((service) => Object.keys(service));

    expect(state).toBe('read');
    // A count that is wrong in the same way as the reader would still pass: pin it is not tiny.
    expect(Object.keys(expected).length).toBeGreaterThanOrEqual(8);
    expect(members.length).toBeGreaterThanOrEqual(30);
    expect(plainMapping(grants)).toEqual(expected);
  });

  it('are read from the extension package', () => {
    const { grants } = readRunServiceGrants(REPO_ROOT);
    const { keys } = readRunServices(REPO_ROOT);

    expect(grants.size).toBeGreaterThan(0);
    expect(grants.get('session-info')?.get('list')).toEqual({
      grant: 'session:read',
      arguments: new Map(),
    });
    expect(grants.get('approvals')?.get('request')?.arguments.get('tool')).toBe('approval:as-tool');
    expect(keys.get('SESSION_INFO')).toEqual({ name: 'session-info', type: 'SessionInfoView' });
  });
});

describe('the extensions of this repo', () => {
  // A parser without a project: the rule is syntax only, so the check stays cheap.
  const eslint = repoRuleLinter(RULE);

  it('declare the grant of every scoped call they make', async () => {
    expect(await violationsInExtensions({ eslint, rule: RULE })).toEqual([]);
  });

  it('fail a call whose grant the extension does not declare', async () => {
    const messages = await messagesOfText({
      eslint,
      code: `import { BACKGROUND_TASKS } from '@sheavly/extension/run-services/run-services.utils';
export const a = (services) => services.get(BACKGROUND_TASKS).list();`,
      file: 'extensions/coding/src/extension/not-listed.helper.ts',
    });

    expect(messages.map((message) => message.ruleId)).toEqual([RULE]);
    expect(messages[0]?.message).toContain('`task:read`');
    expect(messages[0]?.message).toContain('extensions/coding/sheavly.json');
  });
});

describeRuleIsOnInExtensions(RULE);
