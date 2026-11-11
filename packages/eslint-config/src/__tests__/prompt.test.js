import { describe, expect, it } from 'vitest';
import { extensionsOf, FILE_KIND_POLICIES, kindOfFile } from '../file-kinds.js';
import { harnessPlugin } from '../plugin.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const tester = typescriptRuleTester();
const filename = 'src/prompt/base.prompt.ts';
const valid = (code) => ({ code, filename });
const invalid = (code, messageId = 'invalidPromptExport') => ({
  code,
  filename,
  errors: [{ messageId }],
});

describe('prompt policy', () => {
  it('is a first-class TypeScript-only kind with a 300 LOC cap and no classes', () => {
    expect(kindOfFile(filename)).toBe('prompt');
    expect(kindOfFile('src/prompt/base.prompt.tsx')).toBeNull();
    expect(extensionsOf('prompt')).toEqual(['ts']);
    expect(FILE_KIND_POLICIES.prompt).toEqual({
      exports: 'prompt',
      maxLines: 300,
      classes: 'forbidden',
    });
  });
});

tester.run('prompt filenames', harnessPlugin.rules['file-kind'], {
  valid: [valid('')],
  invalid: [
    { code: '', filename: 'src/prompt/base.prompt.tsx', errors: [{ messageId: 'badName' }] },
  ],
});

tester.run('prompt named exports', harnessPlugin.rules['no-default-export'], {
  valid: [valid("export const PROMPT = 'Be helpful.';")],
  invalid: [
    { code: "export default 'Be helpful.';", filename, errors: 1 },
    { code: 'export default function render(): string { return "text"; }', filename, errors: 1 },
  ],
});

tester.run('prompt export shapes', harnessPlugin.rules['kind-contents'], {
  valid: [
    valid("export const PROMPT = 'Be helpful.';"),
    valid('export const PROMPT = `Be helpful.\nStay focused.`;'),
    valid("const INTRO = 'Be helpful.'; export const PROMPT = `${INTRO} Stay focused.`;"),
    valid("export const INTRO = 'Be helpful.'; export const PROMPT = INTRO + ' Stay focused.';"),
    valid(
      "const parts = ['Be helpful.', 'Stay focused.'] as const; export const PROMPT = parts.join('\\n');",
    ),
    valid(
      "import { MAX_TURNS } from './limits.constants.js'; export const PROMPT = 'Use at most ' + MAX_TURNS + ' turns.';",
    ),
    valid("export const FRAGMENTS = ['Be helpful.', 'Stay focused.'] as const;"),
    valid("const INTRO = 'Be helpful.'; export { INTRO as PROMPT };"),
    valid("export const PROMPT = INTRO; const INTRO = 'Be helpful.';"),
    valid(
      "import { MAX_TURNS } from './limits.constants.js'; export const PROMPT = `Use at most ${MAX_TURNS} turns.`;",
    ),
    valid(
      "import { MAX_TURNS as LIMIT } from './limits.constants.js'; export const SECTIONS = [{ id: 'limits', title: 'Limits', guidance: [`Use at most ${LIMIT} turns.`] }];",
    ),
    valid(
      "import * as limits from './limits.constants.js'; export const PROMPT = `Use at most ${limits.MAX_TURNS} turns.`;",
    ),
    valid(
      "import { MAX_TURNS } from './limits.constants.js'; const LIMIT = MAX_TURNS; export const PROMPT = `Use at most ${LIMIT - 1} turns.`;",
    ),
    valid(`import type { ModelSection } from './model.types.js';
      export const SECTIONS: ModelSection[] = [
        { id: 'identity', title: 'Identity', guidance: ['Be helpful.', 'Stay focused.'] },
        { id: 'safety', title: 'Safety', guidance: ['Respect authorization.'] },
      ];`),
    valid(
      "const safety = { id: 'safety', guidance: ['Respect authorization.'] }; export const DATA = { sections: [safety], title: 'Agent' } as const;",
    ),
    valid(`type Local = { name: string };
      function heading(name: string) { return '# ' + name; }
      export function render(params: Local): string { return heading(params.name); }`),
    valid('export const render = (params: { name: string }): string => `Hello ${params.name}`;'),
    valid('export const render = function (name: string): string { return name.trim(); };'),
    valid('function render(name: string): string { return name; } export { render };'),
    valid('export function render(name: string = "Agent"): string { return name; }'),
    valid(
      'export function fragments(parts: readonly string[]): string[] { return parts.map(part => part.trim()); }',
    ),
    valid(`import type { ModelSection } from './model.types.js';
      export function sections(title: string): ModelSection[] { return [{ id: 'intro', title, guidance: ['Be helpful.'] }]; }`),
  ],
  invalid: [
    invalid('export type Prompt = string;', 'typeInCode'),
    invalid('type Prompt = string; export { type Prompt };', 'typeInCode'),
    invalid('export interface Prompt { text: string }', 'typeInCode'),
    invalid('export class Prompt {}', 'promptDefinition'),
    invalid('class LocalPrompt {}', 'promptDefinition'),
    invalid(
      'export function render(): string { class LocalPrompt {} return "text"; }',
      'promptDefinition',
    ),
    invalid("import { z } from 'zod'; const localSchema = z.string();", 'promptDefinition'),
    invalid(
      "import { z } from 'zod'; export function render(): string { const localSchema = z.string(); return 'text'; }",
      'promptDefinition',
    ),
    invalid('class Prompt {} export { Prompt };', 'promptDefinition'),
    invalid('export const Prompt = class {};', 'promptDefinition'),
    invalid(
      "import { z } from 'zod'; export const promptSchema = z.object({ text: z.string() });",
      'promptDefinition',
    ),
    {
      code: "import { z } from 'zod'; const base = z.string(); const promptSchema = base.optional(); export { promptSchema };",
      filename,
      errors: [{ messageId: 'promptDefinition' }, { messageId: 'promptDefinition' }],
    },
    invalid('export const MAX_TOKENS = 1000;'),
    invalid("import { MAX_TOKENS } from './limits.constants.js'; export const LIMIT = MAX_TOKENS;"),
    invalid(
      "import { MAX_TOKENS } from './limits.constants.js'; export const DATA = { limit: MAX_TOKENS };",
    ),
    invalid(
      "import { MAX_TOKENS } from './limits.constants.js'; export const LIMIT = MAX_TOKENS + MAX_TOKENS;",
    ),
    invalid('export const DATA = { render: (): string => "text" };'),
    invalid('const LIMIT = 1000; export { LIMIT as MAX_TOKENS };'),
    invalid('export const MAX_TOKENS = 1000 * 2;'),
    invalid('export const RETRIES = { count: 3 };'),
    invalid('export const FLAGS = [true, false];'),
    invalid('export const MATCH = /prompt/;'),
    invalid('export enum Mode { Prompt }'),
    invalid('export const value = loadPrompt();'),
    invalid('export function count(): number { return 3; }'),
    invalid('export function render(name): string { return name; }'),
    invalid('export function render(name: string) { return name; }'),
    invalid('export async function render(): Promise<string> { return "text"; }'),
    invalid('export function* render(): Generator<string> { yield "text"; }'),
    invalid('const A = B; const B = A; export { A };'),
  ],
});

const effect = (code) => invalid(code, 'promptEffect');
const impureImport = (code) => invalid(code, 'promptImport');

tester.run('prompt purity', harnessPlugin.rules['pure-imports'], {
  valid: [
    valid(
      "import type { Stats } from 'node:fs'; import { type Provider } from './provider.adapter.js';",
    ),
    valid("import type { ModelSection } from './model.types.js';"),
    valid("import { type ModelSection } from './model.types.js';"),
    valid(
      "import { escape } from './escape.utils.js'; import { TEXT } from './text.constants.js';",
    ),
    valid("import { TEXT } from './base.prompt.js'; import path from 'node:path';"),
    valid('export function render(name: string): string { return name.trim().toUpperCase(); }'),
    valid(
      'export function render(params: { title: string }): string { const local = {}; Object.assign(local, params); return params.title; }',
    ),
    valid(
      'export function render(params: { title: string }): string { return Object.assign({}, params).title; }',
    ),
    valid(
      'export function render(sections: string[]): string { return sections.map(section => section.trim()).join("\\n"); }',
    ),
    valid(
      'export function render(sections: string[]): string { return sections.toSorted().join("\\n"); }',
    ),
    valid(
      'export function render(sections: string[]): string { const local = sections.slice(); local.sort(); return local.join("\\n"); }',
    ),
    valid(
      'export function render(sections: string[]): string { const local: string[] = []; for (const section of sections) { local.push(section); } return local.join("\\n"); }',
    ),
    valid(
      'export function render(sections: string[]): string { let text = ""; for (let i = 0; i < sections.length; i++) { text += sections[i]; } return text; }',
    ),
    valid(
      'export function render(name: string): string { const local = { title: "" }; local.title = name; return local.title; }',
    ),
    valid(
      'export function render(name: string): string { const process = { env: { name } }; return process.env.name; }',
    ),
    valid(
      'const TEXT = "Agent"; function heading(name: string) { return `# ${name}`; } export function render(): string { return heading(TEXT); }',
    ),
    // Existing pure-imports behavior remains import-only outside prompt files.
    { code: 'export function now() { return Math.random(); }', filename: 'src/x/x.utils.ts' },
  ],
  invalid: [
    impureImport("import { readFile } from 'node:fs/promises';"),
    impureImport("import { createInterface } from 'node:readline/promises';"),
    impureImport("import { spawn } from 'node:child_process';"),
    impureImport("import { env } from 'node:process';"),
    impureImport("import OpenAI from 'openai';"),
    impureImport("import { z } from 'zod';"),
    impureImport("import { promptSchema } from './prompt.validator.js';"),
    impureImport("import { generateText } from 'ai';"),
    impureImport("import { model } from './model.adapter.js';"),
    impureImport("import { render } from './render.helper.js';"),
    impureImport("import { state } from './state.service.js';"),
    impureImport("import '@some/register';"),
    invalid("import { ModelSection } from './model.types.js';", 'promptTypeImport'),
    effect('export function render(): string { return process.env.NAME ?? ""; }'),
    effect('export function render(): string { const env = process.env; return env.NAME ?? ""; }'),
    effect('export function render(): string { return globalThis.prompt; }'),
    effect('export function render(): string { return import.meta.env.NAME; }'),
    effect(
      'export function render(provider: Provider): string { provider.stream({}); return ""; }',
    ),
    effect(
      'export function render(params: { title: string }): string { Object.assign(params, { title: "new" }); return params.title; }',
    ),
    effect(
      'export function render(params: { title: string }): string { Reflect.set(params, "title", "new"); return params.title; }',
    ),
    effect('export function render(): string { console.log("side effect"); return ""; }'),
    effect('export function render(): string { fetch("https://example.com"); return ""; }'),
    effect('export function render(): string { return `${Math.random()}`; }'),
    effect(
      'export function render(client: Client): string { client.responses.create({}); return ""; }',
    ),
    effect(
      'export function render(client: Client): string { client.chat.completions.create({}); return ""; }',
    ),
    effect('export function render(): string { generateText({}); return ""; }'),
    effect('export function render(): string { setTimeout(() => {}, 1); return ""; }'),
    effect('let counter = 0;'),
    effect('registerPrompt();'),
    effect(
      'export function render(parts: string[]): string { parts.push("extra"); return parts.join("\\n"); }',
    ),
    effect(
      'export function render(parts: string[]): string { parts[0] = "extra"; return parts.join("\\n"); }',
    ),
    effect(
      'export function render(parts: string[]): string { const alias = parts; alias.sort(); return alias.join("\\n"); }',
    ),
    effect(
      'export function render(params: { title: string }): string { params.title = "new"; return params.title; }',
    ),
    effect(
      'export function render(params: { title?: string }): string { delete params.title; return ""; }',
    ),
    effect(
      'const parts: string[] = []; export function render(): string { parts.push("extra"); return parts.join("\\n"); }',
    ),
    effect('export function render(): string { state.count++; return ""; }'),
    effect('export function render(): string { return new Client().text; }'),
    effect('export function render(): string { import("./x.utils.js"); return ""; }'),
    {
      code: 'export async function render(): Promise<string> { return await input; }',
      filename,
      errors: [{ messageId: 'promptEffect' }],
    },
  ],
});
