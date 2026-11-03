// The workspace scaffold: `npm run new -- <package|app> <name> --domain <d> --description "…"
// [--depends-on a,b]` creates a workspace the layout accepts as it is (see the README's
// "Workspace layout"). Nothing central is edited: the workspace is created, and the layout reads
// it. The graph is checked first, against the workspaces on disk, so a dependency it doesn't allow
// is refused before anything changes. An allowed dependency is installed with its first import
// (the scaffold prints the command): installed earlier, nothing would import it, and knip fails.
//
//   package   packages/<name>, exported by subpath (`@sheavly/<name>/<module>/<file>`)
//   app       apps/<name>, a front end or host; nothing imports it
//
// package.json is only ever written through npm (`npm init -w`, `npm pkg set`, `npm install`).
// The configs and a README are written as files. No code or test is: the first module is the
// author's, and until it lands the layout check says the workspace has no source.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { format, resolveConfig } from 'prettier';
import {
  DOMAINS,
  edgeProblem,
  readLayout,
  workspaceFlag,
} from '../packages/eslint-config/src/layout.utils.js';

const SCOPE = '@sheavly/';
const FOLDERS = { package: 'packages', app: 'apps' };
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What would be created, or the problems that stop it. Reads the repo; changes nothing. */
export function planWorkspace(params) {
  const { root, kind, name, domain, description, dependsOn = [] } = params;
  const problems = [];

  if (!(kind in FOLDERS)) problems.push(`the kind is \`package\` or \`app\`, not \`${kind}\``);

  if (!KEBAB.test(name ?? '')) {
    problems.push(`the name is kebab-case (\`road-segments\`), not \`${name}\``);
  }

  if (!DOMAINS.includes(domain)) problems.push(`--domain is one of ${DOMAINS.join(', ')}`);

  if (!description?.trim()) {
    problems.push('--description says what the workspace is for, in one line');
  }

  if (problems.length > 0) return { problems };

  const dir = `${FOLDERS[kind]}/${name}`;
  const fullName = `${SCOPE}${name}`;
  const layout = readLayout({ root });

  if (existsSync(path.join(root, dir)) || fullName in layout) {
    return { problems: [`${dir} (${fullName}) already exists`] };
  }

  const entry = {
    dir,
    kind,
    domain,
    testOnly: false,
    dependsOn: dependsOn.map((dep) => (dep.startsWith(SCOPE) ? dep : `${SCOPE}${dep}`)),
    devDependsOn: [],
  };
  // Checked against the workspaces as they are, so naming itself reads as "isn't a workspace".
  const edges = entry.dependsOn
    .map((dependency) => edgeProblem({ name: fullName, entry, dependency, layout }))
    .filter(Boolean);

  return edges.length > 0
    ? { problems: edges }
    : { problems: [], dir, fullName, entry, description: description.trim() };
}

/**
 * Every workspace starts on the shared config alone. An app that grows a UI names its front-end
 * files (`frontEndFiles`) in review, when an issue asks for one, never from the scaffold.
 */
const ESLINT_CONFIG =
  "import { baseConfig } from '@sheavly/eslint-config';\n\nexport default baseConfig({ tsconfigRootDir: import.meta.dirname });\n";

const TSCONFIG = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    // Dev, tests and typecheck read the .ts source (the \`@sheavly/source\` export condition);
    // \`tsconfig.build.json\` compiles it to \`outDir\` for plain Node.
    // \`rootDir\` makes an import from outside the workspace a type error.
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"]
}
`;

function tsconfigBuild(params) {
  const { layout, entry } = params;
  const references = entry.dependsOn.map((dep) => ({
    path: `${path.posix.relative(entry.dir, layout[dep].dir)}/tsconfig.build.json`,
  }));

  return `${JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: {
        noEmit: false,
        composite: true,
        outDir: 'dist',
        tsBuildInfoFile: 'dist/tsconfig.build.tsbuildinfo',
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        customConditions: [],
      },
      ...(references.length > 0 ? { references } : {}),
      exclude: ['src/**/__tests__', 'src/testing'],
    },
    null,
    2,
  )}\n`;
}

/** Every step that creates the workspace, in order: commands for npm, files for the rest. */
function steps(params) {
  const { plan, root } = params;
  const { dir, fullName, entry, description } = plan;
  const workspaces = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces;
  const pattern = `${FOLDERS[entry.kind]}/*`;
  const set = (...fields) => ['pkg', 'set', ...fields, '-w', dir];
  const scripts = [
    'scripts.typecheck=tsc --noEmit',
    'scripts.build=tsc -b tsconfig.build.json',
    'scripts.lint=eslint .',
    'scripts.test=vitest run --config ../../vitest.config.ts',
  ];
  const exportsField =
    entry.kind === 'package'
      ? [
          'exports[./*][@sheavly/source]=./src/*.ts',
          'exports[./*].types=./dist/*.d.ts',
          'exports[./*].default=./dist/*.js',
        ]
      : [];

  return [
    ...(workspaces.includes(pattern)
      ? []
      : [{ npm: ['pkg', 'set', `workspaces[${workspaces.length}]=${pattern}`] }]),
    { npm: ['init', '-y', '-w', dir] },
    { npm: ['pkg', 'delete', 'main', 'keywords', 'author', 'scripts.test', '-w', dir] },
    {
      npm: set(
        `name=${fullName}`,
        'version=0.0.0',
        `description=${description}`,
        'type=module',
        'license=UNLICENSED',
        `sheavly.domain=${entry.domain}`,
        ...scripts,
        ...exportsField,
      ),
    },
    { npm: ['pkg', 'set', 'private=true', '--json', '-w', dir] },
    // `npm init -w` registered it under its folder name; `npm pkg` renamed it without touching the
    // lockfile or the node_modules link. Reify once, so both know it as `@sheavly/<name>`.
    { npm: ['install', '--no-audit', '--no-fund'] },
    { file: `${dir}/eslint.config.js`, content: ESLINT_CONFIG },
    { file: `${dir}/tsconfig.json`, content: TSCONFIG },
    { file: `${dir}/tsconfig.build.json`, content: tsconfigBuild({ layout: plan.layout, entry }) },
    { file: `${dir}/README.md`, content: `# ${fullName}\n\n${description}\n` },
  ];
}

/**
 * The installs `plan`'s dependencies need. Run each with the first import of that dependency: a
 * dependency nothing imports yet fails knip, and `harness/imports` names the same command.
 */
export function installCommands(plan) {
  return plan.entry.dependsOn.map((dep) => `npm install ${dep}@0.0.0${workspaceFlag(plan.dir)}`);
}

function runNpm(params) {
  const { root, args } = params;
  const result = spawnSync('npm', args, { cwd: root, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
  }
}

/** Writes `content` to `file`, formatted the way the repo's Prettier config says. */
async function writeFormatted(params) {
  const { root, file, content } = params;
  const target = path.join(root, file);
  const options = await resolveConfig(target);

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, await format(content, { ...options, filepath: target }));
}

/** Creates the workspace `plan` describes; `npm` runs each npm command (real npm by default). */
export async function createWorkspace(params) {
  const { root, plan, npm = (args) => runNpm({ root, args }) } = params;

  for (const step of steps({ plan: { ...plan, layout: readLayout({ root }) }, root })) {
    if (step.npm) npm(step.npm);
    else await writeFormatted({ root, file: step.file, content: step.content });
  }
}

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      domain: { type: 'string' },
      description: { type: 'string' },
      'depends-on': { type: 'string' },
    },
  });
  const [kind, name] = positionals;
  const dependsOn = (values['depends-on'] ?? '')
    .split(',')
    .map((dep) => dep.trim())
    .filter(Boolean);

  return { kind, name, domain: values.domain, description: values.description, dependsOn };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..');
  const plan = planWorkspace({ root, ...parseCli(process.argv.slice(2)) });

  if (plan.problems.length > 0) {
    console.error(`Not created:\n${plan.problems.map((problem) => `- ${problem}`).join('\n')}`);
    console.error(
      '\nUsage: npm run new -- <package|app> <name> --domain <generic|coding|tooling> --description "…" [--depends-on a,b]',
    );
    process.exit(1);
  }

  await createWorkspace({ root, plan });
  console.log(
    `Created ${plan.dir} (${plan.fullName}). Next: its first module, ${plan.dir}/src/<module>/<module>.<kind>.ts, with its tests in <module>/__tests__/.`,
  );

  for (const command of installCommands(plan)) {
    console.log(`With its first import of it: ${command}`);
  }
}
