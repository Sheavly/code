import path from 'node:path';
import { afterAll } from 'vitest';
import { rmSync } from 'node:fs';
import { promptLocation } from '../rules/prompt-location.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const root = tempWorkspace({
  'package.json': { workspaces: ['packages/*'] },
  'packages/new/package.json': { name: '@sheavly/new', sheavly: { domain: 'generic' } },
  'packages/new/src/tool/tool.constants.ts': `
    export const TEXT = 'Explain what you found.';
    export const TABLE = { description: 'Read a document.', fields: { path: 'Document path.' } };
    export function build(params: { name: string }) { return 'Inspect ' + params.name; }
  `,
  'packages/new/src/tool/tool.prompt.ts': `
    export const TABLE = { description: 'Read a document.', path: 'Document path.' };
    export function render(params: { text: string }) { return 'Inspect ' + params.text; }
  `,
  'packages/new/src/tool/wrapper.utils.ts': `
    export function wrap(value: string) { return value.trim(); }
    export function build(value: string) { return 'Follow policy: ' + value; }
  `,
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const filename = path.join(root, 'packages/new/src/tool/tool.tool.ts');
const toolImport = "import { defineTool as define } from '@sheavly/core/tool/tool.utils';";
const harnessImport = "import { createHarness as create } from '@sheavly/host/host/host.helper';";
const tool = (description, schema = 'schema') =>
  `${toolImport} define({ name: 'read', description: ${description}, inputSchema: ${schema}, execute });`;
const instructions = (value) => `${harnessImport} create({ instructions: ${value} });`;
const invalid = (code, extra = {}) => ({
  code,
  filename,
  errors: [{ messageId: 'extract' }],
  ...extra,
});

const tester = typescriptRuleTester();

tester.run('prompt-location', promptLocation, {
  valid: [
    { code: tool('options.description'), filename },
    { code: tool('description'), filename },
    {
      code: tool(
        'TABLE.description',
        'z.object({ path: z.string().describe(TABLE.path) })',
      ).replace(
        toolImport,
        `${toolImport} import { TABLE } from './tool.prompt.js'; import { z } from 'zod';`,
      ),
      filename,
    },
    {
      code: instructions('render({ text: data })').replace(
        harnessImport,
        `${harnessImport} import { render } from './tool.prompt.js';`,
      ),
      filename,
    },
    { code: instructions("[options.instructions, userText].join('\\n')"), filename },
    {
      code: `${harnessImport} function forward({ ...rest }) { return rest; } create(forward(request));`,
      filename,
    },
    {
      code: `${harnessImport} function forward({ instructions, ...rest }) { return rest; } create(forward(request));`,
      filename,
    },
    {
      code: `${harnessImport} function forward({ nested: { value }, ...rest }) { return rest; } create(forward(request));`,
      filename,
    },
    {
      code: `${harnessImport} function forward({ ...rest } = {}) { return rest; } create(forward());`,
      filename,
    },
    {
      code: `${harnessImport} create({ messages: [{ role: 'user', content: userText, at: 1 }], title: 'Human title' });`,
      filename,
    },
    {
      code: "const view = { role: 'user', content: 'Human UI text', description: 'Human UI description' };",
      filename,
    },
    {
      code: "import { z } from 'zod'; const form = z.object({ name: z.string().describe('Your name') });",
      filename,
    },
    {
      code: "function defineTool(x: unknown) {} defineTool({ description: 'Not the imported Tool API' });",
      filename,
    },
    { code: tool("'Fixture'"), filename: filename.replace('.tool.ts', '.tool.test.ts') },
    { code: tool("'Fixture'"), filename: path.join(root, 'packages/new/src/testing/tool.fake.ts') },
    // A workspace of fakes (`packages/testing`) has no `testing/` folder below its `src/`.
    { code: tool("'Fixture'"), filename: path.join(root, 'packages/new/src/tool/tool.fake.ts') },
    {
      code: "export const text = 'Instructions';",
      filename: filename.replace('.tool.ts', '.prompt.ts'),
    },
    {
      code: `${toolImport} const human = z.string().describe('Human field'); define({ description: callerText, inputSchema: z.object({ path: z.string() }) });`,
      filename,
    },
    {
      code: `${toolImport} function make(description: string) { return define({ description, inputSchema: schema }); }`,
      filename,
    },
    {
      code: `${harnessImport} create({ messages: [{ role: 'user', content: data }], metadata: { role: 'system', title: 'Metadata' } });`,
      filename,
    },
  ],
  invalid: [
    invalid(
      tool('text.TABLE.description').replace(
        toolImport,
        `${toolImport} import * as text from './tool.constants.js';`,
      ),
    ),
    invalid(
      instructions(
        "[{ id: 'details', guidance: 'Apply policy' }].map(({ guidance }) => guidance).join('\\n')",
      ),
    ),
    invalid(
      "import { appendInstructionContext as append } from '@sheavly/workspace/instruction-context/instruction-context.helper'; const text = 'Apply policy'; append({ context, name: 'metadata', instructions: text });",
    ),
    invalid(
      instructions('build()').replace(
        harnessImport,
        `${harnessImport} function build(text = 'Apply policy') { return text; }`,
      ),
    ),
    invalid(tool("'Read a document.'")),
    invalid(
      `${toolImport} const alias = define; const text = 'Read a document.'; alias({ description: text, inputSchema: schema });`,
    ),
    invalid(
      tool('TEXT').replace(toolImport, `${toolImport} import { TEXT } from './tool.constants.js';`),
    ),
    invalid(
      tool('TABLE.description').replace(
        toolImport,
        `${toolImport} import { TABLE } from '@sheavly/new/tool/tool.constants';`,
      ),
    ),
    invalid(
      tool('description').replace(
        toolImport,
        `${toolImport} import { TABLE } from './tool.constants.js'; const { description } = TABLE;`,
      ),
    ),
    invalid(tool('`Read ${options.name}`')),
    invalid(tool("['Read ', options.name].join('')")),
    invalid(
      tool("wrap('Read a document.')").replace(
        toolImport,
        `${toolImport} import { wrap } from './wrapper.utils.js';`,
      ),
    ),
    invalid(
      tool('build(data)').replace(
        toolImport,
        `${toolImport} import { build } from './wrapper.utils.js';`,
      ),
    ),
    invalid(
      tool('build({ name: data })').replace(
        toolImport,
        `${toolImport} import { build } from './tool.constants.js';`,
      ),
    ),
    invalid(
      `${toolImport} function build(data: string) { return 'Read ' + data; } define({ description: build(data), inputSchema: schema });`,
    ),
    invalid(tool('callerText', "z.object({ path: z.string().describe('Document path.') })")),
    invalid(
      tool('callerText', 'input').replace(
        toolImport,
        `${toolImport} import { z } from 'zod'; const pathField = z.string().describe('Document path.'); const input = z.object({ path: pathField });`,
      ),
    ),
    invalid(
      tool('callerText', 'input').replace(
        toolImport,
        `${toolImport} import { z } from 'zod'; import { TABLE } from './tool.constants.js'; const input = z.object({ path: z.string().describe(TABLE.fields.path) });`,
      ),
    ),
    invalid(instructions("'Apply the policy.'")),
    // Found by the derived list (prompt-apis.test.js), which the hand-written one had missed.
    invalid(
      "import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool'; createSubAgentTool({ baseInstructions: 'Be careful.' });",
    ),
    invalid(
      `${harnessImport} function pick({ instructions, ...rest }) { return instructions; } create({ instructions: pick({ instructions: 'Apply policy', title: callerTitle }) });`,
    ),
    invalid(
      `${harnessImport} function pick({ 'instructions': text, ...rest }) { return text; } create({ instructions: pick({ instructions: 'Apply policy' }) });`,
    ),
    invalid(
      `${harnessImport} function pick({ ['instructions']: text, ...rest }) { return text; } create({ instructions: pick({ instructions: 'Apply policy' }) });`,
    ),
    invalid(
      `${harnessImport} const options = { baseInstructions: 'Apply the policy.' }; create(options);`,
    ),
    invalid(
      `${harnessImport} create({ messages: [{ role: 'user', content: 'Continue with the plan.', at: 1 }] });`,
    ),
    invalid(
      `${harnessImport} const text = 'Apply policy'; const message = { role: 'system', content: text }; create({ messages: [message] });`,
    ),
    invalid(
      `${harnessImport} create({ messages: [{ role: 'user', content: 'Task: ' + userData }] });`,
    ),
    invalid(
      `import * as tools from '@sheavly/core/tool/tool.utils'; tools.defineTool({ description: 'Read', inputSchema: schema });`,
    ),
    invalid(
      tool('text').replace(
        toolImport,
        `${toolImport} function choose(params: { text: string }) { return params.text; } const text = choose({ text: 'Read' });`,
      ),
    ),
    invalid(
      `import { z } from 'zod'; const guidance = z.string().describe('State your intent.'); export function withDescription(schema: z.ZodObject) { return z.object({ description: guidance }).extend(schema.shape); }`,
      { filename: path.join(root, 'packages/new/src/tool/tool.validator.ts') },
    ),
  ],
});
