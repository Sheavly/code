import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll } from 'vitest';
import { promptLocation } from '../rules/prompt-location.js';
import * as ruleTesting from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const root = tempWorkspace({
  'package.json': { workspaces: ['packages/*'] },
  'packages/new/package.json': { name: '@sheavly/new', sheavly: { domain: 'generic' } },
  'packages/new/tsconfig.json': {
    compilerOptions: {
      strict: true,
      target: 'ESNext',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
    },
    include: ['src/**/*.ts'],
  },
  'packages/new/src/message/message.types.ts':
    "export type Message = { role: 'user' | 'system'; content: string };",
  'packages/new/src/model/model.types.ts': `
    import type { Message } from '../message/message.types.js';
    export type Request = { instructions?: string; messages: Message[]; tools: unknown[] };
    export type Tool = { name: string; description: string; inputSchema: unknown; execute: unknown };
  `,
  'packages/new/src/model/model.helper.ts': '',
  'packages/new/src/hook/hook.types.ts':
    'export type Context = { messages: unknown[]; addContext: (content: string) => void; addInstructions: (content: string) => void };',
  'packages/new/src/conversation/conversation.types.ts':
    'export type Conversation = { send: (text: string) => void; followup: (text: string) => void };',
  'packages/new/src/provider/provider.types.ts':
    "import type { Request } from '../model/model.types.js'; export type Provider = { stream(request: Request): void };",
  'packages/new/src/sections/sections.types.ts':
    'export type ModelSection = { id: string; title: string; guidance: string };',
  'packages/new/src/model/model.constants.ts': "export const TEXT = 'Follow the policy.';",
  'packages/new/src/model/model.prompt.ts': "export const TEXT = 'Follow the policy.';",
  'packages/new/src/history/history.types.ts':
    "export type HistoryMessage = { role: 'user' | 'system'; content: string; at: number };",
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const filename = path.join(root, 'packages/new/src/model/model.helper.ts');
const imports =
  "import type { Message } from '../message/message.types.js'; import type { Request, Tool } from './model.types.js';";
const tester = ruleTesting.typescriptRuleTester({
  parserOptions: { project: path.join(root, 'packages/new/tsconfig.json'), tsconfigRootDir: root },
});

tester.run('prompt-location typed routing', promptLocation, {
  valid: [
    {
      code: "import type { Context } from '../hook/hook.types.js'; declare const context: Context; declare const data: string; const { addContext: add } = context; add(data); context.addInstructions(data);",
      filename,
    },
    {
      code: "import type { Conversation } from '../conversation/conversation.types.js'; import { TEXT } from './model.prompt.js'; declare const conversation: Conversation; conversation.send(TEXT);",
      filename,
    },
    {
      code: "declare const ui: { send(text: string): void; stream(text: string): void; addContext(text: string): void }; ui.send('Human text'); ui.stream('Human stream'); ui.addContext('UI text');",
      filename,
    },
    {
      code: "import type { ModelSection } from '../sections/sections.types.js'; import { TEXT } from './model.prompt.js'; const section: ModelSection = { id: 'details', title: TEXT, guidance: TEXT };",
      filename,
    },
    {
      code: "type HumanSection = { id: string; title: string; guidance: string }; const section: HumanSection = { id: 'ui', title: 'Help', guidance: 'Fill out the form' };",
      filename,
    },
    {
      code: `${imports} function route(content: string) { const message: Message = { role: 'user', content }; return message; }`,
      filename,
    },
    {
      code: `${imports} function route(instructions: string) { const request: Request = { instructions, messages: [], tools: [] }; return request; }`,
      filename,
    },
    {
      code: "type View = { role: 'user'; content: string }; const view: View = { role: 'user', content: 'Human content' };",
      filename,
    },
    {
      code: "type Form = { instructions: string; title: string }; const form: Form = { instructions: 'Human UI help', title: 'Help' };",
      filename,
    },
  ],
  invalid: [
    {
      code: "import type { Context } from '../hook/hook.types.js'; declare const context: Context; const { addContext: add } = context; add('Follow policy');",
      filename,
      errors: [{ messageId: 'extract' }],
    },
    {
      code: "import type { Context } from '../hook/hook.types.js'; import { TEXT } from './model.constants.js'; declare const context: Context; context.addInstructions(TEXT);",
      filename,
      errors: [{ messageId: 'extract' }],
    },
    {
      code: "import type { Conversation } from '../conversation/conversation.types.js'; import { TEXT } from './model.constants.js'; declare const conversation: Conversation; conversation.send(TEXT);",
      filename,
      errors: [{ messageId: 'extract' }],
    },
    {
      code: "import type { Provider } from '../provider/provider.types.js'; import { TEXT } from './model.constants.js'; declare const provider: Provider; const options = { messages: [{ role: 'user' as const, content: TEXT }], tools: [] }; provider.stream(options);",
      filename,
      errors: [{ messageId: 'extract' }],
    },
    {
      code: "import type { ModelSection } from '../sections/sections.types.js'; import { TEXT } from './model.constants.js'; const section: ModelSection = { id: 'details', title: 'Details', guidance: TEXT };",
      filename,
      errors: [{ messageId: 'extract' }, { messageId: 'extract' }],
    },
    {
      code: "import type { HistoryMessage } from '../history/history.types.js'; const message: HistoryMessage = { role: 'user', content: 'Resume task', at: 1 };",
      filename,
      errors: [{ messageId: 'extract' }],
    },
    {
      code: `${imports} const message: Message = { role: 'system', content: 'Follow the policy.' };`,
      filename,
      errors: [{ messageId: 'extract' }],
    },
    {
      code: `${imports} const request: Request = { instructions: 'Follow the policy.', messages: [], tools: [] };`,
      filename,
      errors: [{ messageId: 'extract' }],
    },
    {
      code: `${imports} declare const provider: { stream(request: Request): void }; provider.stream({ instructions: 'Follow policy.', messages: [], tools: [] });`,
      filename,
      errors: [{ messageId: 'extract' }],
    },
    {
      code: `${imports} declare const provider: { stream(request: Request): void }; provider.stream({ messages: [{ role: 'user', content: 'Continue.' }], tools: [] });`,
      filename,
      errors: [{ messageId: 'extract' }],
    },
    {
      code: `${imports} const tool: Tool = { name: 'read', description: 'Read a document.', inputSchema: {}, execute: undefined };`,
      filename,
      errors: [{ messageId: 'extract' }],
    },
  ],
});
