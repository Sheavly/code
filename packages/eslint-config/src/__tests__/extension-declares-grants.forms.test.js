// How a call to a scoped service is recognised, and what is deliberately not followed.
import { harnessPlugin } from '../plugin.js';
import { grantCase, KEYS, missing, TYPES } from '../testing/grant-calls.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const rule = harnessPlugin.rules['extension-declares-grants'];
const tester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

const KEY_IMPORT = `import { SESSION_INFO } from '${KEYS}';`;
const TYPE_IMPORT = `import type { SessionInfoView } from '${TYPES}';`;
const LIST = missing('session-info.list', 'session:read');

const FORMS = {
  'a chained call': `${KEY_IMPORT}
export const a = (services) => services.get(SESSION_INFO).list();`,
  'a const': `${KEY_IMPORT}
export const a = (services) => { const s = services.get(SESSION_INFO); return s.list(); };`,
  'a let': `${KEY_IMPORT}
export const a = (services) => { let s = services.get(SESSION_INFO); return s.list(); };`,
  'find with optional chaining': `${KEY_IMPORT}
export const a = (services) => services.find(SESSION_INFO)?.list();`,
  'a bound find with optional chaining': `${KEY_IMPORT}
export const a = (services) => { const s = services.find(SESSION_INFO); return s?.list(); };`,
  'a non-null assertion': `${KEY_IMPORT}
export const a = (services) => { const s = services.find(SESSION_INFO); return s!.list(); };`,
  'a non-null value': `${KEY_IMPORT}
export const a = (services) => { const s = services.find(SESSION_INFO)!; return s.list(); };`,
  'an as cast': `${KEY_IMPORT}
${TYPE_IMPORT}
export const a = (services) => (services.get(SESSION_INFO) as SessionInfoView).list();`,
  'an as cast bound to a const': `${KEY_IMPORT}
${TYPE_IMPORT}
export const a = (services) => { const s = services.get(SESSION_INFO) as SessionInfoView; return s.list(); };`,
  'a satisfies cast bound to a const': `${KEY_IMPORT}
${TYPE_IMPORT}
export const a = (services) => { const s = services.get(SESSION_INFO) satisfies SessionInfoView; return s.list(); };`,
  'a type assertion': `${KEY_IMPORT}
${TYPE_IMPORT}
export const a = (services) => (<SessionInfoView>services.get(SESSION_INFO)).list();`,
  'a type assertion bound to a let': `${KEY_IMPORT}
${TYPE_IMPORT}
export const a = (services) => { let s = <SessionInfoView>services.get(SESSION_INFO); return s.list(); };`,
  'a let declared then assigned': `${KEY_IMPORT}
export const a = (services) => { let s; s = services.get(SESSION_INFO); return s.list(); };`,
  'an annotated let declared then assigned': `${KEY_IMPORT}
${TYPE_IMPORT}
export const a = (services) => { let s: SessionInfoView; s = services.get(SESSION_INFO); return s.list(); };`,
  'an optional annotated let assigned from find': `${KEY_IMPORT}
${TYPE_IMPORT}
export const a = (services) => { let s: SessionInfoView | undefined; s = services.find(SESSION_INFO); return s?.list(); };`,
  'a let assigned the same service twice': `${KEY_IMPORT}
export const a = (services) => { let s = services.get(SESSION_INFO); s = services.get(SESSION_INFO); return s.list(); };`,
  'a call before a write of undefined': `${KEY_IMPORT}
export const a = (services) => { let s = services.get(SESSION_INFO); const r = s.list(); s = undefined; return r; };`,
  'a call before a write of null': `${KEY_IMPORT}
export const a = (services) => { let s = services.find(SESSION_INFO); const r = s?.list(); s = null; return r; };`,
  'a let that starts undefined': `${KEY_IMPORT}
export const a = (services) => { let s = undefined; s = services.get(SESSION_INFO); return s.list(); };`,
  'an aliased key': `import { SESSION_INFO as INFO } from '${KEYS}';
export const a = (services) => services.get(INFO).list();`,
  'a typed parameter': `${TYPE_IMPORT}
export const a = (s: SessionInfoView) => s.list();`,
  'an aliased type': `import type { SessionInfoView as View } from '${TYPES}';
export const a = (s: View) => s.list();`,
  'an optional typed parameter': `${TYPE_IMPORT}
export const a = (s?: SessionInfoView) => s?.list();`,
  'a parameter typed or undefined': `${TYPE_IMPORT}
export const a = (s: SessionInfoView | undefined) => s?.list();`,
  'a typed variable': `${TYPE_IMPORT}
declare const pick: () => unknown;
export const a = () => { const s: SessionInfoView = pick() as SessionInfoView; return s.list(); };`,
  'a typed callback': `${TYPE_IMPORT}
export const a = (all: unknown[]) => all.map((s: SessionInfoView) => s.list());`,
  'a call in a tool execute': `${KEY_IMPORT}
export const activate = (services) => {
  const sessions = services.get(SESSION_INFO);

  return { tools: [{ name: 'x', execute: async () => sessions.list() }] };
};`,
  'a call in a hook handler': `${KEY_IMPORT}
export const activate = (services) => {
  const sessions = services.get(SESSION_INFO);

  return { hooks: { onStart: () => { setTimeout(() => sessions.get('s'), 0); } } };
};`,
};

tester.run('extension-declares-grants: the forms a call is recognised in', rule, {
  valid: Object.values(FORMS).map((code) => grantCase({ code, grants: ['session:read'] })),
  invalid: Object.entries(FORMS).map(([form, code]) => ({
    ...grantCase({
      code,
      grants: [],
      errors: [
        form === 'a call in a hook handler' ? missing('session-info.get', 'session:read') : LIST,
      ],
    }),
  })),
});

const NOT_FOLLOWED = {
  'a scope passed to another function': `${KEY_IMPORT}
declare const use: (scope: unknown) => void;
export const a = (services) => use(services.get(SESSION_INFO));`,
  'an unannotated parameter': `export const a = (scope) => scope.list();`,
  'destructured methods': `${KEY_IMPORT}
export const a = (services) => { const { list } = services.get(SESSION_INFO); return list(); };`,
  'a method read without a call': `${KEY_IMPORT}
export const a = (services) => { const read = services.get(SESSION_INFO).list; return read; };`,
  'a computed key': `${KEY_IMPORT}
export const a = (services, name: 'list') => services.get(SESSION_INFO)[name]();`,
  'a literal computed key': `${KEY_IMPORT}
export const a = (services) => services.get(SESSION_INFO)['list']();`,
  'a scope stored on an object': `${KEY_IMPORT}
export const a = (services) => { const held = { scope: services.get(SESSION_INFO) }; return held.scope.list(); };`,
  'a scope stored on a class field': `${KEY_IMPORT}
export class A { private scope; constructor(services) { this.scope = services.get(SESSION_INFO); } run() { return this.scope.list(); } }`,
  'a copy of the scope': `${KEY_IMPORT}
export const a = (services) => { const s = services.get(SESSION_INFO); const t = s; return t.list(); };`,
  'a let reassigned after its scope value': `${KEY_IMPORT}
declare const other: { list: () => void };
export const a = (services) => { let s = services.get(SESSION_INFO); s = other; return s.list(); };`,
  'a let reassigned before the call in a callback': `${KEY_IMPORT}
declare const other: { list: () => void };
export const a = (services) => {
  let s = services.get(SESSION_INFO);
  const later = () => s.list();

  s = other;

  return later;
};`,
  'a let first holding another value, then a scope': `${KEY_IMPORT}
declare const other: { list: () => void };
export const a = (services) => { let s = other; s = services.get(SESSION_INFO); return s.list(); };`,
  'a let assigned two different services': `import { SESSION_INFO, MODEL } from '${KEYS}';
export const a = (services) => { let s = services.get(SESSION_INFO); s = services.get(MODEL); return s.list(); };`,
  'a let declared then assigned a service and a variable': `${KEY_IMPORT}
declare const other: { list: () => void };
export const a = (services) => { let s; s = services.get(SESSION_INFO); s = other; return s.list(); };`,
  'a let assigned from an unknown call': `${KEY_IMPORT}
declare const pick: () => { list: () => void };
export const a = (services) => { let s = services.get(SESSION_INFO); s = pick(); return s.list(); };`,
  'an annotated let assigned from an unknown call': `${KEY_IMPORT}
${TYPE_IMPORT}
declare const pick: () => SessionInfoView;
export const a = (services) => { let s: SessionInfoView = services.get(SESSION_INFO); s = pick(); return s.list(); };`,
  'a let changed by an update or a compound assignment': `${KEY_IMPORT}
export const a = (services) => { let s = services.get(SESSION_INFO); s += 1; return s.list(); };`,
  'a typed let that is reassigned': `${TYPE_IMPORT}
declare const other: SessionInfoView;
export const a = (s: SessionInfoView) => { s = other; return s.list(); };`,
  'a namespace key import': `import * as keys from '${KEYS}';
export const a = (services) => services.get(keys.SESSION_INFO).list();`,
  'a parameter annotated through a destructured pattern': `${TYPE_IMPORT}
export const a = ({ s }: { s: SessionInfoView }) => s.list();`,
  'a call through call, apply, bind and Reflect.apply': `${KEY_IMPORT}
export const a = (services) => {
  const s = services.get(SESSION_INFO);

  s.list.call(s);
  s.list.apply(s, []);
  s.list.bind(s)();

  return Reflect.apply(s.list, s, []);
};`,
  'a key aliased to a local constant': `${KEY_IMPORT}
export const a = (services) => { const k = SESSION_INFO; return services.get(k).list(); };`,
  'a method the mapping does not list': `${KEY_IMPORT}
export const a = (services) => services.get(SESSION_INFO).somethingNew();`,
  'a key that is not the contract': `import { SESSION_INFO } from './keys.js';
export const a = (services) => services.get(SESSION_INFO).list();`,
  'a local constant named like a key': `const SESSION_INFO = 'x';
export const a = (services) => services.get(SESSION_INFO).list();`,
  'a key that is not a service key': `import { NOT_A_KEY } from '${KEYS}';
export const a = (services) => services.get(NOT_A_KEY).list();`,
  'a type that is not the contract': `import type { SessionInfoView } from './types.js';
export const a = (s: SessionInfoView) => s.list();`,
  'a type that is no scope': `import type { SystemPromptView } from '${TYPES}';
export const a = (s: SystemPromptView) => s.list();`,
  'an any-typed value': `export const a = (s: any) => s.list();`,
  'a receiver that is not a scope': `export const a = (map: Map<string, string>) => map.get('x');`,
};

tester.run('extension-declares-grants: what is not followed is not reported', rule, {
  valid: Object.values(NOT_FOLLOWED).map((code) => grantCase({ code, grants: [] })),
  invalid: [],
});
