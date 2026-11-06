import type { CodeLanguage } from './markdown.types.js';

const words = (list: string): ReadonlySet<string> => new Set(list.split(' '));

const SCRIPT: CodeLanguage = {
  keywords: words(
    'const let var function return if else for while do switch case break continue new class ' +
      'extends import export from default async await try catch finally throw typeof instanceof ' +
      'in of void delete yield static type interface enum implements public private protected ' +
      'readonly as satisfies this super null undefined true false',
  ),
  lineComment: '//',
  blockComments: true,
  strings: ['"', "'", '`'],
  multilineStrings: ['`'],
};

const JSON_DATA: CodeLanguage = {
  keywords: words('true false null'),
  lineComment: undefined,
  blockComments: false,
  strings: ['"'],
  multilineStrings: [],
};

const SHELL: CodeLanguage = {
  keywords: words(
    'if then elif else fi for while until do done case esac in function select return exit ' +
      'export local set unset source',
  ),
  lineComment: '#',
  blockComments: false,
  strings: ['"', "'"],
  multilineStrings: [],
};

const PYTHON: CodeLanguage = {
  keywords: words(
    'def class return if elif else for while in not and or is import from as with try except ' +
      'finally raise pass break continue lambda yield async await global nonlocal None True False',
  ),
  lineComment: '#',
  blockComments: false,
  strings: ['"""', "'''", '"', "'"],
  multilineStrings: ['"""', "'''"],
};

const GO: CodeLanguage = {
  keywords: words(
    'package import func return if else for range switch case default break continue go defer ' +
      'select chan map struct interface type var const fallthrough goto nil true false',
  ),
  lineComment: '//',
  blockComments: true,
  strings: ['"', '`', "'"],
  multilineStrings: ['`'],
};

// No `'` string: in Rust it also starts a lifetime, which has no closing quote.
const RUST: CodeLanguage = {
  keywords: words(
    'fn let mut const static struct enum impl trait pub use mod crate self Self super match if ' +
      'else for while loop return break continue as in where async await move ref type unsafe ' +
      'dyn true false',
  ),
  lineComment: '//',
  blockComments: true,
  strings: ['"'],
  multilineStrings: [],
};

const LANGUAGES: Record<string, CodeLanguage> = {
  ts: SCRIPT,
  tsx: SCRIPT,
  typescript: SCRIPT,
  js: SCRIPT,
  jsx: SCRIPT,
  javascript: SCRIPT,
  mjs: SCRIPT,
  cjs: SCRIPT,
  json: JSON_DATA,
  jsonc: JSON_DATA,
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  shell: SHELL,
  py: PYTHON,
  python: PYTHON,
  go: GO,
  golang: GO,
  rs: RUST,
  rust: RUST,
};

/** The language a fence's tag names, or `undefined` when it is untagged or not one we colour. */
export function languageFor(tag: string | undefined): CodeLanguage | undefined {
  if (tag === undefined) return undefined;

  return Object.hasOwn(LANGUAGES, tag.toLowerCase()) ? LANGUAGES[tag.toLowerCase()] : undefined;
}
