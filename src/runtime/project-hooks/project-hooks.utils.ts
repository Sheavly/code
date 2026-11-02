/**
 * Turns a failed `import()` of a hook file into advice. Plain `.js`/`.ts` follow the project's
 * package.json `"type"`, so a hook written in the other module format fails; the fix is the
 * explicit extension.
 */
export function explainImportError(params: { file: string; caughtError: unknown }): string {
  const { file, caughtError } = params;
  const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
  const code = (caughtError as { code?: unknown } | undefined)?.code;
  const typescript = /\.[cm]?ts$/.test(file);

  if (code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
    return `${message}\nNode runs TypeScript by removing the types, so only erasable syntax works: no enum, namespace or constructor parameter properties.`;
  }

  if (/\b(module|exports|require) is not defined in ES module scope/.test(message)) {
    return `${message}\nThis file uses CommonJS, but the project's package.json makes it ESM. Rename it to ${typescript ? '.cts' : '.cjs'}, or use export default.`;
  }

  if (/Unexpected token 'export'|Cannot use import statement outside a module/.test(message)) {
    return `${message}\nThis file uses ESM, but the project's package.json makes it CommonJS. Rename it to ${typescript ? '.mts' : '.mjs'}, or use module.exports.`;
  }

  return message;
}
