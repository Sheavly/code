// A `*.tool.ts` file of the coding package never resolves a path itself. Every file tool asks the
// one guard in `files/files.helper.ts` (`resolveReadable`, `resolveWritable`, `resolveDeletable`;
// `resolveSearchRoot` for a search), which applies confinement, the `.env` and `.git` policy and
// the working root the same way for all of them. A tool that calls the workspace's raw
// `resolveRead`, `resolveWrite` or `resolveDelete` has stepped around that policy.
//
// A tool file that calls one of those guards must also call `runFileTool` (the shared abort and
// error mapping) somewhere in the file; it cannot see that the call wraps the right body.
//
// Fails, in a tool file: a member access of one of the three names (a call, an alias such as
// `const f = workspace.resolveRead`, `.call`, `.apply`, `workspace['resolveRead']`), a destructured
// property of that name, and an import or re-export of that name (`import { resolveRead as r }`,
// `export { resolveRead } from`). Helpers are not tool files, so the guard itself is free to call
// them. Not covered: a computed key that is not a literal (`workspace[name]`), a resolver reached
// through a helper that is not the guard, and a tool that opens a path with `node:fs` after
// building it by hand; `harness/guard-working-root`, `Workspace` confinement and review carry those.

const MESSAGE =
  'A file tool does not call `resolveRead`, `resolveWrite` or `resolveDelete` itself. Ask the guard in `packages/coding/src/files/files.helper.ts` for the intent: `resolveReadable`, `resolveWritable` or `resolveDeletable` (`resolveSearchRoot` for a search), so `.env`, `.git`, symlinks and the working root are decided in one place. See "File tools" in the file-tools guide.';

const RESOLVERS = new Set(['resolveRead', 'resolveWrite', 'resolveDelete']);

/** The name a key gives, or `undefined` when it is computed and not a literal. */
function keyName(params) {
  const { key, computed } = params;

  if (key.type === 'Literal') return String(key.value);

  return computed ? undefined : key.name;
}

/** The name an import or export specifier refers to in the other module. */
function specifierName(node) {
  const side = node.type === 'ImportSpecifier' ? node.imported : node.local;

  return side.type === 'Literal' ? String(side.value) : side.name;
}

const UNWRAPPED_MESSAGE =
  'A file tool that asks the guard for a path runs its body through `runFileTool` (`packages/coding/src/files/file-tool.helper.ts`), so an aborted call fails before it touches the disk and a missing or refused path reaches the model as a tool error, not a raw `ENOENT`. See `read_file`.';

const GUARDS = new Set(['resolveReadable', 'resolveWritable', 'resolveDeletable']);

export const guardFileToolResolve = {
  meta: { type: 'problem', schema: [], messages: { raw: MESSAGE, unwrapped: UNWRAPPED_MESSAGE } },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'raw' });
    const guardCalls = [];
    let wrapped = false;

    return {
      CallExpression(node) {
        const name = node.callee.type === 'Identifier' ? node.callee.name : undefined;

        if (GUARDS.has(name)) guardCalls.push(node);
        if (name === 'runFileTool') wrapped = true;
      },
      'Program:exit'() {
        if (wrapped) return;

        for (const call of guardCalls) context.report({ node: call, messageId: 'unwrapped' });
      },
      MemberExpression(node) {
        if (RESOLVERS.has(keyName({ key: node.property, computed: node.computed }))) report(node);
      },
      ObjectPattern(node) {
        for (const property of node.properties) {
          const name =
            property.type === 'Property'
              ? keyName({ key: property.key, computed: property.computed })
              : undefined;

          if (RESOLVERS.has(name)) report(property);
        }
      },
      'ImportSpecifier, ExportSpecifier'(node) {
        if (RESOLVERS.has(specifierName(node))) report(node);
      },
    };
  },
};
