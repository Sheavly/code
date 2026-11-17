// A `*.tool.ts` file of the coding package never resolves a path itself. Every file tool asks the
// one guard in `files/files.helper.ts` (`resolveReadable`, `resolveWritable`, `resolveDeletable`;
// `resolveSearchRoot` for a search), which applies confinement, the `.env` and `.git` policy and
// the working root the same way for all of them. A tool that calls the workspace's raw
// `resolveRead`, `resolveWrite` or `resolveDelete` has stepped around that policy.
//
// A tool file that calls one of those guards must also call `runFileTool` (the shared abort and
// error mapping) somewhere in the file; it cannot see that the call wraps the right body, since a
// tool calls the guard from a function the wrapper's callback calls, not from the callback itself.
// A tool file may not import `fs`, `node:fs` or their `/promises` forms (its effects are in
// `files/file-effects.helper.ts`), and may not import the guards or `runFileTool` under another name,
// since the rule finds them by name.
//
// Fails, in a tool file: a member access of one of the three names (a call, an alias such as
// `const f = workspace.resolveRead`, `.call`, `.apply`, `workspace['resolveRead']`), a destructured
// property of that name, and an import or re-export of that name (`import { resolveRead as r }`,
// `export { resolveRead } from`), a key written as a string or an empty template. Helpers are not
// tool files, so the guard itself is free to call them. Not covered: a computed key built at run
// time (`workspace[name]`, `Reflect.get(workspace, 'resolveRead')`), a resolver reached through a
// helper that is not the guard (`ripgrep.helper.ts` and `command-cwd.helper.ts` call `resolveRead`
// themselves, under `harness/guard-working-root` and `harness/guard-env-read`), and a tool that
// reaches the file system through another module; `Workspace` confinement and review carry those.

const MESSAGE =
  'A file tool does not call `resolveRead`, `resolveWrite` or `resolveDelete` itself. Ask the guard in `extensions/coding/src/files/files.helper.ts` for the intent: `resolveReadable`, `resolveWritable` or `resolveDeletable` (`resolveSearchRoot` for a search), so `.env`, `.git`, symlinks and the working root are decided in one place. See "File tools" in the file-tools guide.';

const RESOLVERS = new Set(['resolveRead', 'resolveWrite', 'resolveDelete']);

/** The name a key gives, or `undefined` when it is computed and not a literal. */
function keyName(params) {
  const { key, computed } = params;

  if (key.type === 'Literal') return String(key.value);

  // A template with nothing in it (`workspace[`resolveRead`]`) names a property like a string does.
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0) {
    return key.quasis[0].value.cooked;
  }

  return computed ? undefined : key.name;
}

const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);

const FS_MESSAGE =
  'A file tool does not import the file system itself. Its reads, writes and deletes go through `extensions/coding/src/files/file-effects.helper.ts` (`openRegularFile`, `readForChange`, `writeText`, `removeFile`, ...), after the guard has resolved the path.';

const ALIAS_MESSAGE =
  'Import `resolveReadable`, `resolveWritable`, `resolveDeletable` and `runFileTool` under their own names: the rule finds them by name, so an alias hides a guard or the wrapper from it.';

const TRACKED = new Set(['resolveReadable', 'resolveWritable', 'resolveDeletable', 'runFileTool']);

/** The name an import or export specifier refers to in the other module. */
function specifierName(node) {
  const side = node.type === 'ImportSpecifier' ? node.imported : node.local;

  return side.type === 'Literal' ? String(side.value) : side.name;
}

const UNWRAPPED_MESSAGE =
  'A file tool that asks the guard for a path runs its body through `runFileTool` (`extensions/coding/src/files/file-tool.helper.ts`), so an aborted call fails before it touches the disk and a missing or refused path reaches the model as a tool error, not a raw `ENOENT`. See `read_file`.';

const GUARDS = new Set(['resolveReadable', 'resolveWritable', 'resolveDeletable']);

export const guardFileToolResolve = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      raw: MESSAGE,
      unwrapped: UNWRAPPED_MESSAGE,
      fs: FS_MESSAGE,
      alias: ALIAS_MESSAGE,
    },
  },
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
      ImportSpecifier(node) {
        const imported = specifierName(node);

        if (TRACKED.has(imported) && node.local.name !== imported) {
          context.report({ node, messageId: 'alias' });
        }
      },
      ImportDeclaration(node) {
        if (FS_MODULES.has(node.source.value)) context.report({ node, messageId: 'fs' });
      },
    };
  },
};
