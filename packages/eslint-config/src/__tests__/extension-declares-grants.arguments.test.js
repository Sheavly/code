// A call whose entry names argument grants: `approvals.request` needs `approval:request`, and
// `approval:as-tool` / `approval:keep` when its object literal argument uses those properties.
import { harnessPlugin } from '../plugin.js';
import { grantCase, KEYS, missing } from '../testing/grant-calls.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const rule = harnessPlugin.rules['extension-declares-grants'];
const tester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

const BASE = 'approval:request';
const callWith = (argument) => `import { APPROVALS } from '${KEYS}';
declare const params: { command: string };
declare const base: { command: string };
declare const tool: string;
declare const name: string;
export const a = (services) => services.get(APPROVALS).request(${argument});`;

const request = (argument, grants) => grantCase({ code: callWith(argument), grants });
const rejected = (argument, grants, errors) => ({ ...request(argument, grants), errors });

tester.run('extension-declares-grants: argument grants', rule, {
  valid: [
    request("{ command: 'x' }", [BASE]),
    request('', [BASE]),
    request("{ command: 'x', tool: 'x' }", [BASE, 'approval:as-tool']),
    request("{ tool: 'x', options: [], keeps: [] }", [BASE, 'approval:as-tool', 'approval:keep']),
    request("{ 'tool': 'x' }", [BASE, 'approval:as-tool']),
    request('{ tool }', [BASE, 'approval:as-tool']),
    // A property whose literal value is undefined is not used.
    request("{ command: 'x', tool: undefined }", [BASE]),
    // Without an object literal, or with a spread or computed key, only the base grant is checked.
    request('params', [BASE]),
    request("{ ...base, tool: 'x' }", [BASE]),
    request('{ ...base }', [BASE]),
    request("{ [name]: 'x' }", [BASE]),
    request("{ tool: 'x', ...base }", [BASE]),
    // Grants in any order.
    request("{ tool: 'x', keeps: [] }", ['approval:keep', 'approval:as-tool', BASE]),
  ],
  invalid: [
    rejected("{ command: 'x' }", [], [missing('approvals.request', BASE)]),
    rejected('params', [], [missing('approvals.request', BASE)]),
    rejected(
      "{ command: 'x', tool: 'x' }",
      [BASE],
      [missing('approvals.request({ tool })', 'approval:as-tool')],
    ),
    rejected(
      "{ tool: 'x' }",
      [],
      [
        missing('approvals.request', BASE),
        missing('approvals.request({ tool })', 'approval:as-tool'),
      ],
    ),
    rejected(
      '{ options: [] }',
      [BASE],
      [missing('approvals.request({ options })', 'approval:keep')],
    ),
    rejected('{ keeps: [] }', [BASE], [missing('approvals.request({ keeps })', 'approval:keep')]),
    // Two properties for one grant report it once.
    rejected(
      '{ options: [], keeps: [] }',
      [BASE],
      [missing('approvals.request({ options })', 'approval:keep')],
    ),
    rejected(
      "{ 'tool': 'x' }",
      [BASE],
      [missing('approvals.request({ tool })', 'approval:as-tool')],
    ),
    rejected('{ tool }', [BASE], [missing('approvals.request({ tool })', 'approval:as-tool')]),
  ],
});
