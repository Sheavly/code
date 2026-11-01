// Conventions written as AST selectors, each under its own rule ID, so a
// `files:` override can switch one off without restating the others.

const PARAMS_OBJECT_MESSAGE =
  'Functions with more than one input take a single `params` object, destructured on the first line: `function f(params: { a: A; b: B }) { const { a, b } = params; }`.';

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
        "No re-exports (barrels). Import from the defining `<name>.<kind>.ts` file, or a package's exported subpath (`@sheavly/core/tool/tool.service`).",
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
