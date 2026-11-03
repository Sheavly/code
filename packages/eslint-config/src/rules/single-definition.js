// A type has one definition. Each `*.types.ts` in every workspace's `src/` owns the type names
// it exports (`workspace-types.js` reads them from disk, so a new package, folder or type is
// covered from the next lint with no change here). Anywhere
// else, a type of the same name is a copy that drifts from the original, and fails with where the
// original lives and how to change it:
//
// - declared again, exported or not, in another file (another module, folder or package, or a
//   second types file of the same module);
// - re-exported (`export type { X } from`, `export type * from`) from a file that isn't its owner.
import { existsSync, readFileSync } from 'node:fs';
import {
  describeOwner,
  exportedTypeNames,
  findRoot,
  readWorkspace,
  resolveSource,
} from './workspace-types.js';

const HOW =
  "Import it (`import type { {{name}} } from '{{source}}'`) instead; to change it, {{change}}. A type that only looks alike is a different thing: give it a name of its own.";
/** Where the judgement behind the rule lives, so the agent reads it before working around it. */
const SKILL = 'See "Enforce what you add" in .agents/skills/working-in-sheavly-harness/SKILL.md.';

export const singleDefinition = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { root: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      copy: `\`{{name}}\` is already defined in {{owner}}: this is a copy. ${HOW} ${SKILL}`,
      reexport: `\`{{name}}\` is defined in {{owner}}, but this re-exports it from another file. Re-export it from '{{source}}', or import it from there. ${SKILL}`,
      noRoot:
        'harness/single-definition could not find the workspace root (a package.json with `workspaces`) above {{cwd}}. Pass `root`; it fails rather than skip, so no type goes unchecked.',
    },
  },
  create(context) {
    const root = context.options[0]?.root ?? findRoot(context.cwd);

    if (!root) {
      return {
        Program: (node) => {
          context.report({ node, messageId: 'noRoot', data: { cwd: context.cwd } });
        },
      };
    }

    const { workspaces, owners } = readWorkspace(root);
    const from = context.filename;
    /** The owner of `name` that isn't `file`, if `file` holds a copy of it. */
    const ownerElsewhere = (name, file) => owners.get(name)?.find((owner) => owner.file !== file);
    const report = (params) => {
      const { node, name, owner, messageId } = params;

      context.report({ node, messageId, data: { name, ...describeOwner({ from, owner }) } });
    };
    const checkDeclaration = (node) => {
      const owner = ownerElsewhere(node.id.name, from);

      if (owner) report({ node: node.id, name: node.id.name, owner, messageId: 'copy' });
    };
    /** `target` re-exports `name`: fine only if it is the owner (or nobody owns the name). */
    const checkReexport = (params) => {
      const { node, name, target } = params;
      const owner = ownerElsewhere(name, target);

      if (owner) report({ node, name, owner, messageId: 'reexport' });
    };

    return {
      TSTypeAliasDeclaration: checkDeclaration,
      TSInterfaceDeclaration: checkDeclaration,
      ExportNamedDeclaration: (statement) => {
        if (!statement.source) return;

        const target = resolveSource({ workspaces, from, specifier: statement.source.value });

        if (!target) return; // a library (`zod`): not ours to check

        for (const specifier of statement.specifiers) {
          checkReexport({ node: specifier, name: specifier.local.name, target });
        }
      },
      ExportAllDeclaration: (statement) => {
        const target = resolveSource({ workspaces, from, specifier: statement.source.value });

        if (!target || !existsSync(target)) return;

        for (const name of exportedTypeNames(readFileSync(target, 'utf8'))) {
          checkReexport({ node: statement, name, target });
        }
      },
    };
  },
};
