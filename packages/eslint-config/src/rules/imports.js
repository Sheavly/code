// Imports follow the workspace layout, read from the workspaces (`layout.utils.js`). In every
// workspace, tests included:
//
// - another workspace only if this one's package.json depends on it (its `devDependencies` count
//   for tests and fakes); a test-only workspace only from tests and fakes;
// - no relative import that leaves the importing workspace (`../../packages/core/...`): import
//   another workspace by its package name;
// - a package only through its public API, the subpaths its package.json `exports` lists (plus
//   `./testing/*`, its fakes, from tests only).
import path from 'node:path';
import {
  isExported,
  LAYOUT_RULE_OPTIONS,
  listWorkspaces,
  readLayout,
  workspaceFlag,
  workspaceOfFile,
} from '../layout.utils.js';
import { findRoot } from './workspace-types.js';

const TEST_CODE = /(^|\/)(__tests__|testing)\//;

function toPosix(file) {
  return file.split(path.sep).join('/');
}

export const importsRule = {
  meta: {
    type: 'problem',
    schema: [LAYOUT_RULE_OPTIONS],
    messages: {
      notInGraph: `{{from}} may not import {{target}}: {{from}}'s package.json doesn't depend on it. {{why}}`,
      testOnly: `{{target}} is for tests and fakes only; source never imports it.`,
      crossesWorkspace: `This relative import leaves {{from}} for {{target}}. Import it by package name (\`@sheavly/...\`), and depend on it in package.json.`,
      notExported: `{{specifier}} isn't part of {{target}}'s public API: its package.json \`exports\` doesn't list \`./{{subpath}}\`. Import what it exports, or, if this should be public, add it in review: \`npm run export -- {{specifier}}\`.`,
      fakeInSource: `{{specifier}} is a fake ({{target}}'s \`testing/\`): only tests and other fakes import it.`,
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const root = options.root ?? findRoot(context.cwd);
    const layout = options.layout ?? (root && readLayout({ root }));

    if (!root) return {}; // harness/layout reports the missing root

    const workspaces = listWorkspaces(root);
    const file = context.filename;
    const from = workspaceOfFile({ workspaces, file });
    const entry = from && layout[from.name];

    if (!entry) return {}; // a file outside every workspace: the layout check reports it

    const isTestCode = TEST_CODE.test(toPosix(path.relative(from.dir, file)));

    const whyNot = (target) => {
      const targetEntry = layout[target];

      if (targetEntry?.kind === 'app') return 'Nothing imports an app.';

      if (entry.domain === 'generic' && targetEntry?.domain === 'coding') {
        return 'A generic workspace never imports a coding one.';
      }

      return `If the dependency is real, add it: \`npm install ${target}@0.0.0${workspaceFlag(entry.dir)}\` (a dev dependency for tests).`;
    };

    const checkPackage = (node, specifier) => {
      const target = Object.keys(layout).find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );

      if (!target || target === from.name) return;

      if (layout[target].testOnly && !isTestCode) {
        context.report({ node, messageId: 'testOnly', data: { target } });

        return;
      }

      const allowed = isTestCode
        ? [...entry.dependsOn, ...(entry.devDependsOn ?? [])]
        : entry.dependsOn;

      if (!allowed.includes(target)) {
        context.report({
          node,
          messageId: 'notInGraph',
          data: { from: from.name, target, why: whyNot(target) },
        });

        return;
      }

      checkSurface({ node, specifier, target });
    };

    // A package is imported only through what its `exports` list, and its fakes only from tests.
    const checkSurface = (params) => {
      const { node, specifier, target } = params;
      const subpath = specifier.slice(target.length + 1);

      if (!subpath || layout[target].kind !== 'package') return;

      if (!isExported({ exports: layout[target].exports ?? [], subpath })) {
        context.report({ node, messageId: 'notExported', data: { specifier, target, subpath } });
      } else if (subpath.startsWith('testing/') && !isTestCode) {
        context.report({ node, messageId: 'fakeInSource', data: { specifier, target } });
      }
    };

    const checkRelative = (node, specifier) => {
      const resolved = path.resolve(path.dirname(file), specifier);
      const to = workspaceOfFile({ workspaces, file: resolved });

      if (to?.dir !== from.dir) {
        context.report({
          node,
          messageId: 'crossesWorkspace',
          data: { from: from.name, target: to?.name ?? toPosix(path.relative(root, resolved)) },
        });
      }
    };

    const check = (node, specifier) => {
      if (typeof specifier !== 'string') return;
      if (specifier.startsWith('.')) checkRelative(node, specifier);
      else checkPackage(node, specifier);
    };

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => node.source.type === 'Literal' && check(node, node.source.value),
    };
  },
};
