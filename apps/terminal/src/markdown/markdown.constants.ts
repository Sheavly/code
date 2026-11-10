import type { CodeLanguageSpec } from './markdown.types.js';

const SCRIPT: CodeLanguageSpec = {
  keywords:
    'const let var function return if else for while do switch case break continue new class ' +
    'extends import export from default async await try catch finally throw typeof instanceof ' +
    'in of void delete yield static type interface enum implements public private protected ' +
    'readonly as satisfies this super null undefined true false',
  lineComment: '//',
  blockComments: true,
  strings: ['"', "'", '`'],
  multilineStrings: ['`'],
};

const JSON_DATA: CodeLanguageSpec = {
  keywords: 'true false null',
  lineComment: undefined,
  blockComments: false,
  strings: ['"'],
  multilineStrings: [],
};

const SHELL: CodeLanguageSpec = {
  keywords:
    'if then elif else fi for while until do done case esac in function select return exit ' +
    'export local set unset source',
  lineComment: '#',
  blockComments: false,
  strings: ['"', "'"],
  multilineStrings: [],
};

const PYTHON: CodeLanguageSpec = {
  keywords:
    'def class return if elif else for while in not and or is import from as with try except ' +
    'finally raise pass break continue lambda yield async await global nonlocal None True False',
  lineComment: '#',
  blockComments: false,
  strings: ['"""', "'''", '"', "'"],
  multilineStrings: ['"""', "'''"],
};

const GO: CodeLanguageSpec = {
  keywords:
    'package import func return if else for range switch case default break continue go defer ' +
    'select chan map struct interface type var const fallthrough goto nil true false',
  lineComment: '//',
  blockComments: true,
  strings: ['"', '`', "'"],
  multilineStrings: ['`'],
};

// No `'` string: in Rust it also starts a lifetime, which has no closing quote.
const RUST: CodeLanguageSpec = {
  keywords:
    'fn let mut const static struct enum impl trait pub use mod crate self Self super match if ' +
    'else for while loop return break continue as in where async await move ref type unsafe ' +
    'dyn true false',
  lineComment: '//',
  blockComments: true,
  strings: ['"'],
  multilineStrings: [],
};

/** The languages whose code is coloured, by the (lower-case) tag a fence names them with. */
export const LANGUAGES: Record<string, CodeLanguageSpec> = {
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

/** How far a fenced code block's lines are indented. */
export const CODE_INDENT = '  ';

/** A number at the start of the text: hex, or decimal with a fraction and an exponent. */
export const NUMBER_PATTERN = /^(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/;

/** An identifier or keyword at the start of the text. */
export const WORD_PATTERN = /^[A-Za-z_$][\w$]*/;

/** A line that opens a fence: its indent, its marker, then the info text. */
export const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** A line that closes a fence: only a marker, after at most three spaces. */
export const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;
