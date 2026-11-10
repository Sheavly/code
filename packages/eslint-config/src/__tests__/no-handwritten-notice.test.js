import { harnessPlugin } from '../plugin.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

// A notice envelope is written by the core formatter only: code that builds one by hand skips its
// origin line, its handling policy and the escaping of what it inserts.
const ruleTester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

const reports = (code) => ({ code, errors: [{ messageId: 'm0' }] });

ruleTester.run('no-handwritten-notice', harnessPlugin.rules['no-handwritten-notice'], {
  valid: [
    // Going through the formatter is the way.
    "import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils'; formatHarnessNotice(notice);",
    // Other tags and plain text are not the envelope.
    "const tag = '<earlier-work-summary>';",
    "const text = 'a harness notice, not an envelope';",
    'const html = `<div>${x}</div>`;',
    // Known limit, stated in the rule: a tag split inside a word is not seen.
    "const text = '<harn' + 'ess-notice>';",
  ],
  invalid: [
    reports('const text = \'<harness-notice kind="agent-report">\';'),
    reports('const text = "<harness-notice>";'),
    reports('const text = `<harness-notice kind="task-finished">\\n${output}`;'),
    reports("const text = ['<harness-notice kind=\"x\">', body].join('\\n');"),
    // The closing tag, a different case, and a tag split across strings or template pieces.
    reports("const text = '</harness-notice>';"),
    reports("const text = '<HARNESS-NOTICE>';"),
    reports("const text = '<harness' + '-notice>';"),
    reports("const text = '<' + 'harness-notice>';"),
    reports('const text = `<harness-${name}>`;'),
    reports('const text = `<${"harness-notice"}>`;'),
    reports('const text = "\\x3charness-notice>";'),
    // The bare name is flagged too, even as a path or label: a deliberate trade for simplicity.
    reports("const label = 'harness-notice';"),
  ],
});
