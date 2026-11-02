// Conventions written as AST selectors, each under its own rule ID, so a
// `files:` override can switch one off without restating the others.

const PARAMS_OBJECT_MESSAGE =
  'Functions with more than one input take a single `params` object, destructured on the first line: `function f(params: { a: A; b: B }) { const { a, b } = params; }`.';

/** Modules that read or write the terminal. */
const TERMINAL_MODULES = '/^(node:)?(readline|tty)(\\u002Fpromises)?$/';
const STDIO = '/^(stdin|stdout|stderr)$/';
const TERMINAL_IO_MESSAGE =
  'No terminal I/O (node:readline, node:tty, process.stdin/stdout/stderr) outside the front-end files: the harness emits typed events and a UI renders them. A UI is built only when its issue asks for one; then add its files to `FRONT_END_FILES` in eslint.config.js, where review sees it.';

export const SYNTAX_RULES = {
  'no-default-export': [
    {
      selector: 'ExportDefaultDeclaration',
      message: 'Use named exports, so imports and renames stay greppable.',
    },
  ],
  'no-process-env': [
    {
      selector: "MemberExpression[object.name='process'][property.name='env']",
      message:
        'Read env only in a host (e.g. src/demo.ts) and pass values in as options; library code must not read process.env.',
    },
  ],
  // Only module-level functions: inline callbacks (`.map((x, i) => ...)`) and class methods
  // have signatures their caller dictates.
  'params-object': [
    { selector: 'FunctionDeclaration[params.length>1]', message: PARAMS_OBJECT_MESSAGE },
    {
      selector:
        ':matches(Program > VariableDeclaration, Program > ExportNamedDeclaration > VariableDeclaration) > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)[params.length>1]',
      message: PARAMS_OBJECT_MESSAGE,
    },
  ],
  'no-barrel': [
    {
      selector: 'ExportAllDeclaration, ExportNamedDeclaration[source]',
      message:
        "No re-exports (barrels). Import from the defining `<name>.<kind>.ts` file, or a package's exported subpath (`@sheavly/core/tool/tool.utils`).",
    },
  ],
  // The harness is a backend: it emits typed events and registries, and renders nothing. A
  // workspace names its front-end files (`frontEndFiles` in `baseConfig`), the only ones exempt.
  'no-terminal-io': [
    {
      selector: `ImportDeclaration[source.value=${TERMINAL_MODULES}], ImportExpression[source.value=${TERMINAL_MODULES}]`,
      message: TERMINAL_IO_MESSAGE,
    },
    {
      selector: `MemberExpression[object.name='process'][property.name=${STDIO}]`,
      message: TERMINAL_IO_MESSAGE,
    },
    {
      selector: `ImportDeclaration[source.value=/^(node:)?process$/] > ImportSpecifier[imported.name=${STDIO}], VariableDeclarator[init.name='process'] > ObjectPattern > Property[key.name=${STDIO}]`,
      message: TERMINAL_IO_MESSAGE,
    },
  ],
};

/** A rule that reports every node matching one of `entries`' selectors with its message. */
export function syntaxRule(entries) {
  return {
    meta: {
      type: 'suggestion',
      schema: [],
      messages: Object.fromEntries(entries.map(({ message }, index) => [`m${index}`, message])),
    },
    create(context) {
      return Object.fromEntries(
        entries.map(({ selector }, index) => [
          selector,
          (node) => context.report({ node, messageId: `m${index}` }),
        ]),
      );
    },
  };
}
