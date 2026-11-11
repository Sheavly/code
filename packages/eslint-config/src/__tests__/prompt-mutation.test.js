import { harnessPlugin } from '../plugin.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const tester = typescriptRuleTester();
const filename = 'src/prompt/mutation.prompt.ts';
const render = (body, prefix = '') => ({
  code: `${prefix} export function render(parts: string[]): string { ${body} return "text"; }`,
  filename,
});
const rejected = (body, prefix) => ({
  ...render(body, prefix),
  errors: [{ messageId: 'promptEffect' }],
});

const borrowedReceivers = [
  ['const local = { parts };', 'local.parts'],
  ['const local = [parts];', 'local[0]'],
  ['const local = { nested: [{ parts }] };', 'local.nested[0].parts'],
  ['const local = { parts }; const alias = local.parts;', 'alias'],
  ['const local = { parts }; const alias = local; const buffer = alias.parts;', 'buffer'],
  ['const local = { parts }; const { parts: buffer } = local;', 'buffer'],
  ['const local = [parts]; const [buffer] = local;', 'buffer'],
  ['const local = { nested: { parts } }; const { nested: { parts: buffer } } = local;', 'buffer'],
  ['const local = { ...{ parts } };', 'local.parts'],
  ['const wrapper = { parts }; const local = { ...wrapper };', 'local.parts'],
  ['const local = [...[parts]];', 'local[0]'],
  ['const local = [parts].slice();', 'local[0]'],
  ['const local = Object.assign({}, { parts });', 'local.parts'],
  ['const local = { parts }; const copy = { ...local }; const buffer = copy.parts;', 'buffer'],
];

const memberMutations = [
  (receiver) => `${receiver}.sort();`,
  (receiver) => `Object.assign(${receiver}, { 0: "extra" });`,
  (receiver) => `Object.defineProperty(${receiver}, "0", { value: "extra" });`,
  (receiver) => `Reflect.set(${receiver}, "0", "extra");`,
  (receiver) => `Reflect.deleteProperty(${receiver}, "0");`,
  (receiver) => `${receiver}[0] = "extra";`,
  (receiver) => `${receiver}.length++;`,
  (receiver) => `delete ${receiver}[0];`,
];

tester.run('prompt mutation receiver ownership', harnessPlugin.rules['pure-imports'], {
  valid: [
    render('const local = { parts: [] }; local.parts.push("extra");'),
    render('const local = { nested: [{ parts: [] }] }; local.nested[0].parts.push("extra");'),
    render('const local = [[]]; local[0].push("extra");'),
    render('const local = { "parts": [] }; local["parts"].push("extra");'),
    render('const buffer = []; const local = { parts: buffer }; local.parts.push("extra");'),
    render('const local = { parts: [] }; const { parts: buffer } = local; buffer.push("extra");'),
    render('const local = [[]]; const [buffer] = local; buffer.push("extra");'),
    render('const local = { ...{ parts: [] } }; local.parts.push("extra");'),
    render('const local = { ...{ parts }, parts: [] }; local.parts.push("extra");'),
    render('const local = { parts }; local.parts = []; delete local.parts;'),
    render('const local = []; local.push("extra"); local[0] = "next"; local.length++;'),
    render('const local = [...parts]; local.push("extra");'),
    render('const local = Object.assign({}, { parts }); Object.assign(local, { title: "extra" });'),
    render('const local = parts.slice(); const alias = local; alias.sort();'),
    render('const local = { ...{ parts } }; Object.assign(local, { title: "extra" });'),
    render('const local = { nested: {} }; Reflect.set(local.nested, "title", "extra");'),
    render(
      'const local = { nested: { count: 0 } }; local.nested.count++; delete local.nested.count;',
    ),
    render('const local = { buffer: new Set() }; local.buffer.add("extra");'),
    render('const local = { parts: parts.slice() }; local.parts.sort();'),
    render('const local = { parts }; const text = local.parts.map(part => part.trim()).join(" ");'),
  ],
  invalid: [
    ...borrowedReceivers.map(([setup, receiver]) =>
      rejected(`${setup} ${receiver}.push("extra");`),
    ),
    ...memberMutations.map((mutation) =>
      rejected(`const local = { parts }; ${mutation('local.parts')}`),
    ),
    rejected('const local = { parts: shared }; local.parts.push("extra");', 'const shared = [];'),
    rejected(
      'const local = { nested: [shared] }; local.nested[0].push("extra");',
      'import { shared } from "./data.constants.js";',
    ),
    rejected('const local = { parts: [] }; local[parts[0]].push("extra");'),
    rejected('const local = { get parts() { return parts; } }; local.parts.push("extra");'),
    rejected('const local = { parts: [], ...{ parts } }; local.parts.push("extra");'),
    rejected('const local = { parts: [] }; const key = parts[0]; local[key].push("extra");'),
    rejected(
      'const local = { parts }; const { missing: buffer = parts } = local; buffer.push("extra");',
    ),
    rejected('const local = { parts }; const { ...copy } = local; copy.parts.push("extra");'),
    rejected('const local = { parts: [] }; function nested() { local.parts.push("extra"); }'),
    rejected('const a = b; const b = a; a.push("extra");'),
  ],
});
