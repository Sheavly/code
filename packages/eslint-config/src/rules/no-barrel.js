import { kindOfFile } from '../file-kinds.js';

// No re-exports (barrels): a name is imported from the file that defines it. The one exception is
// a `*.types.ts` file re-exporting, by name, types ANOTHER PACKAGE exposes
// (`export type { X } from '@pkg/…'`): a package's public types file may expose types it builds
// on, and a type re-export creates no second definition. A relative, `#` subpath or absolute
// source is refused: a types file listing its siblings' types is a barrel by another name.
// Everything else fails: a value
// re-export, `export *` and `export type *` (a wildcard hides what is re-exported), an inline
// `export { type X } from` (the statement is a value re-export, so a value can slip in beside the
// type), and any type re-export outside a types file.

const MESSAGE =
  "No re-exports (barrels). Import from the defining `<name>.<kind>.ts` file, or a package's exported subpath (`@sheavly/core/tool/tool.utils`). The one exception: a types file may re-export types another package exposes, by name: `export type { X } from '@pkg/...'` (no `export *`, no inline `type` modifier, no values); re-exporting siblings is a barrel.";

/** Whether `source` names another package: a relative, `#` subpath or absolute source is this one's own. */
function isPackageSource(source) {
  return !source.startsWith('.') && !source.startsWith('#') && !source.startsWith('/');
}

export const noBarrel = {
  meta: { type: 'suggestion', schema: [], messages: { barrel: MESSAGE } },
  create(context) {
    const inTypesFile = kindOfFile(context.filename) === 'types';

    return {
      ExportAllDeclaration: (node) => context.report({ node, messageId: 'barrel' }),
      'ExportNamedDeclaration[source]'(node) {
        // `exportKind` is 'type' only for a whole `export type { … }` statement; the inline
        // form (`export { type A }`) is a 'value' statement.
        if (inTypesFile && node.exportKind === 'type' && isPackageSource(node.source.value)) return;

        context.report({ node, messageId: 'barrel' });
      },
    };
  },
};
